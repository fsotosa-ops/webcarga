"""Fase 5 (HU-04): Reporte de estatus del día — 6 secciones, construidas
sobre el mismo modelo equipo-céntrico de las Fases 2-4 (Vista de Flota,
Cierre del Día). Reusa:
  - la clasificación Tractoreo/Equipo Completo/Sin clasificar de Fase 1/2.
  - el criterio "con carga hoy" (multi-día activo, excluye Sodimac) de
    Fase 0.1/2/3/4.
  - la resolución RM/Z0/Región por COMUNA DEL DESTINO (§7.6 de la HU) vía
    los mismos helpers de trips.py que ya resuelven esto para el Diario
    (_load_operation_type_buckets/_resolve_operation_type) — una sola
    fuente de verdad, no una copia nueva de esa lógica en SQL.
  - las vueltas (Fase 0.3, app.v_driver_daily_trip_legs — ya unificado
    conductor O tracto).
  - el pre-cierre (HU-02) y la cuadratura por equipo (HU-03), corridos
    primero para que el reporte refleje el directorio ya corregido y los
    motivos ya capturados.

Decisiones documentadas donde la HU es ambigua o depende de un insumo que
todavía no llega (ver docs/casuistica-negocio-diario.md y AGENTLOG.md):
  - Sección 2 (Tractoreo asignado): la HU lista una columna "Se retiró sin
    carga" junto a RM/Z0/Región — ese es un motivo de NO asignación
    (Bloque 1 del cierre), no un tipo de destino. Se omite acá para no
    modelar dos veces el mismo concepto; ya aparece en la Sección 4
    (Tractoreo no trabajando) como una columna de motivo más.
  - "CD de origen" para equipos SIN CARGA: no existe un CD habitual por
    equipo/empresa en el modelo hoy (mismo gap de Fase 2/4) — mejor
    esfuerzo: el origen de su viaje más reciente, cualquiera sea la fecha.
  - Un viaje puede tener más de un destino; se usa el ÚLTIMO (el de
    entrega real) para la clasificación RM/Z0/Región de ese viaje, acorde
    a "la comuna DEL DESTINO (local de entrega)" — singular en la HU.
  - Una empresa con AMBOS tipos de operación seleccionados cuenta sus
    equipos en ambas secciones (Tractoreo y Equipos Completos) — mismo
    criterio que Fase 2/4, no se fuerza una sola categoría.
"""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..db import get_pool
from .equipment_closures import _recompute
from .trips import _load_operation_type_buckets, _resolve_operation_type

router = APIRouter(prefix="/status-report", tags=["status-report"])


def _parse_business_date(fecha: str) -> _date:
    try:
        return _date.fromisoformat(fecha)
    except ValueError:
        raise HTTPException(422, f"Fecha inválida: '{fecha}' (formato esperado YYYY-MM-DD)")


def _zone_bucket(operation_type: str | None) -> str:
    if operation_type == "RM":
        return "RM"
    if operation_type == "Z0":
        return "Z0"
    if operation_type in ("Region Norte", "Region Sur"):
        return "Región"
    return "Sin clasificar"


_ROSTER_SQL = """
SELECT a.id AS asset_id, a.license_plate AS tractor_plate, aa.carrier_id, c.business_name AS carrier_name,
       st.label AS fleet_service_type_label,
       wot.label AS webcarga_operation_type_label
FROM public.assets a
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
LEFT JOIN app.status_taxonomies st ON st.id = a.fleet_service_type_id
LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
WHERE a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
"""

# "Con carga hoy" — mismo criterio de Fase 0.1/2/3/4 (multi-día activo,
# excluye Sodimac). Trae también planning_date (para "días en curso" de la
# Sección 1) y el último destino (para clasificar RM/Z0/Región, §7.6).
_TODAY_TRIPS_SQL = """
SELECT
    t.id AS trip_id,
    vfr.resolved_tractor_asset_id AS asset_id,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    (SELECT ts.local FROM app.trip_stops ts WHERE ts.trip_id = t.id AND ts.stop_type = 'ORIGIN' LIMIT 1) AS origin_cd,
    (
        SELECT ts.local FROM app.trip_stops ts
        WHERE ts.trip_id = t.id AND ts.stop_type = 'DESTINATION'
        ORDER BY ts.stop_order DESC LIMIT 1
    ) AS last_destination_local
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
  AND t.source_system != 'sodimac'
  AND vfr.resolved_tractor_asset_id IS NOT NULL
"""

