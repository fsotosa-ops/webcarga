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

Tarea 6 (plan 2.3, minuta 2026-08-03): la Sección 4 ("Tractoreo no
trabajando") pasa a agruparse por CONDUCTOR, no por tracto — decisión de
negocio confirmada por el usuario, porque el roster de Tractoreo (ver
TRACTOREO_ROSTER_CTE) se arma a nivel EMPRESA, así que el conductor puede
tener como tracto habitual uno clasificado Equipo Completo aunque él mismo
esté en el roster de Tractoreo. Para no perder la forma de tabla cruzada
CD×motivo de la HU-04 literal, la sección expone ambas cosas: los mismos
`por_cd`/`por_empresa_y_cd` de siempre (ahora contando conductores) MÁS
`driver_detail`, una fila plana por conductor con su tipo de operación.
Las Secciones 1, 2, 3, 5, 6 siguen 100% tracto-céntricas — no cambian.
"""
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..db import get_pool
from ..services.cierre_lineas import GRUPO_NO_TRABAJANDO, LINEAS_CONDUCTORES, LINEAS_TRACTOS, recalcular
from ..services.driver_roster import TRACTOREO_ROSTER_CTE
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
       wot.code AS webcarga_operation_type_code
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
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
  AND t.source_system != 'sodimac'
  AND vfr.resolved_tractor_asset_id IS NOT NULL
"""

# HU-28 (ola 4): acá vivía `_LAST_KNOWN_ORIGIN_SQL`, que le atribuía a un equipo
# SIN CARGA el origen de su viaje más reciente *de cualquier fecha* — un dato
# inventado presentado como hecho, y que además reescribía el pasado: cada viaje
# nuevo le cambiaba el CD a días ya firmados. Lo reemplaza el origen habitual declarado,
# que viaja congelado en la línea del cierre (app.closure_lines.home_location_id).


# Tarea 6 (plan 2.3, minuta 2026-08-03): insumo para la Sección 4 por
# CONDUCTOR — mismo roster Tractoreo que usa la cuadratura activa de
# daily_closures.py (TRACTOREO_ROSTER_CTE), no una copia divergente.
_DRIVER_ROSTER_SQL = f"""
WITH {TRACTOREO_ROSTER_CTE}
SELECT r.driver_id, d.full_name, r.home_carrier_id AS carrier_id, c.business_name AS carrier_name
FROM active_roster r
JOIN public.drivers d ON d.id = r.driver_id
JOIN public.carriers c ON c.id = r.home_carrier_id
"""

_DRIVER_STATUS_SQL = f"""
SELECT dds.driver_id, dds.status, dds.category, ur.label AS unassigned_reason_label,
       -- El origen habitual DECLARADO, congelado en la línea al calcularla (HU-28).
       hcd.name AS home_cd
FROM {LINEAS_CONDUCTORES} dds
LEFT JOIN app.status_taxonomies ur ON ur.id = dds.unassigned_reason_id
LEFT JOIN public.locations hcd ON hcd.id = dds.home_location_id
WHERE dds.business_date = $1
"""

# Su gemelo por conductor se retiró en la misma ola y por el mismo motivo.

# Tracto habitual + tipo de operación de ESE tracto — mismo criterio
# "mejor esfuerzo" que la Tarea 5 agregó a _DETAIL_SQL de daily_closures.py,
# pero acá resuelto en batch para todo el roster (no es una fuente de
# verdad de asignación exclusiva, ver docstring de esa tarea).
_LAST_KNOWN_TRACTOR_BY_DRIVER_SQL = """
SELECT DISTINCT ON (vfr.resolved_driver_id)
    vfr.resolved_driver_id AS driver_id, a.license_plate AS tractor_plate, wot.label AS operation_type
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
LEFT JOIN public.assets a ON a.id = vfr.resolved_tractor_asset_id
LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
WHERE vfr.resolved_driver_id = ANY($1::uuid[])
ORDER BY vfr.resolved_driver_id, t.status_reported_at DESC NULLS LAST
"""


async def _build_asset_rows(pool, business_date: _date) -> list[dict]:
    """Una fila enriquecida por equipo activo — insumo único del que se
    derivan las 6 secciones (mismo patrón que fleet_daily_overview/
    equipment_closures: calcular una vez, derivar todo en Python)."""
    # HU-02 (pre-cierre) + cuadratura por equipo (HU-03) corren primero —
    # el reporte debe reflejar el directorio ya corregido y los motivos ya
    # capturados por el coordinador.
    await recalcular(pool, business_date)

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
        f"""
        SELECT eds.asset_id, eds.status, eds.requires_motivo, st.label AS unassigned_reason_label,
               hcd.name AS home_cd
        FROM {LINEAS_TRACTOS} eds
        LEFT JOIN app.status_taxonomies st ON st.id = eds.unassigned_reason_id
        LEFT JOIN public.locations hcd ON hcd.id = eds.home_location_id
        WHERE eds.business_date = $1
        """,
        business_date,
    )
    status_by_asset = {r["asset_id"]: r for r in status_rows}

    rows = []
    for r in roster_rows:
        asset_id = r["asset_id"]
        # FIX 2026-08-18: se comparaba contra la etiqueta visible ('Tractoreo'),
        # así que renombrarla desde Configuración vaciaba el roster en silencio.
        # Ahora lee `code`, el identificador estable (no editable desde la app).
        # Nótese que el mapeo de abajo ya producía justamente esos códigos.
        operation_code = r["webcarga_operation_type_code"]
        is_tractoreo = operation_code == "TRACTOREO"
        is_equipo_completo = operation_code == "EQUIPO_COMPLETO"
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
            # El origen REAL del viaje de hoy, sin relleno: si no hubo viaje, no
            # hay origen, y decirlo es más honesto que atribuirle uno viejo.
            "origin_cd": latest["origin_cd"] if latest else None,
            # El origen habitual declarado: la dimensión de la ASISTENCIA, que vale
            # también —sobre todo— para el que no trabajó.
            "home_cd": (status_row or {}).get("home_cd"),
            "client_name": latest["client_name"] if latest else None,
            "destination_zone": destination_zone,
            "dias_en_curso": dias_en_curso,
            "vueltas": max((leg_by_trip.get(t["trip_id"], 1) for t in asset_trips), default=0),
            "unassigned_reason_label": status_row["unassigned_reason_label"] if status_row else None,
        })
    return rows


