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

from ..auth import ADMIN_ROLES, get_current_user, require_editor
from ..db import get_pool
from ..schemas.equipment_closures import CloseEquipmentDayBody, EquipmentBatchReasonBody
from ..services.audit import log_change
from ..services.pre_cierre import run_pre_cierre

router = APIRouter(prefix="/equipment-closures", tags=["equipment-closures"])


def _parse_business_date(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


# "Con carga hoy" — mismo criterio verificado en Fase 0.1/Fase 2
# (planning_date=fecha O multi-día activo, excluyendo Sodimac — esa fuente
# no resuelve tracto por la misma cadena, ver /available-assets).
_RECOMPUTE_SQL = """
WITH active_roster AS (
    SELECT a.id AS asset_id, aa.carrier_id,
           wot.label = 'Tractoreo' AS is_tractoreo,
           wot.label = 'Equipo Completo' AS is_equipo_completo
    FROM public.assets a
    JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
    JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
    LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
    WHERE a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
),
today_trips AS (
    SELECT DISTINCT vfr.resolved_tractor_asset_id AS asset_id
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
      AND t.source_system != 'sodimac'
      AND vfr.resolved_tractor_asset_id IS NOT NULL
),
computed AS (
    SELECT
        ar.asset_id,
        CASE WHEN tt.asset_id IS NOT NULL THEN 'ASSIGNED' ELSE 'UNASSIGNED' END AS status,
        NOT (COALESCE(ar.is_equipo_completo, false) AND NOT COALESCE(ar.is_tractoreo, false)) AS requires_motivo
    FROM active_roster ar
    LEFT JOIN today_trips tt ON tt.asset_id = ar.asset_id
)
INSERT INTO app.equipment_day_status (asset_id, business_date, status, requires_motivo, computed_at)
SELECT asset_id, $1, status, requires_motivo, now() FROM computed
ON CONFLICT (asset_id, business_date) DO UPDATE SET
    status = EXCLUDED.status,
    requires_motivo = EXCLUDED.requires_motivo,
    computed_at = EXCLUDED.computed_at,
    unassigned_reason_id = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.equipment_day_status.unassigned_reason_id ELSE NULL END,
    resolved_by = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.equipment_day_status.resolved_by ELSE NULL END,
    resolved_at = CASE WHEN EXCLUDED.status = 'UNASSIGNED' THEN app.equipment_day_status.resolved_at ELSE NULL END
"""

_DETAIL_SQL = """
SELECT
    eds.asset_id, a.license_plate AS tractor_plate, c.id AS carrier_id, c.business_name AS carrier_name,
    -- "Tipo Vehículo" (Ronda 80/82) — columna nueva del Excel de vehículos,
    -- se muestra junto al tracto en la tabla de cierre para que el
    -- coordinador vea la misma clasificación que ya decide el bloque.
    st.label AS fleet_service_type_label, st.bg_color AS fleet_service_type_bg_color,
    st.text_color AS fleet_service_type_text_color,
    eds.status, eds.requires_motivo, eds.unassigned_reason_id, ur.label AS unassigned_reason_label,
    eds.resolved_by, eds.resolved_at,
    -- Conductor habitual del equipo (sigue mostrándose junto al tracto,
    -- HU-03 §BLOQUE 1 — ya no es la unidad que se cierra, ver docstring).
    sd.driver_id, sd.full_name AS driver_name,
    -- "CD de origen" — no existe un CD habitual por equipo/empresa en el
    -- modelo hoy (mismo gap documentado en Fase 2); mejor esfuerzo: el
    -- origen de su viaje más reciente, sea de hoy o no.
    last_origin.local AS last_known_origin
FROM app.equipment_day_status eds
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
WHERE eds.business_date = $1
ORDER BY a.license_plate
"""


async def _recompute(pool, business_date: _date) -> dict:
    """Mismo pipeline que daily_closures.py: el pre-cierre (Tipo A/Tipo B,
    HU-02) corre primero, así el directorio ya está corregido cuando se
    calcula quién tiene carga hoy."""
    pre_cierre = await run_pre_cierre(pool, business_date)
    await pool.execute(_RECOMPUTE_SQL, business_date)
    return pre_cierre


@router.get("")
async def get_equipment_closure_status(fecha: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    business_date = _parse_business_date(fecha)
    pre_cierre = await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    equipment = [dict(r) for r in rows]

    closure = await pool.fetchrow(
        "SELECT closed_by, closed_at, total_equipment, resolved_count, override_count "
        "FROM app.equipment_closures WHERE business_date = $1",
        business_date,
    )

    tractoreo = [e for e in equipment if e["requires_motivo"]]
    equipos_completos = [e for e in equipment if not e["requires_motivo"]]

    def _summary(items: list[dict]) -> dict:
        assigned = sum(1 for e in items if e["status"] == "ASSIGNED")
        total = len(items)
        return {
            "total": total, "assigned": assigned, "unassigned": total - assigned,
            "utilization_pct": round(assigned / total * 100, 1) if total else 0.0,
        }

    tractoreo_pending = [e for e in tractoreo if e["status"] == "UNASSIGNED" and not e["unassigned_reason_id"]]

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
        "closed": closure is not None,
        "closure": dict(closure) if closure else None,
        "tractoreo": {
            "summary": _summary(tractoreo),
            "equipment": tractoreo,
            "pending_count": len(tractoreo_pending),
        },
        "equipos_completos": {
            "summary": _summary(equipos_completos),
            "by_carrier": sorted(by_carrier.values(), key=lambda b: b["carrier_name"] or ""),
        },
        "pre_cierre": pre_cierre,
    }


@router.patch("/reason")
async def set_batch_reason(
    body: EquipmentBatchReasonBody, fecha: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    """BLOQUE 1 de HU-03: selección masiva con checkbox — mismo motivo para
    varios tractos en un clic (criterio de aceptación #2)."""
    business_date = _parse_business_date(fecha)

    rows = await pool.fetch(
        "SELECT asset_id, requires_motivo, status FROM app.equipment_day_status "
        "WHERE business_date = $1 AND asset_id = ANY($2::uuid[])",
        business_date, body.asset_ids,
    )
    found_ids = {str(r["asset_id"]) for r in rows}
    missing = [aid for aid in body.asset_ids if aid not in found_ids]
    if missing:
        raise HTTPException(404, f"Equipo(s) no encontrados en la cuadratura de ese día: {missing}")
    not_unassigned = [str(r["asset_id"]) for r in rows if r["status"] != "UNASSIGNED"]
    if not_unassigned:
        raise HTTPException(422, f"Solo se puede registrar motivo para equipos sin carga: {not_unassigned}")

    await pool.execute(
        """
        UPDATE app.equipment_day_status
        SET unassigned_reason_id = $1, resolved_by = $2::uuid, resolved_at = now()
        WHERE business_date = $3 AND asset_id = ANY($4::uuid[])
        """,
        body.unassigned_reason_id, user["sub"], business_date, body.asset_ids,
    )
    rows = await pool.fetch(_DETAIL_SQL, business_date)
    updated = [dict(r) for r in rows if str(r["asset_id"]) in found_ids]
    return updated


@router.post("/close")
async def close_equipment_day(
    fecha: str, body: CloseEquipmentDayBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    """Confirmar cierre (HU-03): bloquea si hay tractos de Tractoreo/Sin
    clasificar sin motivo — 'A confirmar' cuenta como motivo válido
    (criterio #1), Equipos Completos nunca bloquea (cierre pasivo)."""
    business_date = _parse_business_date(fecha)
    await _recompute(pool, business_date)

    rows = await pool.fetch(_DETAIL_SQL, business_date)
    equipment = [dict(r) for r in rows]
    pending = [
        e for e in equipment
        if e["requires_motivo"] and e["status"] == "UNASSIGNED" and not e["unassigned_reason_id"]
    ]

    if pending and not body.override:
        raise HTTPException(
            409,
            {
                "message": f"{len(pending)} equipo(s) sin resolver — no se puede cerrar el día",
                "pending": [{"asset_id": str(e["asset_id"]), "tractor_plate": e["tractor_plate"]} for e in pending],
            },
        )

    if pending and body.override:
        if user["role"] not in ADMIN_ROLES:
            raise HTTPException(403, "Forzar el cierre con pendientes requiere rol admin o superior")
        if not body.override_note or not body.override_note.strip():
            raise HTTPException(422, "El override requiere un comentario de justificación")
        async with pool.acquire() as conn:
            async with conn.transaction():
                for e in pending:
                    await log_change(
                        conn, actor=user["sub"], entity_type="ASSET", entity_id=e["asset_id"],
                        action="cierre_override", field="status",
                        old_value="UNASSIGNED",
                        new_value={"business_date": business_date.isoformat(), "note": body.override_note},
                    )

    await pool.execute(
        """
        INSERT INTO app.equipment_closures (business_date, closed_by, total_equipment, resolved_count, override_count)
        VALUES ($1, $2::uuid, $3, $4, $5)
        ON CONFLICT (business_date) DO UPDATE SET
            closed_by = EXCLUDED.closed_by, closed_at = now(),
            total_equipment = EXCLUDED.total_equipment, resolved_count = EXCLUDED.resolved_count,
            override_count = EXCLUDED.override_count
        """,
        business_date, user["sub"], len(equipment), len(equipment) - len(pending),
        len(pending) if body.override else 0,
    )
    return {
        "ok": True, "business_date": business_date.isoformat(),
        "overridden": len(pending) if body.override else 0,
    }
