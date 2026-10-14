"""Un solo servicio para las relaciones con vigencia (D2, Entrega A, plan 2026-10-14):
conductor–empresa, equipo–empresa y empresa–cliente.

Reemplaza a `_transferir` y a los `unassign_*` de routers/carriers.py. El historial lo
escribe la base (trigger app.track_assignment_period, migración 20261017090000): este
servicio solo deja la fecha efectiva en `start_date` / `end_date` de la fila, y la base
rechaza un día cerrado del Cierre (HINT `CLOSED_DAY`), que aquí se traduce a 409.

Sin la protección por fila de antes (`is_manual_override` bloqueando la transferencia):
existía para que Mage no pisara la decisión, y Mage ya no escribe el maestro (12/10).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import date

import asyncpg
from fastapi import HTTPException

from .audit import log_change, record_manual_edit


@dataclass(frozen=True)
class _Relation:
    table: str
    subject_col: str
    counterpart_col: str
    subject_table: str
    entity_type: str
    not_found: str


DRIVER = _Relation("driver_assignments", "driver_id", "carrier_id", "drivers", "DRIVER", "Conductor no encontrado")
ASSET = _Relation("asset_assignments", "asset_id", "carrier_id", "assets", "ASSET", "Activo no encontrado")
SHIPPER = _Relation("carrier_shippers", "shipper_id", "carrier_id", "shippers", "CARRIER", "Cliente no encontrado")
RELATIONS = {"DRIVER": DRIVER, "ASSET": ASSET, "SHIPPER": SHIPPER}


@asynccontextmanager
async def closed_day_as_409():
    """El día cerrado lo decide la base; la API lo dice con una frase."""
    try:
        yield
    except asyncpg.RaiseError as exc:
        if getattr(exc, "hint", None) == "CLOSED_DAY":
            raise HTTPException(409, str(exc)) from None
        raise


async def _day(conn, effective: date | None) -> date:
    """Sin fecha: el primer día abierto. Normalmente hoy; si hoy ya se firmó en el
    Cierre, mañana. La pantalla no pide fecha (14/10), así que sin esto un cambio
    hecho después de firmar el día quedaba bloqueado sin salida."""
    if effective:
        return effective
    return await conn.fetchval(
        "SELECT GREATEST(public.hoy_chile(), "
        "(SELECT max(business_date) + 1 FROM app.closure_periods WHERE status = 'CLOSED'))")


async def _require(conn, table: str, row_id: str, message: str) -> None:
    if not await conn.fetchval(f"SELECT 1 FROM public.{table} WHERE id = $1", row_id):
        raise HTTPException(404, message)


async def assign(conn, rel: _Relation, subject_id: str, carrier_id: str, *, actor: str,
                 effective: date | None = None) -> None:
    """Asignar, transferir o reincorporar. Conductor y equipo tienen una sola empresa:
    la anterior termina el mismo día efectivo. Un cliente se suma a los que ya hay."""
    await _require(conn, "carriers", carrier_id, "Empresa no encontrada")
    await _require(conn, rel.subject_table, subject_id, rel.not_found)
    day = await _day(conn, effective)
    async with closed_day_as_409():
        if rel is not SHIPPER:
            previous = await conn.fetch(
                f"""
                UPDATE public.{rel.table} SET status = 'INACTIVE', end_date = $3
                WHERE {rel.subject_col} = $1 AND {rel.counterpart_col} <> $2 AND status = 'ACTIVE'
                RETURNING {rel.counterpart_col}::text AS carrier_id
                """,
                subject_id, carrier_id, day,
            )
            for row in previous:
                await record_manual_edit(
                    conn, table=rel.table, where={rel.subject_col: subject_id, rel.counterpart_col: row["carrier_id"]},
                    actor=actor, entity_type=rel.entity_type, entity_id=subject_id,
                    action="unassign", field="carrier_id", old_value=row["carrier_id"],
                )
        # Ya activo en esta empresa: no se toca (ni la fecha de inicio).
        await conn.execute(
            f"""
            INSERT INTO public.{rel.table} ({rel.subject_col}, {rel.counterpart_col}, status, start_date)
            VALUES ($1, $2, 'ACTIVE', $3)
            ON CONFLICT ({rel.subject_col}, {rel.counterpart_col}) DO UPDATE
                SET status = 'ACTIVE', start_date = EXCLUDED.start_date, end_date = NULL
                WHERE public.{rel.table}.status <> 'ACTIVE'
            """,
            subject_id, carrier_id, day,
        )
    entity_id = carrier_id if rel is SHIPPER else subject_id
    await record_manual_edit(
        conn, table=rel.table, where={rel.subject_col: subject_id, rel.counterpart_col: carrier_id},
        actor=actor, entity_type=rel.entity_type, entity_id=entity_id,
        action="assign", field=rel.subject_col if rel is SHIPPER else "carrier_id",
        new_value=subject_id if rel is SHIPPER else carrier_id,
    )


async def end(conn, rel: _Relation, subject_id: str, carrier_id: str, *, actor: str,
              effective: date | None = None) -> None:
    """Terminar la relación el día efectivo (por defecto, hoy). 404 si no está activa."""
    day = await _day(conn, effective)
    async with closed_day_as_409():
        result = await conn.execute(
            f"""
            UPDATE public.{rel.table} SET status = 'INACTIVE', end_date = $3
            WHERE {rel.subject_col} = $1 AND {rel.counterpart_col} = $2 AND status = 'ACTIVE'
            """,
            subject_id, carrier_id, day,
        )
    if result == "UPDATE 0":
        raise HTTPException(404, "Asignación activa no encontrada")
    entity_id = carrier_id if rel is SHIPPER else subject_id
    await record_manual_edit(
        conn, table=rel.table, where={rel.subject_col: subject_id, rel.counterpart_col: carrier_id},
        actor=actor, entity_type=rel.entity_type, entity_id=entity_id,
        action="unassign", field="status", old_value="ACTIVE", new_value="INACTIVE",
    )


async def list_shippers(db, carrier_id: str) -> list[dict]:
    """Los clientes de la empresa, vigentes y terminados (con sus fechas)."""
    rows = await db.fetch(
        """
        SELECT s.id, s.name, cs.status, cs.start_date, cs.end_date
        FROM public.carrier_shippers cs
        JOIN public.shippers s ON s.id = cs.shipper_id
        WHERE cs.carrier_id = $1
        ORDER BY cs.status, s.name
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]