async def _build_driver_rows(pool, business_date: _date) -> list[dict]:
    """Insumo de la Sección 4 (Tarea 6, plan 2.3): una fila por conductor
    del roster Tractoreo (TRACTOREO_ROSTER_CTE) que hoy está UNASSIGNED —
    ASSIGNED no entra (tiene carga) y MISMATCH tampoco (inconsistencia de
    datos que se resuelve en Pendientes/pre-cierre, no es parte de este
    reporte). con_carga queda fijo en False: es un campo "de compatibilidad"
    para que _cross_tab_by_motivo (que ya filtra internamente con
    `if r["con_carga"]: continue`) acepte todas las filas sin modificarla."""
    # Ya recalculado por _build_asset_rows en el mismo request: las líneas de
    # conductores y tractos se derivan juntas.
    roster_rows = await pool.fetch(_DRIVER_ROSTER_SQL)

    status_rows = await pool.fetch(_DRIVER_STATUS_SQL, business_date)
    status_by_driver = {r["driver_id"]: r for r in status_rows}

    driver_ids = [r["driver_id"] for r in roster_rows]

    tractor_rows = await pool.fetch(_LAST_KNOWN_TRACTOR_BY_DRIVER_SQL, driver_ids) if driver_ids else []
    tractor_by_driver = {r["driver_id"]: r for r in tractor_rows}

    rows = []
    for r in roster_rows:
        driver_id = r["driver_id"]
        status_row = status_by_driver.get(driver_id, {})
        tractor_row = tractor_by_driver.get(driver_id, {})
        rows.append({
            "driver_id": driver_id,
            "full_name": r["full_name"],
            "carrier_name": r["carrier_name"],
            "status": status_row.get("status"),
            "category": status_row.get("category"),
            "unassigned_reason_label": status_row.get("unassigned_reason_label"),
            # Estas filas son conductores SIN carga por definicion, asi que no
            # tienen origen real: su CD es el declarado, y punto.
            "home_cd": status_row.get("home_cd"),
            "tractor_plate": tractor_row.get("tractor_plate"),
            "operation_type": tractor_row.get("operation_type"),
            "con_carga": False,
        })

    # "No trabajando" es lo que dice su nombre: quien trabajó sin asignación
    # (Esperando carga, Camino al CD...) no entra. Un conductor sin motivo
    # todavía sí, como hasta ahora: no se sabe si trabajó.
    return [r for r in rows if r["category"] in ("NO_TRABAJANDO", "SIN_RESOLVER")]


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
    """Agrupa por el CD BASE declarado, no por el origen del viaje (HU-28, ola 4).

    Tiene que ser el declarado para que cuadre con la Sección 7: ahí "enrolados"
    incluye a quien no salió, que no tiene origen. Con dos claves distintas, el
    "asignados" de una y el de la otra no darían el mismo número."""
    tractoreo = [r for r in rows if "TRACTOREO" in r["categories"]]
    por_cd = _cross_tab_by_zone(tractoreo, lambda r: r["home_cd"] or "Sin origen")
    por_empresa_y_cd = _cross_tab_by_zone(tractoreo, lambda r: (r["home_cd"] or "Sin origen", r["carrier_name"]))
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