# CD de origen "mejor esfuerzo" para equipos SIN CARGA hoy — mismo gap y
# mismo criterio que EquipmentCloseDayDialog (Fase 4): el origen de su
# viaje más reciente, sea de hoy o no.
_LAST_KNOWN_ORIGIN_SQL = """
SELECT DISTINCT ON (vfr.resolved_tractor_asset_id)
    vfr.resolved_tractor_asset_id AS asset_id, ts.local AS origin_cd
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
JOIN app.trip_stops ts ON ts.trip_id = t.id AND ts.stop_type = 'ORIGIN'
WHERE vfr.resolved_tractor_asset_id = ANY($1::uuid[])
ORDER BY vfr.resolved_tractor_asset_id, t.status_reported_at DESC NULLS LAST
"""


async def _build_asset_rows(pool, business_date: _date) -> list[dict]:
    """Una fila enriquecida por equipo activo — insumo único del que se
    derivan las 6 secciones (mismo patrón que fleet_daily_overview/
    equipment_closures: calcular una vez, derivar todo en Python)."""
    # HU-02 (pre-cierre) + cuadratura por equipo (HU-03) corren primero —
    # el reporte debe reflejar el directorio ya corregido y los motivos ya
    # capturados por el coordinador.
    await _recompute(pool, business_date)

    roster_rows = await pool.fetch(_ROSTER_SQL)

    trip_rows = await pool.fetch(_TODAY_TRIPS_SQL, business_date)
    trips_by_asset: dict[str, list] = {}
    for r in trip_rows:
        trips_by_asset.setdefault(r["asset_id"], []).append(r)

    client_names = {r["client_name"].strip().lower() for r in trip_rows if r["client_name"]}
    buckets = await _load_operation_type_buckets(pool, client_names)

    trip_ids = [r["trip_id"] for r in trip_rows]
    leg_rows = await pool.fetch(
        "SELECT trip_id, leg_number FROM app.v_driver_daily_trip_legs WHERE trip_id = ANY($1::uuid[])", trip_ids,
    ) if trip_ids else []
    leg_by_trip = {r["trip_id"]: r["leg_number"] for r in leg_rows}

    status_rows = await pool.fetch(
        """
        SELECT eds.asset_id, eds.status, eds.requires_motivo, st.label AS unassigned_reason_label
        FROM app.equipment_day_status eds
        LEFT JOIN app.status_taxonomies st ON st.id = eds.unassigned_reason_id
        WHERE eds.business_date = $1
        """,
        business_date,
    )
    status_by_asset = {r["asset_id"]: r for r in status_rows}

    idle_asset_ids = [aid for aid in (r["asset_id"] for r in roster_rows) if not trips_by_asset.get(aid)]
    last_origin_rows = await pool.fetch(_LAST_KNOWN_ORIGIN_SQL, idle_asset_ids) if idle_asset_ids else []
    last_origin_by_asset = {r["asset_id"]: r["origin_cd"] for r in last_origin_rows}

    rows = []
    for r in roster_rows:
        asset_id = r["asset_id"]
        operation_label = r["webcarga_operation_type_label"]
        is_tractoreo = operation_label == "Tractoreo"
        is_equipo_completo = operation_label == "Equipo Completo"
        categories = []
        if is_tractoreo:
            categories.append("TRACTOREO")
        if is_equipo_completo:
            categories.append("EQUIPO_COMPLETO")
        if not categories:
            categories.append("SIN_CLASIFICAR")

        asset_trips = trips_by_asset.get(asset_id, [])
        con_carga = len(asset_trips) > 0
        latest = max(asset_trips, key=lambda t: t["status_reported_at"] or _date.min) if asset_trips else None
        status_row = status_by_asset.get(asset_id)

        destination_zone = None
        dias_en_curso = None
        if latest:
            shipper_key = (latest["client_name"] or "").strip().lower()
            bucket = buckets.get(shipper_key)
            op_type = _resolve_operation_type(bucket, latest["last_destination_local"])
            destination_zone = _zone_bucket(op_type)
            if latest["planning_date"]:
                dias_en_curso = (business_date - latest["planning_date"]).days

        rows.append({
            "asset_id": asset_id,
            "tractor_plate": r["tractor_plate"],
            "carrier_id": r["carrier_id"],
            "carrier_name": r["carrier_name"],
            "categories": categories,
            "con_carga": con_carga,
            "origin_cd": (latest["origin_cd"] if latest else None) or last_origin_by_asset.get(asset_id),
            "client_name": latest["client_name"] if latest else None,
            "destination_zone": destination_zone,
            "dias_en_curso": dias_en_curso,
            "vueltas": max((leg_by_trip.get(t["trip_id"], 1) for t in asset_trips), default=0),
            "unassigned_reason_label": status_row["unassigned_reason_label"] if status_row else None,
        })
    return rows


