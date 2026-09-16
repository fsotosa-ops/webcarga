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
único que persiste un snapshot inmutable.

Tarea 4 (plan Tarea 2.1, minuta 2026-08-03): el roster de este router quedó
acotado a conductores de empresas que operan Tractoreo (ver
TRACTOREO_ROSTER_CTE en ..services.driver_roster) — Equipo Completo NO
entra a este cierre activo por conductor, se sigue cerrando aparte, de
forma pasiva y por tracto, en equipment_closures.py."""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException
from ..auth import get_current_user, require_writer
from ..db import get_pool
from ..schemas.daily_closures import DriverBatchReasonBody, DriverDayStatusPatchBody
from ..services.cierre_lineas import LINEAS_CONDUCTORES, periodo, poner_motivo, recalcular
from ..services.cierre_viajes import SQL_TOTAL_TRIPS_DEL_DIA
from ..services.driver_roster import TRACTOREO_ROSTER_CTE
from .trips import _compliance_alert_lateral, _DRIVER_CRITICAL_DOC_CODES

router = APIRouter(prefix="/daily-closures", tags=["daily-closures"])


def _parse_business_date(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


# El estado de cada conductor ese día (ASSIGNED / UNASSIGNED / MISMATCH) lo
# deriva y lo guarda services/cierre_lineas.py en app.closure_lines, junto con
# los tractos. Este router sólo lee y delega las escrituras.

_DETAIL_SQL = f"""
WITH {TRACTOREO_ROSTER_CTE}
SELECT dds.driver_id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name,
       dds.status, dds.category, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       dds.valid_until, dds.comentario,
       dds.resolved_by, dds.resolved_at,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names,
       dcomp.has_critical_pending AS driver_pending_docs_critical,
       sugg.id AS suggested_reason_id,
       mismatch_trip.trip_id,
       today_trip.trip_id AS today_trip_id,
       -- El numero de viaje del TMS y el local de origen, para que la tabla del
       -- cierre diga de que viaje habla sin obligar a abrirlo. Pablo, 04/09:
       -- *"para no estar adivinando por que esta la patente nomas, no esta el
       -- numero de viaje, nada"*.
       today_trip.source_system_trip_id AS today_trip_code,
       today_trip.origen AS today_trip_origin,
       last_tractor.tractor_plate AS last_known_tractor_plate,
       last_tractor.operation_type AS last_known_operation_type
