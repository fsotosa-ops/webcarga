"""Cierre del día por TRACTO/EQUIPO (Fase 4, HU-03). Reemplaza a
daily_closures.py (cierre por conductor) como el flujo que la UI usa —
confirmado contra HU_CierreDelDia_Diario2.md (30/07, supera a la HU de
conductores del 20/07): "El sistema lista todos los tractos SIN CARGA del
día" / "El cierre de tractoreo es ACTIVO... registrar el motivo de cada
tracto sin asignar es obligatorio" / "El cierre de equipos completos es
PASIVO". daily_closures.py NO se toca ni se borra — queda intacto, sin uso
desde la UI.

BLOQUE 1 (Tractoreo, activo): tractos SIN CARGA que exigen motivo antes de
poder cerrar — incluye también "Sin clasificar" (decisión confirmada
2026-08-02: más riguroso tratarlo como Tractoreo que dejarlo pasar en
silencio cuando el tracto no tiene `webcarga_operation_type_id` clasificado).
BLOQUE 2 (Equipos Completos, pasivo): resumen por empresa, sin intervención
requerida.

Clasificación Tractoreo/Equipo Completo — corregida 2026-08-03 (Ronda 85,
sobre la Ronda 80 que había mapeado la columna equivocada): vive en
`public.assets.webcarga_operation_type_id` (columna E del Excel de
vehículos, "Tipo de Operación WebCarga", dominio `WEBCARGA_OPERATION_TYPE`
con solo 2 valores: Tractoreo/Equipo Completo). NO es lo mismo que
`fleet_service_type_id` (columna D, "Tipo Vehículo", dominio
`FLEET_SERVICE_TYPE`, describe el SUBTIPO físico del vehículo — Furgón
Seco/Sider/etc., sin el prefijo "Equipo Completo" desde la Ronda 85). Son
conceptos hermanos: confirmado con datos reales que 36 TRACTOCAMIONES
(rol físico "Tractoreo" en columna D) operan bajo un arreglo "Equipo
Completo" de WebCarga (columna E) — un tracto puede ser físicamente un
tracto y aun así contar como parte de un equipo completo para el negocio.
"""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_writer
from ..db import get_pool
from ..schemas.equipment_closures import EquipmentBatchReasonBody, EquipmentDayStatusPatchBody
from ..services.cierre_lineas import LINEAS_TRACTOS, periodo, poner_motivo, recalcular

router = APIRouter(prefix="/equipment-closures", tags=["equipment-closures"])