def _filter_by_client(rows: list[dict], client: str | None) -> list[dict]:
    if not client:
        return rows
    client_lower = client.strip().lower()
    return [r for r in rows if not r["con_carga"] or (r["client_name"] or "").strip().lower() == client_lower]


def _summary(rows: list[dict]) -> dict:
    assigned = sum(1 for r in rows if r["con_carga"])
    total = len(rows)
    return {
        "total": total, "assigned": assigned, "unassigned": total - assigned,
        "utilization_pct": round(assigned / total * 100, 1) if total else 0.0,
    }


def _section1_resumen(all_rows: list[dict]) -> dict:
    tractoreo = [r for r in all_rows if "TRACTOREO" in r["categories"]]
    equipos_completos = [r for r in all_rows if "EQUIPO_COMPLETO" in r["categories"]]
    multi_dia = [r for r in all_rows if r["con_carga"] and (r["dias_en_curso"] or 0) > 0]
    por_dias: dict[str, int] = {}
    for r in multi_dia:
        key = str(r["dias_en_curso"])
        por_dias[key] = por_dias.get(key, 0) + 1
    return {
        "total_equipos_activos": len(all_rows),
        "tractoreo": _summary(tractoreo),
        "equipos_completos": _summary(equipos_completos),
        "multi_dia_activos": {"total": len(multi_dia), "por_dias_atras": por_dias},
    }


def _cross_tab_by_zone(rows: list[dict], key_fn) -> list[dict]:
    """Filas = key_fn(row) (CD, o (CD, empresa)); columnas = RM/Z0/Región/
    Sin clasificar + Total — para Sección 2 (asignados por tipo de destino)."""
    buckets: dict = {}
    for r in rows:
        if not r["con_carga"]:
            continue
        key = key_fn(r)
        if key is None:
            continue
        b = buckets.setdefault(key, {"RM": 0, "Z0": 0, "Región": 0, "Sin clasificar": 0, "total": 0})
        b[r["destination_zone"]] += 1
        b["total"] += 1
    return buckets


def _section2_tractoreo_asignado(rows: list[dict]) -> dict:
    tractoreo = [r for r in rows if "TRACTOREO" in r["categories"]]
    por_cd = _cross_tab_by_zone(tractoreo, lambda r: r["origin_cd"] or "Sin CD")
    por_empresa_y_cd = _cross_tab_by_zone(tractoreo, lambda r: (r["origin_cd"] or "Sin CD", r["carrier_name"]))
    return {
        "por_cd": [{"cd": k, **v} for k, v in sorted(por_cd.items())],
        "por_empresa_y_cd": [
            {"cd": k[0], "carrier_name": k[1], **v} for k, v in sorted(por_empresa_y_cd.items())
        ],
    }


def _section3_vueltas(rows: list[dict]) -> list[dict]:
    return [
        {
            "carrier_name": r["carrier_name"], "cd_origen": r["origin_cd"],
            "tipo_destino": r["destination_zone"], "vueltas": r["vueltas"],
        }
        for r in rows if r["con_carga"] and r["vueltas"] >= 2
    ]


_MOTIVO_LABELS = [
    "Panne", "Mantención", "Sin conductor", "No se presentó", "Vacaciones", "Licencia",
    "Descanso", "Se retiró sin carga", "Sin carga disponible", "Conductor no disponible",
    "A confirmar", "Otro",
]