FROM {LINEAS_CONDUCTORES} dds
JOIN active_roster ar ON ar.driver_id = dds.driver_id
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
-- Centro de Flota (2026-07-28): viaje real que causó el MISMATCH ese día —
-- mismo criterio que _RECOMPUTE_SQL usa para marcar el estado (carrier nulo
-- o distinto al del roster), pero a nivel de una fila puntual en vez de un
-- bool_or agregado. El más reciente si hubo más de uno.
-- Mismos viajes del día que day_trips arriba (app.trips_del_dia): si no, un
-- MISMATCH detectado por un viaje de ayer quedaba con trip_id NULL acá.
LEFT JOIN LATERAL (
    SELECT t.id AS trip_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE vfr.resolved_driver_id = dds.driver_id
      AND t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
      AND t.source_system != 'sodimac'  -- mismo criterio que equipment_closures.py:141
      AND (vfr.resolved_carrier_id IS NULL OR vfr.resolved_carrier_id IS DISTINCT FROM c.id)
    ORDER BY t.status_reported_at DESC NULLS LAST
    LIMIT 1
) mismatch_trip ON true
-- Tarea 5 (plan 2.2, minuta 2026-08-03): "tracto habitual" — mejor
-- esfuerzo. El tracto que aparece acá es el del viaje más reciente
-- resuelto para este conductor, no una asignación exclusiva confirmada;
-- puede venir NULL si el conductor no tiene ningún viaje histórico
-- resuelto. El tipo de operación es el de ESE tracto puntual, no el del
-- roster de la empresa (una empresa Tractoreo puede tener conductores
-- cuyo último viaje fue en un tracto clasificado Equipo Completo, si la
-- empresa opera flota mixta). Alias con sufijo 2 (t2/vfr2/a2/wot2) para no
-- colisionar con t/vfr/a ya usados en el LATERAL de mismatch_trip arriba.
LEFT JOIN LATERAL (
    SELECT a2.license_plate AS tractor_plate, wot2.label AS operation_type
    FROM app.trips t2
    JOIN app.v_trip_fleet_resolution vfr2 ON vfr2.trip_id = t2.id
    LEFT JOIN public.assets a2 ON a2.id = vfr2.resolved_tractor_asset_id
    LEFT JOIN app.status_taxonomies wot2 ON wot2.id = a2.webcarga_operation_type_id
    WHERE vfr2.resolved_driver_id = dds.driver_id
    ORDER BY t2.status_reported_at DESC NULLS LAST
    LIMIT 1
) last_tractor ON true
-- El viaje de HOY de este conductor, sea o no un MISMATCH. Va aparte de
-- `trip_id` a proposito: `trip_id` sale del LATERAL de mismatch y responde
-- "cual es el viaje que contradice a su empresa", asi que para un ASSIGNED
-- sano es NULL por diseno — y la fila quedaba sin "Ver viaje", que es
-- exactamente lo que pidio Pablo el 04/09: *"puedo ver el viaje, pero al
-- pinchar ver el viaje no le puedo asignar el conductor"*. Dos preguntas
-- distintas, dos columnas distintas: un NULL con dos significados es la
-- clase de bug que este proyecto ya vio cinco veces.
LEFT JOIN LATERAL (
    SELECT t3.id AS trip_id, t3.source_system_trip_id, ts3.local AS origen
    FROM app.trips t3
    JOIN app.v_trip_fleet_resolution vfr3 ON vfr3.trip_id = t3.id
    -- El local de origen vive en trip_stops, no en trips.origin_tms — esa
    -- columna esta vacia en las 2.204 filas (medido 2026-09-07) y es de donde
    -- ya lo lee el Diario.
    LEFT JOIN app.trip_stops ts3 ON ts3.trip_id = t3.id AND ts3.stop_type = 'ORIGIN'
    WHERE vfr3.resolved_driver_id = dds.driver_id
      AND t3.id IN (SELECT trip_id FROM app.trips_del_dia($1))
      AND t3.source_system != 'sodimac'
    ORDER BY t3.status_reported_at DESC NULLS LAST
    LIMIT 1
) today_trip ON true
WHERE dds.business_date = $1
ORDER BY d.full_name
"""


# Reportería (spec 2026-07-21-cuadratura-reporteria-redesign-design.md):
# dataset plano sobre un RANGO de fechas, sin recompute — es una vista de
# lectura sobre lo que ya quedó calculado (típicamente al cerrar cada día),
# no fuerza el cálculo en vivo de días pasados. El pivot (filas/columnas/
# filtros/granularidad de fecha) se arma 100% en el cliente sobre este
# dataset — evita ida y vuelta al backend por cada cambio de la tabla dinámica.
_REPORT_SQL = f"""
WITH {TRACTOREO_ROSTER_CTE}
SELECT dds.driver_id, dds.business_date, d.full_name, d.tax_id, c.business_name AS carrier_name,
       dds.status, dds.category, dds.unassigned_reason_id, ur.label AS unassigned_reason_label,
       COALESCE(clients.client_names, ARRAY[]::text[]) AS client_names
FROM {LINEAS_CONDUCTORES} dds
JOIN active_roster ar ON ar.driver_id = dds.driver_id
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


async def _recompute(pool, business_date: _date) -> dict | None:
    """None si el día está cerrado: un día firmado no se recalcula."""
    return await recalcular(pool, business_date)