_IMPACT_SQL = """
SELECT
    (SELECT count(*) FROM app.active_fleet WHERE carrier_id = $1 AND entity_type = 'DRIVER') AS drivers,
    (SELECT count(*) FROM app.active_fleet WHERE carrier_id = $1 AND entity_type = 'ASSET') AS assets,
    (SELECT count(*) FROM app.trips t
       JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
      WHERE vfr.resolved_carrier_id = $1 AND t.planning_date = public.hoy_chile()) AS trips_today,
    (SELECT count(DISTINCT l.business_date) FROM app.closure_lines l
       LEFT JOIN app.closure_periods p ON p.business_date = l.business_date
      WHERE COALESCE(p.status, 'OPEN') <> 'CLOSED'
        AND l.business_date >= COALESCE((SELECT min(business_date) FROM app.closure_signatures), public.hoy_chile())
        AND app.carrier_of(l.subject_type, l.subject_id, l.business_date) = $1) AS open_closure_days
"""


async def deactivation_impact(conn, carrier_id: str) -> dict:
    """Lo que toca dar de baja la empresa, para mostrarlo antes de confirmar (P4)."""
    await _require(conn, "carriers", carrier_id, "Empresa no encontrada")
    return dict(await conn.fetchrow(_IMPACT_SQL, carrier_id))


async def reactivate(conn, carrier_id: str, *, driver_ids: list[str], asset_ids: list[str], actor: str) -> dict:
    """Reactivar eligiendo qué flota vuelve (P3). La empresa vuelve a ACTIVE (y queda
    No habilitada hasta regularizar, porque eso se calcula); la flota que no se eligió
    sale de su roster hoy, con historial."""
    current = await conn.fetchrow(
        "SELECT operational_status, tax_id FROM public.carriers WHERE id = $1 FOR UPDATE", carrier_id)
    if not current:
        raise HTTPException(404, "Empresa no encontrada")
    if current["operational_status"] != "INACTIVE":
        raise HTTPException(409, "Solo se reactiva una empresa dada de baja")
    if not current["tax_id"]:
        raise HTTPException(422, "No se puede activar una empresa sin RUT/tax_id")
    await conn.execute(
        "UPDATE public.carriers SET operational_status = 'ACTIVE', updated_at = NOW() WHERE id = $1", carrier_id)
    await record_manual_edit(
        conn, table="carriers", where={"id": carrier_id}, actor=actor, entity_type="CARRIER",
        entity_id=carrier_id, action="update", field="operational_status",
        old_value="INACTIVE", new_value="ACTIVE",
    )
    kept = {"DRIVER": set(driver_ids), "ASSET": set(asset_ids)}
    released = {"DRIVER": 0, "ASSET": 0}
    for rel in (DRIVER, ASSET):
        roster = await conn.fetch(
            f"SELECT {rel.subject_col}::text AS id FROM public.{rel.table} "
            f"WHERE {rel.counterpart_col} = $1 AND status = 'ACTIVE'", carrier_id)
        for row in roster:
            if row["id"] not in kept[rel.entity_type]:
                await end(conn, rel, row["id"], carrier_id, actor=actor)
                released[rel.entity_type] += 1
    await log_change(conn, actor=actor, entity_type="CARRIER", entity_id=carrier_id, action="reactivate",
                     new_value={"drivers": sorted(kept["DRIVER"]), "assets": sorted(kept["ASSET"])})
    return {"released_drivers": released["DRIVER"], "released_assets": released["ASSET"]}
