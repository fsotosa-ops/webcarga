"""Anular viajes manuales con motivo: una regla, un lugar (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza al borrado físico (eliminar_viajes.py). El viaje queda, con quién, cuándo y
por qué se anuló; app.trips_del_dia y los viajes del día (SQL_VIAJES_DEL_DIA) lo
excluyen, así que el Cierre, el reporte y los disponibles dejan de contarlo.

Qué: sólo lo que la app creó (source_system = 'manual'). Un viaje del TMS vuelve en
la próxima ingesta: anularlo sería mentir.

Quién, según los días firmados que el viaje toca:
  - ninguno: quien lo creó (app.trips_manual.created_by) o trips.void_any;
  - alguno: closures.sign. Toca un día firmado si es su día (planning_date, el que
    firma sus viajes) o si cuenta en él por sus marcas (app.trips_del_dia, la cota
    de 45 días). El día NO se reabre: la firma es una copia inmutable
    (app.closure_signatures) y la anulación aparece como ajuste posterior al cierre.
Revertir pide lo mismo. Un viaje anulado ya no está en trips_del_dia, así que al
revertir sólo se ve su propio día.

La regla que decide `can_void` en el listado es `_bloqueo`, la misma que aplica la
escritura: la UI nunca ofrece algo que el backend va a rechazar.

Escribe app.trips_manual y app.trips en la misma transacción: app.trips se reconstruye
desde trips_manual (rama manual del modelo dbt), y el merge no toca estas columnas
(merge_exclude_columns), igual que unassigned_reason_id.
"""
from __future__ import annotations

from fastapi import HTTPException

from .audit import log_change

MAXIMO_POR_LOTE = 200

# Columnas que el listado y el detalle agregan a cada viaje para decidir sin otra
# consulta. `dias_firmados` sólo se calcula para viajes manuales: son pocos, y así el
# listado no paga un EXISTS por cada viaje del TMS.
SQL_COLUMNAS_ANULABLE = """
    tm.created_by::text AS manual_created_by,
    t.voided_at, t.void_reason,
    void_by.full_name AS voided_by_name,
    CASE WHEN t.source_system = 'manual' THEN ARRAY(
        SELECT cp.business_date
        FROM app.closure_periods cp
        WHERE cp.status = 'CLOSED'
          -- la misma cota de 45 días que usa app.trips_del_dia
          AND cp.business_date BETWEEN t.planning_date AND t.planning_date + 45
          AND (cp.business_date = t.planning_date
               OR t.id IN (SELECT trip_id FROM app.trips_del_dia(cp.business_date)))
        ORDER BY cp.business_date
    ) END AS dias_firmados
"""

SQL_JOIN_ANULABLE = """
    LEFT JOIN app.trips_manual tm ON tm.id = t.id
    LEFT JOIN public.profiles void_by ON void_by.id = t.voided_by
"""


def _bloqueo(fila: dict, user: dict, *, revertir: bool) -> tuple[int, str] | None:
    """(status HTTP, motivo en español) si `user` NO puede anular (o revertir) el viaje."""
    if fila.get("source_system") != "manual":
        return 409, "Sólo se pueden anular viajes creados manualmente en la app"
    if revertir and fila.get("voided_at") is None:
        return 409, "El viaje no está anulado"
    if not revertir and fila.get("voided_at") is not None:
        return 409, "El viaje ya está anulado"
    permisos = user.get("permissions", ())
    firmados = fila.get("dias_firmados") or []
    if firmados:
        if "closures.sign" in permisos:
            return None
        dias = ", ".join(d.strftime("%d/%m") for d in firmados)
        return 403, f"Toca el cierre firmado del {dias}: lo anula quien puede firmar el cierre"
    if "trips.void_any" not in permisos and fila.get("manual_created_by") != user.get("sub"):
        return 403, "Sólo quien creó el viaje o Administración puede anularlo"
    return None


def anotar_anulable(d: dict, user: dict) -> None:
    """Deja en el viaje `can_void`, `void_blocked_reason` y `can_revert_void`, y quita
    las columnas de apoyo (no son parte del contrato)."""
    anulado = d.get("voided_at") is not None
    bloqueo = _bloqueo(d, user, revertir=anulado)
    d["can_void"] = not anulado and bloqueo is None
    d["void_blocked_reason"] = None if anulado or bloqueo is None else bloqueo[1]
    d["can_revert_void"] = anulado and bloqueo is None
    d.pop("manual_created_by", None)
    d.pop("dias_firmados", None)


async def _validar(conn, trip_ids: list[str], user: dict, *, revertir: bool) -> list[str]:
    ids = list(dict.fromkeys(trip_ids))
    if not ids:
        raise HTTPException(422, "Selecciona al menos un viaje")
    if len(ids) > MAXIMO_POR_LOTE:
        raise HTTPException(422, f"Máximo {MAXIMO_POR_LOTE} viajes por anulación")
    # FOR UPDATE: que nadie edite ni firme el día de estos viajes mientras se decide.
    filas = await conn.fetch(
        f"""
        SELECT t.id::text AS id, t.source_system, t.planning_date, {SQL_COLUMNAS_ANULABLE}
        FROM app.trips t
        {SQL_JOIN_ANULABLE}
        WHERE t.id = ANY($1::uuid[])
        FOR UPDATE OF t
        """,
        ids,
    )
    por_id = {f["id"]: dict(f) for f in filas}
    errores, estados = [], set()
    for tid in ids:
        fila = por_id.get(tid)
        bloqueo = (404, "Viaje no encontrado") if fila is None else _bloqueo(fila, user, revertir=revertir)
        if bloqueo:
            estados.add(bloqueo[0])
            errores.append({"trip_id": tid, "error": bloqueo[1]})
    if errores:
        accion = "revirtió" if revertir else "anuló"
        # Un solo tipo de rechazo conserva su status; una mezcla es conflicto.
        raise HTTPException(
            estados.pop() if len(estados) == 1 else 409,
            {"message": f"No se {accion} ningún viaje", "errors": errores},
        )
    return ids


async def anular_viajes(conn, trip_ids: list[str], reason: str, user: dict) -> int:
    """Anula los viajes, todo o nada. Debe correr dentro de una transacción."""
    motivo = (reason or "").strip()
    if not motivo:
        raise HTTPException(422, "Anular exige un motivo")
    ids = await _validar(conn, trip_ids, user, revertir=False)
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = now(), voided_by = $2::uuid, void_reason = $3 "
            "WHERE id = ANY($1::uuid[])",
            ids, user["sub"], motivo,
        )
    for tid in ids:
        await log_change(conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                         action="void", field="voided_at", new_value={"reason": motivo})
    return len(ids)


async def revertir_anulacion(conn, trip_ids: list[str], user: dict) -> int:
    """Devuelve los viajes al día, todo o nada. Debe correr dentro de una transacción."""
    ids = await _validar(conn, trip_ids, user, revertir=True)
    anteriores = {r["id"]: r["void_reason"] for r in await conn.fetch(
        "SELECT id::text, void_reason FROM app.trips WHERE id = ANY($1::uuid[])", ids)}
    for tabla in ("app.trips_manual", "app.trips"):
        await conn.execute(
            f"UPDATE {tabla} SET voided_at = NULL, voided_by = NULL, void_reason = NULL "
            "WHERE id = ANY($1::uuid[])",
            ids,
        )
    for tid in ids:
        await log_change(conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                         action="void_revert", field="voided_at", old_value={"reason": anteriores.get(tid)})
    return len(ids)