# Las columnas de motivo salen del catálogo, no de una lista escrita a mano:
# la que había (y su copia en StatusReportSection.tsx) dejaba fuera 9 motivos
# que sólo sumaban al total.
_SQL_MOTIVOS_NO_TRABAJANDO = f"""
SELECT label FROM app.status_taxonomies
WHERE domain = 'DRIVER_REASON' AND active
  AND COALESCE(group_id, '{GRUPO_NO_TRABAJANDO}') = '{GRUPO_NO_TRABAJANDO}'
ORDER BY sort_order, label
"""


def _columnas_de_motivo(catalogo: list[str], rows: list[dict]) -> list[str]:
    """Los motivos activos del catálogo, más los que aparezcan en las filas
    aunque ya estén desactivados: un día pasado puede tener uno retirado."""
    columnas = list(catalogo)
    for r in rows:
        label = r["unassigned_reason_label"]
        if label and label not in columnas:
            columnas.append(label)
    return columnas


def _cross_tab_by_motivo(rows: list[dict], key_fn, motivos: list[str]) -> dict:
    """Igual forma que _cross_tab_by_zone (dict keyed por key_fn(row)) —
    columnas = una por cada motivo + total."""
    buckets: dict = {}
    for r in rows:
        if r["con_carga"]:
            continue
        key = key_fn(r)
        if key is None:
            continue
        b = buckets.setdefault(key, {m: 0 for m in motivos} | {"total": 0})
        label = r["unassigned_reason_label"]
        if label in b:
            b[label] += 1
        b["total"] += 1
    return buckets


def _section4_tractoreo_no_trabajando(driver_rows: list[dict], motivos: list[str]) -> dict:
    """Tarea 6 (plan 2.3): agrupada por CONDUCTOR — el caller (_build_driver_rows)
    ya acota a Tractoreo + UNASSIGNED por construcción, no se filtra de
    nuevo acá. `driver_detail` es la lista plana que permite ver el tipo de
    operación del tracto habitual de cada conductor (puede diferir del
    roster, que se arma a nivel empresa)."""
    # Por el CD BASE: son conductores que NO trabajaron, así que no hay origen
    # real que agrupar. Antes se les atribuía el de su viaje más reciente, de
    # cualquier fecha.
    por_cd = _cross_tab_by_motivo(driver_rows, lambda r: r["home_cd"] or "Sin origen", motivos)
    por_empresa_y_cd = _cross_tab_by_motivo(
        driver_rows, lambda r: (r["home_cd"] or "Sin origen", r["carrier_name"]), motivos,
    )
    driver_detail = [
        {
            "driver_id": str(r["driver_id"]), "full_name": r["full_name"], "carrier_name": r["carrier_name"],
            "cd_origen": r["home_cd"], "unassigned_reason_label": r["unassigned_reason_label"],
            "tractor_plate": r["tractor_plate"], "operation_type": r["operation_type"],
        }
        for r in driver_rows
    ]
    return {
        "por_cd": [{"cd": k, **v} for k, v in sorted(por_cd.items())],
        "por_empresa_y_cd": [
            {"cd": k[0], "carrier_name": k[1], **v} for k, v in sorted(por_empresa_y_cd.items())
        ],
        "driver_detail": driver_detail,
        # El orden de las columnas de motivo: el frontend las dibuja de acá, no
        # de una lista propia.
        "motivos": motivos,
    }