def _cross_tab_by_motivo(rows: list[dict], key_fn) -> dict:
    """Igual forma que _cross_tab_by_zone (dict keyed por key_fn(row)) —
    columnas = una por cada motivo del catálogo (Fase 0.4) + total."""
    buckets: dict = {}
    for r in rows:
        if r["con_carga"]:
            continue
        key = key_fn(r)
        if key is None:
            continue
        b = buckets.setdefault(key, {m: 0 for m in _MOTIVO_LABELS} | {"total": 0})
        label = r["unassigned_reason_label"]
        if label in b:
            b[label] += 1
        b["total"] += 1
    return buckets


def _section4_tractoreo_no_trabajando(rows: list[dict]) -> dict:
    tractoreo = [r for r in rows if "TRACTOREO" in r["categories"]]
    por_cd = _cross_tab_by_motivo(tractoreo, lambda r: r["origin_cd"] or "Sin CD")
    por_empresa_y_cd = _cross_tab_by_motivo(tractoreo, lambda r: (r["origin_cd"] or "Sin CD", r["carrier_name"]))
    return {
        "por_cd": [{"cd": k, **v} for k, v in sorted(por_cd.items())],
        "por_empresa_y_cd": [
            {"cd": k[0], "carrier_name": k[1], **v} for k, v in sorted(por_empresa_y_cd.items())
        ],
    }


def _section5_equipos_completos(rows: list[dict]) -> list[dict]:
    equipos_completos = [r for r in rows if "EQUIPO_COMPLETO" in r["categories"]]
    by_carrier: dict = {}
    for r in equipos_completos:
        b = by_carrier.setdefault(r["carrier_name"], {"carrier_name": r["carrier_name"], "enrolled": 0, "assigned": 0, "unassigned": 0})
        b["enrolled"] += 1
        b["assigned" if r["con_carga"] else "unassigned"] += 1
    result = []
    for b in by_carrier.values():
        pct = round(b["assigned"] / b["enrolled"] * 100, 1) if b["enrolled"] else 0.0
        result.append({**b, "utilization_pct": pct})
    return sorted(result, key=lambda b: b["utilization_pct"], reverse=True)


def _section6_resumen_general(rows: list[dict]) -> dict:
    tractoreo = [r for r in rows if "TRACTOREO" in r["categories"]]
    equipos_completos = [r for r in rows if "EQUIPO_COMPLETO" in r["categories"]]

    def _by_cd(items: list[dict]) -> list[dict]:
        acc: dict = {}
        for r in items:
            key = r["origin_cd"] or "Sin CD"
            b = acc.setdefault(key, {"cd": key, "enrolled": 0, "assigned": 0})
            b["enrolled"] += 1
            if r["con_carga"]:
                b["assigned"] += 1
        return sorted(acc.values(), key=lambda b: b["cd"])

    def _by_client(items: list[dict]) -> list[dict]:
        acc: dict = {}
        for r in items:
            if not r["con_carga"]:
                continue
            key = r["client_name"] or "Sin cliente"
            acc[key] = acc.get(key, 0) + 1
        return [{"client_name": k, "assigned": v} for k, v in sorted(acc.items())]

    return {
        "tractoreo": _summary(tractoreo),
        "equipos_completos": _summary(equipos_completos),
        "por_cd": _by_cd(rows),
        "por_cliente": _by_client(rows),
    }


@router.get("")
async def get_status_report(fecha: str, client: str | None = None, pool=Depends(get_pool), _=Depends(get_current_user)):
    business_date = _parse_business_date(fecha)
    all_rows = await _build_asset_rows(pool, business_date)
    rows = _filter_by_client(all_rows, client)

    return {
        "business_date": business_date.isoformat(),
        "client_filter": client,
        "section1_resumen": _section1_resumen(rows),
        "section2_tractoreo_asignado": _section2_tractoreo_asignado(rows),
        "section3_vueltas": _section3_vueltas(rows),
        "section4_tractoreo_no_trabajando": _section4_tractoreo_no_trabajando(rows),
        "section5_equipos_completos": _section5_equipos_completos(rows),
        "section6_resumen_general": _section6_resumen_general(rows),
    }