def _parse_business_date(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


# El estado de cada tracto ese día (ASSIGNED / UNASSIGNED) y si exige motivo
# lo deriva y lo guarda services/cierre_lineas.py en app.closure_lines, junto
# con los conductores. Este router sólo lee y delega las escrituras.

_DETAIL_SQL = f"""
SELECT
    eds.asset_id, a.license_plate AS tractor_plate, c.id AS carrier_id, c.business_name AS carrier_name,
    -- "Tipo Vehículo" (Ronda 80/82) — columna nueva del Excel de vehículos,
    -- se muestra junto al tracto en la tabla de cierre para que el
    -- coordinador vea la misma clasificación que ya decide el bloque.
    st.label AS fleet_service_type_label, st.bg_color AS fleet_service_type_bg_color,
    st.text_color AS fleet_service_type_text_color,
    eds.status, eds.category, eds.requires_motivo, eds.unassigned_reason_id, ur.label AS unassigned_reason_label,
    eds.valid_until, eds.comentario,
    eds.resolved_by, eds.resolved_at,
    -- Conductor habitual del equipo (sigue mostrándose junto al tracto,
    -- HU-03 §BLOQUE 1 — ya no es la unidad que se cierra, ver docstring).
    sd.driver_id, sd.full_name AS driver_name,
    -- "CD de origen" — no existe un CD habitual por equipo/empresa en el
    -- modelo hoy (mismo gap documentado en Fase 2); mejor esfuerzo: el
    -- origen de su viaje más reciente, sea de hoy o no.
    last_origin.local AS last_known_origin,
    -- Viaje de HOY (Tarea de paridad Equipo Completo, 2026-08-04): mismo
    -- criterio que day_trips en daily_closures.py — necesario para que
    -- "Ver viaje" funcione en la fila de un equipo ASSIGNED, igual que ya
    -- funciona para un conductor Tractoreo.
    today_trip.trip_id,
    -- Conductor DEL VIAJE de hoy, que no es lo mismo que el habitual de
    -- arriba. Van en campos distintos a proposito: `driver_name` responde
    -- "quien maneja normalmente este tracto" (maestro, cobertura baja) y
    -- `trip_driver_name` responde "quien lo manejo hoy" (el viaje). Pablo,
    -- 04/09: *"En el viaje si esta asignado el conductor... pero aqui
    -- desaparece sin conductor"* — leia el primero creyendo el segundo.
    today_trip.trip_driver_id,
    today_trip.trip_driver_name,
    -- Mismo par que en el cierre por conductor: el numero de viaje del TMS y
    -- el local de origen de HOY. `last_known_origin` de arriba es otra cosa
    -- —el origen del viaje mas reciente, sea de hoy o no— y por eso no se
    -- reusa: dos preguntas, dos columnas.
    today_trip.source_system_trip_id AS today_trip_code,
    today_trip.origen AS today_trip_origin,
    -- Generador de carga (quien pone la carga: Walmart, Iansa, Colun). Sale
    -- del MISMO lateral que ya lee app.trips, no de una consulta nueva. El
    -- eje de conductores lo tiene desde el 21/07 como `client_names` y este
    -- no lo tenia: el coordinador veia la patente y la empresa de transporte,
    -- y no para quien era la carga.
    today_trip.client_name AS today_trip_client
FROM {LINEAS_TRACTOS} eds
JOIN public.assets a ON a.id = eds.asset_id
LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = aa.carrier_id
LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
LEFT JOIN app.status_taxonomies ur ON ur.id = eds.unassigned_reason_id
LEFT JOIN LATERAL (
    SELECT vda.driver_id, d.full_name
    FROM public.vehicle_driver_assignments vda
    JOIN public.drivers d ON d.id = vda.driver_id
    WHERE vda.asset_id = eds.asset_id AND vda.status = 'ACTIVE'
    LIMIT 1
) sd ON true
LEFT JOIN LATERAL (
    SELECT ts.local
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    JOIN app.trip_stops ts ON ts.trip_id = t.id AND ts.stop_type = 'ORIGIN'
    WHERE vfr.resolved_tractor_asset_id = eds.asset_id
    ORDER BY t.status_reported_at DESC NULLS LAST
    LIMIT 1
) last_origin ON true
LEFT JOIN LATERAL (
    SELECT t.id AS trip_id, vfr.resolved_driver_id AS trip_driver_id, td.full_name AS trip_driver_name,
           t.source_system_trip_id, ts_o.local AS origen,
           COALESCE(sh.name, t.client_name) AS client_name
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    LEFT JOIN public.drivers td ON td.id = vfr.resolved_driver_id
    -- Mismo criterio que daily_closures.py y trips.py (_TRIP_FROM): el
    -- client_name crudo del TMS viene en minusculas ("walmart"), y
    -- public.shippers tiene el nombre prolijo.
    LEFT JOIN public.shippers sh
           ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    -- Mismo motivo que en daily_closures: trips.origin_tms esta vacia.
    LEFT JOIN app.trip_stops ts_o ON ts_o.trip_id = t.id AND ts_o.stop_type = 'ORIGIN'
    WHERE vfr.resolved_tractor_asset_id = eds.asset_id
      AND t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
      AND t.source_system != 'sodimac'
    ORDER BY t.status_reported_at DESC NULLS LAST
    LIMIT 1
) today_trip ON true
WHERE eds.business_date = $1
ORDER BY a.license_plate
"""


async def _recompute(pool, business_date: _date) -> dict | None:
    """None si el día está cerrado: un día firmado no se recalcula."""
    return await recalcular(pool, business_date)


@router.get("")
async def get_equipment_closure_status(fecha: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    business_date = _parse_business_date(fecha)
    pre_cierre = await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    equipment = [dict(r) for r in rows]

    info = await periodo(pool, business_date)
    cerrado = bool(info and info["status"] == "CLOSED")
    totales = (info or {}).get("frozen_totals") or {}

    tractoreo = [e for e in equipment if e["requires_motivo"]]
    equipos_completos = [e for e in equipment if not e["requires_motivo"]]

    def _summary(items: list[dict]) -> dict:
        assigned = sum(1 for e in items if e["status"] == "ASSIGNED")
        total = len(items)
        return {
            "total": total, "assigned": assigned, "unassigned": total - assigned,
            "utilization_pct": round(assigned / total * 100, 1) if total else 0.0,
        }

    tractoreo_pending = [e for e in tractoreo if e["category"] == "SIN_RESOLVER"]

    # BLOQUE 2 (pasivo) — resumen por empresa, HU-03: "Empresa X — 7 equipos
    # enrolados / 2 asignados / 5 no asignados".
    by_carrier: dict[str, dict] = {}
    for e in equipos_completos:
        key = e["carrier_id"] or "sin_empresa"
        bucket = by_carrier.setdefault(key, {
            "carrier_id": e["carrier_id"], "carrier_name": e["carrier_name"],
            "enrolled": 0, "assigned": 0, "unassigned": 0,
        })
        bucket["enrolled"] += 1
        bucket["assigned" if e["status"] == "ASSIGNED" else "unassigned"] += 1

    return {
        "business_date": business_date.isoformat(),
        "closed": cerrado,
        "closure": {
            "closed_by": info["closed_by"],
            "closed_by_name": info["closed_by_name"],
            "closed_at": info["closed_at"],
            "total_equipment": totales.get("tractos"),
            "resolved_count": totales.get("tractos_resueltos"),
            "override_count": info["override_count"],
        } if cerrado else None,
        "periodo": info,
        "tractoreo": {
            "summary": _summary(tractoreo),
            "equipment": tractoreo,
            "pending_count": len(tractoreo_pending),
        },
        "equipos_completos": {
            "summary": _summary(equipos_completos),
            "by_carrier": sorted(by_carrier.values(), key=lambda b: b["carrier_name"] or ""),
            # Fila plana por equipo (paridad con tractoreo.equipment, pedido
            # explícito del usuario 2026-08-04): "Flota del día" la necesita
            # para mostrar conductor/equipo habitual/estado editable en la
            # vista Equipo Completo con la misma estructura que Tractoreo.
            "equipment": equipos_completos,
        },
        "pre_cierre": pre_cierre,
    }


# QUIEN PUEDE ESCRIBIR: `require_writer` (definicion del usuario, 07/09). Las
# reglas viven en services/cierre_lineas.poner_motivo, iguales para los dos ejes.
@router.patch("/reason")
async def set_batch_reason(
    body: EquipmentBatchReasonBody, fecha: str, pool=Depends(get_pool), user=Depends(require_writer),
):
    """Selección masiva con checkbox — mismo motivo para varios tractos en un
    clic. Declarada ANTES de PATCH /{asset_id}."""
    business_date = _parse_business_date(fecha)
    await poner_motivo(
        pool, business_date, "ASSET", body.asset_ids,
        campos=body.model_fields_set, reason_id=body.unassigned_reason_id,
        valid_until=body.valid_until, comentario=body.comentario, user=user,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    pedidos = set(body.asset_ids)
    return [dict(r) for r in rows if str(r["asset_id"]) in pedidos]


@router.patch("/{asset_id}")
async def patch_equipment_day_status(
    asset_id: str, fecha: str, body: EquipmentDayStatusPatchBody,
    pool=Depends(get_pool), user=Depends(require_writer),
):
    """El motivo, su vigencia y el comentario de un tracto ese día."""
    business_date = _parse_business_date(fecha)
    await poner_motivo(
        pool, business_date, "ASSET", [asset_id],
        campos=body.model_fields_set, reason_id=body.unassigned_reason_id,
        valid_until=body.valid_until, comentario=body.comentario, user=user,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    return next((dict(r) for r in rows if str(r["asset_id"]) == asset_id), None)