def _carrier_utilization_table(rows: list[dict], category: str) -> list[dict]:
    """Tabla Empresa/Enrolados/Asignados/No asignados/% utilización para una
    categoría (TRACTOREO o EQUIPO_COMPLETO) — mismo shape para ambas
    (paridad pedida por el usuario 2026-08-04: la tab "por empresa" solo
    existía para Equipo Completo, Sección 5; Tractoreo no tenía
    equivalente pese a tener tabs 2/4 organizadas por CD/motivo, no por
    empresa así de simple)."""
    items = [r for r in rows if category in r["categories"]]
    by_carrier: dict = {}
    for r in items:
        b = by_carrier.setdefault(r["carrier_name"], {"carrier_name": r["carrier_name"], "enrolled": 0, "assigned": 0, "unassigned": 0})
        b["enrolled"] += 1
        b["assigned" if r["con_carga"] else "unassigned"] += 1
    result = []
    for b in by_carrier.values():
        pct = round(b["assigned"] / b["enrolled"] * 100, 1) if b["enrolled"] else 0.0
        result.append({**b, "utilization_pct": pct})
    return sorted(result, key=lambda b: b["utilization_pct"], reverse=True)


def _section5_equipos_completos(rows: list[dict]) -> list[dict]:
    return _carrier_utilization_table(rows, "EQUIPO_COMPLETO")


def _section_tractoreo_por_empresa(rows: list[dict]) -> list[dict]:
    return _carrier_utilization_table(rows, "TRACTOREO")


def _section_desvios_de_cd(rows: list[dict]) -> list[dict]:
    """Los que cargaron en un CD distinto al suyo (HU-28, ola 4.1).

    Es la mitad del valor del estandar: declarar el origen habitual no sirve para que
    todos calcen, sino para poder VER cuando no calzan. Medido el 2026-09-17:
    el 35% de los conductores de Walmart cargan en mas de un CD, con el
    dominante en 90,5% — o sea el desvio es real y regular, y hasta ahora se
    perdia porque el reporte agrupaba por el origen adivinado y nunca podia
    contradecirse a si mismo.

    Sale de datos que ya estan en la fila: no cuesta ni una consulta mas."""
    return sorted(
        (
            {
                "tractor_plate": r["tractor_plate"],
                "carrier_name": r["carrier_name"],
                "home_cd": r["home_cd"],
                "origin_cd": r["origin_cd"],
                "client_name": r["client_name"],
            }
            for r in rows
            # Los tres tienen que existir: sin origen habitual no hay con que comparar,
            # y sin carga no hay origen. Ninguno de los dos casos es un desvio.
            if r["con_carga"] and r["home_cd"] and r["origin_cd"]
            and r["home_cd"] != r["origin_cd"]
        ),
        key=lambda d: (d["home_cd"], d["origin_cd"], d["tractor_plate"] or ""),
    )


def _section6_resumen_general(rows: list[dict]) -> dict:
    tractoreo = [r for r in rows if "TRACTOREO" in r["categories"]]
    equipos_completos = [r for r in rows if "EQUIPO_COMPLETO" in r["categories"]]

    def _by_cd(items: list[dict]) -> list[dict]:
        """Enrolados vs asignados por CD: ES la asistencia por CD que pidió
        Operaciones. Va por el CD declarado porque "enrolados" incluye a los que
        no salieron, y esos no tienen origen."""
        acc: dict = {}
        for r in items:
            key = r["home_cd"] or "Sin origen"
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
    # Tarea 6 (plan 2.3): la Sección 4 pasa a agruparse por conductor — su
    # insumo es driver_rows, no rows/all_rows (tracto-céntrico). No se le
    # aplica _filter_by_client: ese filtro es "asignado a ese cliente", y
    # todo conductor de driver_rows es por definición UNASSIGNED (sin
    # cliente) — mismo criterio que ya deja pasar siempre a los equipos
    # idle en _filter_by_client.
    driver_rows = await _build_driver_rows(pool, business_date)
    motivos = _columnas_de_motivo(
        [r["label"] for r in await pool.fetch(_SQL_MOTIVOS_NO_TRABAJANDO)], driver_rows,
    )
    rows = _filter_by_client(all_rows, client)

    return {
        "business_date": business_date.isoformat(),
        "client_filter": client,
        "section1_resumen": _section1_resumen(rows),
        "section2_tractoreo_asignado": _section2_tractoreo_asignado(rows),
        "section3_vueltas": _section3_vueltas(rows),
        "section4_tractoreo_no_trabajando": _section4_tractoreo_no_trabajando(driver_rows, motivos),
        "section_tractoreo_por_empresa": _section_tractoreo_por_empresa(rows),
        "section5_equipos_completos": _section5_equipos_completos(rows),
        "section6_resumen_general": _section6_resumen_general(rows),
        "section7_desvios_de_cd": _section_desvios_de_cd(rows),
    }