@router.get("")
async def get_daily_closure_status(fecha: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    business_date = _parse_business_date(fecha)
    pre_cierre = await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    drivers = [dict(r) for r in rows]

    # El estado del día sale del período, no de una cabecera por eje: un día
    # está cerrado o abierto, no "cerrado en conductores y abierto en tractos".
    info = await periodo(pool, business_date)
    cerrado = bool(info and info["status"] == "CLOSED")
    totales = (info or {}).get("frozen_totals") or {}
    closure_dict = {
        "closed_by": info["closed_by"],
        "closed_by_name": info["closed_by_name"],
        "closed_at": info["closed_at"],
        "total_drivers": totales.get("conductores"),
        "resolved_count": totales.get("conductores_resueltos"),
        "override_count": info["override_count"],
        "total_trips": totales.get("viajes"),
    } if cerrado else None

    assigned = sum(1 for d in drivers if d["status"] == "ASSIGNED")
    unassigned = [d for d in drivers if d["status"] == "UNASSIGNED"]
    mismatch = [d for d in drivers if d["status"] == "MISMATCH"]
    unassigned_without_reason = [d for d in unassigned if d["category"] == "SIN_RESOLVER"]

    # El dia sigue cerrado: la firma sigue siendo verdadera sobre lo que
    # existia cuando se firmo, y no se recalcula. Lo que llega despues es un
    # delta -- "posterior al cierre" -- que se resuelve aparte, sin invalidar
    # la firma original.
    total_trips_al_firmar = closure_dict.get("total_trips") if closure_dict else None
    posteriores_al_cierre = 0
    if total_trips_al_firmar is not None:
        ahora = await pool.fetchval(SQL_TOTAL_TRIPS_DEL_DIA, business_date)
        posteriores_al_cierre = max(0, ahora - total_trips_al_firmar)

    return {
        "business_date": business_date.isoformat(),
        "closed": cerrado,
        "closure": closure_dict,
        "periodo": info,
        "cierre": {
            "total_trips_al_firmar": total_trips_al_firmar,
            "posteriores_al_cierre": posteriores_al_cierre,
        },
        "total_drivers": len(drivers),
        "assigned_count": assigned,
        "unassigned_count": len(unassigned),
        "mismatch_count": len(mismatch),
        "pending_count": len(unassigned_without_reason) + len(mismatch),
        "drivers": drivers,
        "pre_cierre": pre_cierre,
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


# QUIEN PUEDE ESCRIBIR. `require_writer` y no `require_editor` desde el
# 2026-09-07, por definicion del usuario: *"ambos pueden hacer cierres de
# viaje"*. `writer` es el rol de quien opera el Diario todos los dias.
#
# Las reglas (404, 422, vigencia, dia cerrado, propagacion al tracto) viven en
# services/cierre_lineas.poner_motivo: son las mismas para los dos ejes.
@router.patch("/reason")
async def set_batch_reason(
    body: DriverBatchReasonBody, fecha: str, pool=Depends(get_pool), user=Depends(require_writer),
):
    """Selección masiva con checkbox — mismo motivo para varios conductores en
    un clic. Declarada ANTES de PATCH /{driver_id}: la ruta literal debe
    ganarle a la ruta con path param."""
    business_date = _parse_business_date(fecha)
    await poner_motivo(
        pool, business_date, "DRIVER", body.driver_ids,
        campos=body.model_fields_set, reason_id=body.unassigned_reason_id,
        valid_until=body.valid_until, comentario=body.comentario, user=user,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    pedidos = set(body.driver_ids)
    return [dict(r) for r in rows if str(r["driver_id"]) in pedidos]


@router.patch("/{driver_id}")
async def patch_driver_day_status(
    driver_id: str, fecha: str, body: DriverDayStatusPatchBody,
    pool=Depends(get_pool), user=Depends(require_writer),
):
    """El motivo, su vigencia y el comentario de un conductor ese día."""
    business_date = _parse_business_date(fecha)
    await _recompute(pool, business_date)
    await poner_motivo(
        pool, business_date, "DRIVER", [driver_id],
        campos=body.model_fields_set, reason_id=body.unassigned_reason_id,
        valid_until=body.valid_until, comentario=body.comentario, user=user,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    return next((dict(r) for r in rows if str(r["driver_id"]) == driver_id), None)
