"""Cuadratura diaria de conductores (Fase 1 del plan de refinamiento del
backlog de 17 HU, 2026-07-21 — ver AGENTLOG.md, HU-01/02/03).

Concepto tomado literal de la reunión del 20/07 con Pablo (CEO): "cuadrar
la caja" — todo conductor activo debe quedar clasificado al cierre del día
(asignado/no asignado con motivo/mismatch de flota), y el resultado queda
guardado en app.daily_closures para que se pueda revisar el descuadre de
días anteriores.

app.driver_day_status se recalcula en cada GET (mismo criterio "resolución
en vivo" ya usado en trips.py — evita watermarks incrementales), pero
preserva unassigned_reason_id/resolved_by/resolved_at ya capturados a mano
mientras el conductor siga UNASSIGNED. El cierre (POST .../close) es lo
único que persiste un snapshot inmutable."""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException
from ..auth import ADMIN_ROLES, get_current_user, require_editor
from ..db import get_pool
from ..schemas.daily_closures import CloseDayBody, DriverDayStatusPatchBody
from ..services.audit import log_change
from .trips import _compliance_alert_lateral, _DRIVER_CRITICAL_DOC_CODES

router = APIRouter(prefix="/daily-closures", tags=["daily-closures"])


def _parse_business_date(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


# Roster activo + viajes del día: mismo criterio que available_drivers en
# trips.py (public.driver_assignments/carriers ACTIVE). MISMATCH es la
# subcategoría de HU-04 (Fase 0) llevada al grano conductor×día: cualquier
# viaje del conductor ese día sin empresa resuelta, o con una empresa
# distinta a la propia, tira todo el día a MISMATCH — necesita
# regularización antes de poder cerrarse limpio.
#
# BUG REAL corregido 2026-07-22 (reportado por el usuario: "no veo
# conductores asignados si el Diario reporta viajes con conductores"):
# day_trips solo miraba trip_fleet_links.driver_id, sin replicar el mismo
# fallback en vivo que ya usa _TRIP_FROM/available_drivers en trips.py —
# y trip_fleet_links no tiene ninguna fila nueva desde el 2026-07-19 (nada
# la puebla para viajes que llegan del TMS, solo existía el bootstrap
# histórico + altas manuales). Se agrega la misma cadena de resolución en
# vivo (patente → public.assets → vehicle_driver_assignments), MÁS un
# tercer nivel nuevo confirmado con el usuario: si ninguno de los dos
# anteriores resuelve pero el nombre que reporta el TMS coincide EXACTO
# (case-insensitive) con un conductor real del roster, se toma como
# asignado — mismo nivel de confianza que ya usa trips.py para MOSTRAR ese
# nombre en el Diario, no una regla nueva más laxa.
_RECOMPUTE_SQL = """
WITH active_roster AS (
    SELECT d.id AS driver_id, da.carrier_id AS home_carrier_id
    FROM public.drivers d
    JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
    JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
),
-- Fase B (ítem 5, feedback post-weekly 2026-07-22): la cadena de
-- resolución (stored → auto por patente → auto por
-- vehicle_driver_assignments → match exacto de nombre) vivía inline acá y
-- en 3 lugares más (_TRIP_FROM, available_drivers, available_assets en
-- trips.py) — la duplicación fue justo la causa del bug que esta misma
-- ronda arregló acá (Ronda 38). Consolidada en app.v_trip_fleet_resolution
-- (migración 20260722030000) para que no vuelva a divergir.
day_trips AS (
    SELECT
        t.id AS trip_id,
        vfr.resolved_driver_id AS driver_id,
        vfr.resolved_carrier_id AS trip_carrier_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE t.planning_date = $1
),
computed AS (
    SELECT
        r.driver_id,
        CASE
            WHEN count(dt.trip_id) > 0
                 AND bool_or(dt.trip_carrier_id IS NULL OR dt.trip_carrier_id IS DISTINCT FROM r.home_carrier_id)
                THEN 'MISMATCH'
            WHEN count(dt.trip_id) > 0 THEN 'ASSIGNED'
            ELSE 'UNASSIGNED'
        END AS status
    FROM active_roster r
    LEFT JOIN day_trips dt ON dt.driver_id = r.driver_id
    GROUP BY r.driver_id, r.home_carrier_id
)
INSERT INTO app.driver_day_status (driver_id, business_date, status, computed_at)
SELECT driver_id, $1, status, now() FROM computed
ON CONFLICT (driver_id, business_date) DO UPDATE SET
    status = EXCLUDED.status,
    computed_at = EXCLUDED.computed_at,
    -- Un motivo capturado a mano solo sigue teniendo sentido si el
    -- conductor sigue UNASSIGNED — si ahora tiene viaje o mismatch, el
    -- motivo viejo queda obsoleto.
    unassigned_reason_id = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.driver_day_status.unassigned_reason_id ELSE NULL END,
    resolved_by = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.driver_day_status.resolved_by ELSE NULL END,
    resolved_at = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.driver_day_status.resolved_at ELSE NULL END
"""

_DETAIL_SQL = f"""
SELECT dds.driver_id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name,
       dds.status, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       dds.resolved_by, dds.resolved_at,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names,
       dcomp.has_critical_pending AS driver_pending_docs_critical,
       sugg.id AS suggested_reason_id
FROM app.driver_day_status dds
JOIN public.drivers d ON d.id = dds.driver_id
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
-- Fase 1.5 (2026-07-21): cliente(s) que el conductor sirvió ese día — el
-- denominador común de los 3 reportes manuales hoy armados a mano
-- (Sider/Lansa, Sodimac, Walmart todos pivotean por EETT y/o cliente).
-- Resuelve vía public.shippers para un nombre prolijo, mismo criterio ya
-- usado en trips.py (_TRIP_FROM) — client_name crudo del TMS puede venir
-- con mayúsculas/minúsculas inconsistentes.
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name)) AS client_names
    FROM app.trip_fleet_links fl
    JOIN app.trips t ON t.id = fl.trip_id
    LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
) clients ON true
{_compliance_alert_lateral('dcomp', 'DRIVER', 'dds.driver_id', _DRIVER_CRITICAL_DOC_CODES)}
-- Tarea 5 (status_taxonomies, Ronda 44): sugerencia de UI cuando el
-- conductor tiene documentación LEGAL_MANDATORY crítica vencida — el
-- operador confirma con un click en CloseDayDialog, no se escribe solo.
LEFT JOIN app.status_taxonomies sugg
       ON sugg.domain = 'DRIVER_REASON' AND sugg.suggested_alert_source = 'compliance_expired' AND sugg.active = true
WHERE dds.business_date = $1
ORDER BY d.full_name
"""


# Reportería (spec 2026-07-21-cuadratura-reporteria-redesign-design.md):
# dataset plano sobre un RANGO de fechas, sin recompute — es una vista de
# lectura sobre lo que ya quedó calculado (típicamente al cerrar cada día),
# no fuerza el cálculo en vivo de días pasados. El pivot (filas/columnas/
# filtros/granularidad de fecha) se arma 100% en el cliente sobre este
# dataset — evita ida y vuelta al backend por cada cambio de la tabla dinámica.
_REPORT_SQL = """
SELECT dds.driver_id, dds.business_date, d.full_name, d.tax_id, c.business_name AS carrier_name,
       dds.status, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names
FROM app.driver_day_status dds
JOIN public.drivers d ON d.id = dds.driver_id
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT COALESCE(sh.name, t.client_name)) AS client_names
    FROM app.trip_fleet_links fl
    JOIN app.trips t ON t.id = fl.trip_id
    LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE fl.driver_id = dds.driver_id AND t.planning_date = dds.business_date AND t.client_name IS NOT NULL
) clients ON true
WHERE dds.business_date BETWEEN $1 AND $2
ORDER BY dds.business_date, d.full_name
"""


async def _recompute(pool, business_date: _date) -> None:
    await pool.execute(_RECOMPUTE_SQL, business_date)


@router.get("")
async def get_daily_closure_status(fecha: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    business_date = _parse_business_date(fecha)
    await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    drivers = [dict(r) for r in rows]

    closure = await pool.fetchrow(
        "SELECT closed_by, closed_at, total_drivers, resolved_count, override_count "
        "FROM app.daily_closures WHERE business_date = $1",
        business_date,
    )

    assigned = sum(1 for d in drivers if d["status"] == "ASSIGNED")
    unassigned = [d for d in drivers if d["status"] == "UNASSIGNED"]
    mismatch = [d for d in drivers if d["status"] == "MISMATCH"]
    unassigned_without_reason = [d for d in unassigned if not d["unassigned_reason_id"]]

    return {
        "business_date": business_date.isoformat(),
        "closed": closure is not None,
        "closure": dict(closure) if closure else None,
        "total_drivers": len(drivers),
        "assigned_count": assigned,
        "unassigned_count": len(unassigned),
        "mismatch_count": len(mismatch),
        "pending_count": len(unassigned_without_reason) + len(mismatch),
        "drivers": drivers,
    }


@router.get("/report")
async def get_daily_closures_report(
    fecha_desde: str, fecha_hasta: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Dataset plano para Reportería — sin agregar, sin recompute. El rango
    puede abarcar días que nunca se cerraron explícitamente (quedan con lo
    último calculado, o ausentes si ese día nunca se abrió ni una vez)."""
    desde = _parse_business_date(fecha_desde)
    hasta = _parse_business_date(fecha_hasta)
    if desde > hasta:
        raise HTTPException(422, "fecha_desde no puede ser posterior a fecha_hasta")

    rows = await pool.fetch(_REPORT_SQL, desde, hasta)
    return {
        "fecha_desde": desde.isoformat(),
        "fecha_hasta": hasta.isoformat(),
        "rows": [dict(r) for r in rows],
    }


@router.patch("/{driver_id}")
async def patch_driver_day_status(
    driver_id: str, fecha: str, body: DriverDayStatusPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    """Captura el motivo de no asignación (HU-02) — el punto de captura
    estructurado que pidió el usuario explícitamente (reusa app.unassigned_reasons,
    no texto libre)."""
    business_date = _parse_business_date(fecha)
    await _recompute(pool, business_date)

    row = await pool.fetchrow(
        "SELECT status FROM app.driver_day_status WHERE driver_id = $1 AND business_date = $2",
        driver_id, business_date,
    )
    if not row:
        raise HTTPException(404, "Conductor no encontrado en la cuadratura de ese día")
    if row["status"] != "UNASSIGNED":
        raise HTTPException(422, "Solo se puede registrar motivo para un conductor no asignado")

    await pool.execute(
        """
        UPDATE app.driver_day_status
        SET unassigned_reason_id = $1, resolved_by = $2::uuid, resolved_at = now()
        WHERE driver_id = $3 AND business_date = $4
        """,
        body.unassigned_reason_id, user["sub"], driver_id, business_date,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    updated = next((dict(r) for r in rows if r["driver_id"] == driver_id or str(r["driver_id"]) == driver_id), None)
    return updated


@router.post("/close")
async def close_day(fecha: str, body: CloseDayBody, pool=Depends(get_pool), user=Depends(require_editor)):
    """Bloqueo real de HU-03 — requisito explícito y no negociable de Pablo
    ("si no cierra el proceso lógico, el sistema debería no dejarlos
    avanzar"). El override (HU-03 + el riesgo "deadlock operativo" del
    refinamiento) reusa public.audit_log en vez de un esquema de
    excepciones nuevo — requiere rol admin/owner y un comentario
    obligatorio, uno por conductor pendiente."""
    business_date = _parse_business_date(fecha)
    await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    drivers = [dict(r) for r in rows]
    pending = [
        d for d in drivers
        if d["status"] == "MISMATCH" or (d["status"] == "UNASSIGNED" and not d["unassigned_reason_id"])
    ]

    if pending and not body.override:
        raise HTTPException(
            409,
            {
                "message": f"{len(pending)} conductor(es) sin resolver — no se puede cerrar el día",
                "pending": [{"driver_id": str(d["driver_id"]), "full_name": d["full_name"], "status": d["status"]} for d in pending],
            },
        )

    if pending and body.override:
        if user["role"] not in ADMIN_ROLES:
            raise HTTPException(403, "Forzar el cierre con pendientes requiere rol admin o superior")
        if not body.override_note or not body.override_note.strip():
            raise HTTPException(422, "El override requiere un comentario de justificación")
        async with pool.acquire() as conn:
            async with conn.transaction():
                for d in pending:
                    await log_change(
                        conn, actor=user["sub"], entity_type="DRIVER", entity_id=d["driver_id"],
                        action="cuadratura_override", field="status",
                        old_value=d["status"],
                        new_value={"business_date": business_date.isoformat(), "note": body.override_note},
                    )

    await pool.execute(
        """
        INSERT INTO app.daily_closures (business_date, closed_by, total_drivers, resolved_count, override_count)
        VALUES ($1, $2::uuid, $3, $4, $5)
        ON CONFLICT (business_date) DO UPDATE SET
            closed_by = EXCLUDED.closed_by, closed_at = now(),
            total_drivers = EXCLUDED.total_drivers, resolved_count = EXCLUDED.resolved_count,
            override_count = EXCLUDED.override_count
        """,
        business_date, user["sub"], len(drivers), len(drivers) - len(pending), len(pending) if body.override else 0,
    )
    return {"ok": True, "business_date": business_date.isoformat(), "overridden": len(pending) if body.override else 0}
