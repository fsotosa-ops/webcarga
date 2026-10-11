"""Reporte de estatus del día (HU-04), por tipo de operación (spec 2026-10-11,
minuta 09/10 ítems 8 y 14): `by_operation_type.{tractoreo,equipo_completo}`
con las mismas seis claves cada uno. Se construye sobre el mismo modelo
equipo-céntrico del Cierre del Día. Reusa:
  - la clasificación Tractoreo/Equipo Completo/Sin clasificar de Fase 1/2.
  - el criterio "con carga hoy": app.trips_del_dia(), el mismo del Cierre.
  - la resolución RM/Z0/Región por COMUNA DEL DESTINO (§7.6 de la HU) vía
    los mismos helpers de trips.py que ya resuelven esto para el Diario
    (_load_operation_type_buckets/_resolve_operation_type) — una sola
    fuente de verdad, no una copia nueva de esa lógica en SQL.
  - las vueltas (Fase 0.3, app.v_driver_daily_trip_legs — ya unificado
    conductor O tracto).
  - las líneas del día (app.closure_lines), que mantiene el ejecutor de la
    cola del cierre: de ahí salen la categoría, el motivo y el origen
    habitual declarado (HU-28). Este reporte solo las lee.

Decisiones:
  - Asignados va por el ORIGEN REAL del viaje (minuta 09/10, decisión B); la
    asistencia (enrolados vs asignados) por el origen habitual DECLARADO. Un
    equipo sin carga no salió a ningún lado: cuenta en su origen habitual, o
    en "Sin origen". Nunca se le atribuye el origen de un viaje viejo.
  - Quien trabajó sin asignación (Se retira sin carga, Esperando carga…) va
    aparte, en `worked_without_assignment`: ni es asignado ni "no trabajó".
  - Las columnas de motivo son solo las que ocurrieron, en el orden del
    catálogo; una línea sin motivo cuenta en "Sin motivo".
  - Un viaje puede tener más de un destino; se usa el ÚLTIMO (el de entrega
    real) para la clasificación RM/Z0/Región, acorde a "la comuna DEL DESTINO
    (local de entrega)" — singular en la HU.
  - Cada equipo tiene un solo tipo de operación (`code` de su taxonomía): cuenta
    en Tractoreo o en Equipo Completo, nunca en los dos. Los sin tipo no entran.
  - El filtro de cliente aplica una sola regla a todas las cifras (_clientes_de_la_fila):
    con carga, el cliente del viaje; sin carga, los clientes de su empresa en el directorio.
  - El cliente se muestra con el nombre del directorio (public.shippers), no
    con el texto crudo del TMS, igual que el resto del Cierre.
"""
from collections.abc import Iterable
from datetime import date as _date

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..authz import Permission, require
from ..db import get_pool
from ..services.fleet_driver_gap import compute_fleet_driver_gap
from ..services.origen_del_viaje import origen_del_viaje
from ..services.cierre_lineas import (
    GRUPO_NO_TRABAJANDO, GRUPO_TRABAJANDO_SIN_ASIGNACION, LINEAS_CONDUCTORES, LINEAS_TRACTOS, frescura_del_dia,
)
from ..services.driver_roster import TRACTOREO_ROSTER_CTE
from .trips import _load_operation_type_buckets, _resolve_operation_type

router = APIRouter(prefix="/status-report", tags=["status-report"])

# Los dos tipos del reporte: clave de la API → código estable de la taxonomía.
_TIPOS = {"tractoreo": "TRACTOREO", "equipo_completo": "EQUIPO_COMPLETO"}


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

# "Con carga hoy" — app.trips_del_dia(), el mismo criterio del Cierre, para
# todos los TMS. Trae también planning_date (para los viajes de varios días),
# el conductor resuelto (para "Segundas vueltas") y el último destino (para clasificar RM/Z0/Región, §7.6).
_TODAY_TRIPS_SQL = f"""
SELECT
    t.id AS trip_id,
    vfr.resolved_tractor_asset_id AS asset_id,
    -- El nombre del directorio: el TMS manda "walmart" o "WALMART".
    COALESCE(sh.name, t.client_name) AS client_name,
    t.planning_date,
    d.full_name AS driver_name,
    t.status_reported_at,
    {origen_del_viaje('t')} AS origin_cd,
    (
        SELECT ts.local FROM app.trip_stops ts
        WHERE ts.trip_id = t.id AND ts.stop_type = 'DESTINATION'
        ORDER BY ts.stop_order DESC LIMIT 1
    ) AS last_destination_local
FROM app.trips t
JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
LEFT JOIN public.drivers d ON d.id = vfr.resolved_driver_id
LEFT JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
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
    derivan las secciones de cada tipo (mismo patrón que fleet_daily_overview/
    equipment_closures: calcular una vez, derivar todo en Python)."""
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
        SELECT eds.asset_id, eds.status, eds.requires_motivo, eds.category, st.label AS unassigned_reason_label,
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
            "driver_name": latest["driver_name"] if latest else None,
            "dias_en_curso": dias_en_curso,
            "vueltas": max((leg_by_trip.get(t["trip_id"], 1) for t in asset_trips), default=0),
            "unassigned_reason_label": status_row["unassigned_reason_label"] if status_row else None,
            # La categoría de la línea, tal como la calcula cierre_lineas: el
            # reporte no la deduce del motivo por su cuenta.
            "category": status_row["category"] if status_row else None,
        })
    return rows


async def _build_driver_rows(pool, business_date: _date) -> list[dict]:
    """Insumo de la Sección 4 (Tarea 6, plan 2.3): una fila por conductor
    del roster Tractoreo (TRACTOREO_ROSTER_CTE) que hoy está UNASSIGNED —
    ASSIGNED no entra (tiene carga) y MISMATCH tampoco (inconsistencia de
    datos que se resuelve en Pendientes/pre-cierre, no es parte de este
    reporte). con_carga queda fijo en False: estas filas son, por definición,
    conductores sin carga."""
    # Las líneas del día ya están calculadas (las mantiene el ejecutor de la
    # cola, services/cola_del_cierre.py): este reporte solo las lee.
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
            "carrier_id": r["carrier_id"],
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


# Los clientes de cada empresa, del directorio: el mismo cruce que daily_closures.py.
_SQL_CLIENTES_POR_EMPRESA = """
SELECT cs.carrier_id, array_agg(DISTINCT sh.name ORDER BY sh.name) AS clients
FROM public.carrier_shippers cs
JOIN public.shippers sh ON sh.id = cs.shipper_id AND sh.status = 'ACTIVE'
WHERE cs.status = 'ACTIVE'
GROUP BY cs.carrier_id
"""


def _clientes_de_la_fila(fila: dict, clientes_por_empresa: dict) -> list[str]:
    """A qué clientes pertenece una fila del reporte (spec 2026-10-11). Es la
    única regla de pertenencia, y la usan por igual equipos, conductores y
    faltante de dotación:
      - con carga: al cliente de su viaje del día;
      - sin carga, o sin noción de carga (conductor que no trabajó, faltante de
        dotación): a cada cliente de su empresa en el directorio.
    Así, con "Walmart" elegido, el reporte habla de la flota que trabaja para
    Walmart, haya cargado o no."""
    if fila.get("con_carga"):
        return [fila["client_name"]] if fila["client_name"] else []
    return list(clientes_por_empresa.get(fila["carrier_id"], []))


def _filter_by_client(rows: list[dict], client: str | None, clientes_por_empresa: dict) -> list[dict]:
    if not client:
        return rows
    buscado = client.strip().lower()
    return [
        r for r in rows
        if any(c.strip().lower() == buscado for c in _clientes_de_la_fila(r, clientes_por_empresa))
    ]


def _clientes_del_dia(rows: list[dict]) -> list[dict]:
    """Las opciones del filtro: los clientes con al menos un equipo de los tipos
    del reporte cargado ese día, con cuántos. Sale del día completo, antes del
    filtro, para que la lista no cambie al elegir."""
    acc: dict = {}
    for r in rows:
        if r["con_carga"] and r["client_name"] and any(c in _TIPOS.values() for c in r["categories"]):
            acc[r["client_name"]] = acc.get(r["client_name"], 0) + 1
    return [{"client_name": k, "assigned": v} for k, v in sorted(acc.items(), key=lambda kv: (-kv[1], kv[0]))]


# Las columnas de motivo salen del catálogo, no de una lista escrita a mano:
# la que había (y su copia en StatusReportSection.tsx) dejaba fuera 9 motivos
# que sólo sumaban al total. $1 es el grupo; un motivo sin grupo se lee como
# "no trabajando", igual que en cierre_lineas.
# La etiqueta visible del motivo "Sin conductor", por su código estable
# (migración 20260917000000): renombrarlo desde Configuración no rompe nada.
_SQL_ETIQUETA_SIN_CONDUCTOR = (
    "SELECT label FROM app.status_taxonomies WHERE domain = 'DRIVER_REASON' AND code = 'SIN_CONDUCTOR'"
)

_SQL_MOTIVOS_DEL_GRUPO = f"""
SELECT label FROM app.status_taxonomies
WHERE domain = 'DRIVER_REASON' AND active
  AND COALESCE(group_id, '{GRUPO_NO_TRABAJANDO}') = $1
ORDER BY sort_order, label
"""


_SIN_MOTIVO = "Sin motivo"
_TRABAJO_SIN_ASIGNACION = "TRABAJANDO_SIN_ASIGNACION"
# Quien no trabajó, y quien todavía no tiene motivo: no se sabe si trabajó.
_NO_TRABAJO = ("NO_TRABAJANDO", "SIN_RESOLVER")
_ZONA_A_CLAVE = {"RM": "rm", "Z0": "z0", "Región": "region", "Sin clasificar": "unclassified"}


def _motivo(label: str | None) -> str:
    """Una línea sin motivo cuenta en "Sin motivo": sin esa columna, el total de
    la fila no cuadraría con la suma de las que se ven."""
    return label or _SIN_MOTIVO


def _motivos_que_ocurrieron(catalogo: list[str], ocurridos: Iterable[str]) -> list[str]:
    """Las columnas de motivo: solo las que tuvieron casos ese día (spec 2026-10-11),
    en el orden del catálogo de Configuración. Después, las retiradas que
    aparezcan (un día pasado puede tener una), y "Sin motivo" al final."""
    vistos = set(ocurridos)
    columnas = [m for m in catalogo if m in vistos]
    columnas += sorted(vistos - set(catalogo) - {_SIN_MOTIVO})
    return columnas + ([_SIN_MOTIVO] if _SIN_MOTIVO in vistos else [])


def _por_motivo(filas: list[dict]) -> list[dict]:
    """Origen × empresa, con un conteo por motivo. `filas` trae
    {origin, carrier_name, reason, n}: n es 1 por persona o equipo, o el
    faltante de dotación entero."""
    acc: dict = {}
    for f in filas:
        b = acc.setdefault((f["origin"], f["carrier_name"]),
                           {"origin": f["origin"], "carrier_name": f["carrier_name"], "counts": {}, "total": 0})
        b["counts"][f["reason"]] = b["counts"].get(f["reason"], 0) + f["n"]
        b["total"] += f["n"]
    return [acc[k] for k in sorted(acc, key=lambda k: (k[0], k[1] or ""))]


def _resumen_del_tipo(rows: list[dict]) -> dict:
    """Las cuatro cifras del tipo, asignados por cliente y la asistencia por
    origen habitual. La asistencia va por el origen DECLARADO: "enrolados"
    incluye a los que no salieron, y esos no tienen origen real (HU-28)."""
    total = len(rows)
    assigned = sum(1 for r in rows if r["con_carga"])
    por_cliente: dict = {}
    por_origen: dict = {}
    # Los que siguen en un viaje planificado días antes: cuántos, por días atrás.
    varios_dias: dict = {}
    for r in rows:
        if r["con_carga"] and (r["dias_en_curso"] or 0) > 0:
            dias = str(r["dias_en_curso"])
            varios_dias[dias] = varios_dias.get(dias, 0) + 1
        if r["con_carga"]:
            cliente = r["client_name"] or "Sin cliente"
            por_cliente[cliente] = por_cliente.get(cliente, 0) + 1
        origen = r["home_cd"] or "Sin origen"
        b = por_origen.setdefault(origen, {"origin": origen, "enrolled": 0, "assigned": 0})
        b["enrolled"] += 1
        b["assigned"] += 1 if r["con_carga"] else 0
    return {
        "total": total,
        "assigned": assigned,
        "not_working": sum(1 for r in rows if not r["con_carga"] and r["category"] in _NO_TRABAJO),
        "utilization_pct": round(assigned / total * 100, 1) if total else 0.0,
        "by_client": [{"client_name": k, "assigned": v} for k, v in sorted(por_cliente.items())],
        "by_home_origin": [por_origen[k] for k in sorted(por_origen)],
        "multi_day": {"total": sum(varios_dias.values()),
                      "by_days_back": dict(sorted(varios_dias.items(), key=lambda kv: int(kv[0])))},
    }


def _asignados(rows: list[dict]) -> list[dict]:
    """Cliente × origen REAL del viaje × empresa, por tipo de destino: la tabla
    del CSV de Pablo (minuta 09/10, ítem 14). Una fila por hoja del árbol; los
    subtotales los arma el frontend (lib/reporte/arbolDeAsignados.ts).
    `vehicles` son los tractos de la fila con su conductor: la vista por
    conductor (pedido del usuario 11/10). Primero los que tienen conductor, por
    nombre; los sin conductor resuelto al final."""
    acc: dict = {}
    for r in rows:
        if not r["con_carga"]:
            continue
        clave = (r["client_name"] or "Sin cliente", r["origin_cd"] or "Sin origen", r["carrier_name"] or "Sin empresa")
        b = acc.setdefault(clave, {"client_name": clave[0], "origin": clave[1], "carrier_name": clave[2],
                                   "rm": 0, "z0": 0, "region": 0, "unclassified": 0, "total": 0,
                                   "vehicles": []})
        zona = _ZONA_A_CLAVE[r["destination_zone"] or "Sin clasificar"]
        b[zona] += 1
        b["total"] += 1
        b["vehicles"].append({"tractor_plate": r["tractor_plate"], "driver_name": r["driver_name"], "zone": zona})
    for b in acc.values():
        b["vehicles"].sort(key=lambda v: (v["driver_name"] is None, v["driver_name"] or "", v["tractor_plate"] or ""))
    return [acc[k] for k in sorted(acc)]


def _cargaron_en_otro_origen(rows: list[dict]) -> list[dict]:
    """Los que cargaron en un origen distinto al habitual (HU-28, ola 4.1).
    Declarar el origen habitual sirve para VER cuándo no calza. Sin origen
    habitual no hay con qué comparar, y sin carga no hay origen."""
    return sorted(
        (
            {"tractor_plate": r["tractor_plate"], "carrier_name": r["carrier_name"],
             "home_origin": r["home_cd"], "origin": r["origin_cd"], "client_name": r["client_name"]}
            for r in rows
            if r["con_carga"] and r["home_cd"] and r["origin_cd"] and r["home_cd"] != r["origin_cd"]
        ),
        key=lambda d: (d["home_origin"], d["origin"], d["tractor_plate"] or ""),
    )


def _trabajaron_sin_asignacion(rows: list[dict], catalogo: list[str]) -> dict:
    """Los que trabajaron sin viaje (Se retira sin carga, Esperando carga…),
    en su origen habitual: no salieron a ningún lado (minuta 09/10)."""
    filas = [
        {"origin": r["home_cd"] or "Sin origen", "carrier_name": r["carrier_name"],
         "reason": _motivo(r["unassigned_reason_label"]), "n": 1}
        for r in rows if not r["con_carga"] and r["category"] == _TRABAJO_SIN_ASIGNACION
    ]
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)), "rows": _por_motivo(filas)}


def _segundas_vueltas(rows: list[dict]) -> list[dict]:
    """Una fila por PATENTE con 2+ vueltas: la vuelta es del tracto (minuta
    09/10). El conductor es el del último viaje del día."""
    return [
        {"tractor_plate": r["tractor_plate"], "carrier_name": r["carrier_name"], "driver_name": r["driver_name"],
         "origin": r["origin_cd"], "destination_zone": r["destination_zone"], "legs": r["vueltas"]}
        for r in rows if r["con_carga"] and r["vueltas"] >= 2
    ]


def _no_trabajaron_por_conductor(
    driver_rows: list[dict], catalogo: list[str], *, faltantes: list[dict], sin_conductor: str | None,
) -> dict:
    """Tractoreo: por CONDUCTOR (plan 2.3, Tarea 6), en su origen habitual.
    "Sin conductor" suma además el faltante de la dotación de cada empresa
    (minuta 09/10, ítem 13; la misma cuenta de la pestaña Dotación). Esos
    conductores no existen, así que van en "Sin origen". Si el motivo no está
    activo en el catálogo, no se inventa la columna."""
    filas = [
        {"origin": d["home_cd"] or "Sin origen", "carrier_name": d["carrier_name"],
         "reason": _motivo(d["unassigned_reason_label"]), "n": 1}
        for d in driver_rows
    ]
    if sin_conductor in catalogo:
        filas += [
            {"origin": "Sin origen", "carrier_name": f["business_name"], "reason": sin_conductor, "n": f["gap"]}
            for f in faltantes if f["gap"] > 0
        ]
    detail = sorted(
        ({"name": d["full_name"], "carrier_name": d["carrier_name"], "home_origin": d["home_cd"],
          "reason": _motivo(d["unassigned_reason_label"]), "tractor_plate": d["tractor_plate"]}
         for d in driver_rows),
        key=lambda d: (d["carrier_name"] or "", d["name"]),
    )
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)),
            "by_reason": _por_motivo(filas), "detail": detail}


def _no_trabajaron_por_equipo(rows: list[dict], catalogo: list[str]) -> dict:
    """Equipo Completo: por EQUIPO sin carga en el grupo "no trabajó", con el
    motivo de su línea del cierre."""
    sin_trabajar = [r for r in rows if not r["con_carga"] and r["category"] in _NO_TRABAJO]
    filas = [
        {"origin": r["home_cd"] or "Sin origen", "carrier_name": r["carrier_name"],
         "reason": _motivo(r["unassigned_reason_label"]), "n": 1}
        for r in sin_trabajar
    ]
    detail = sorted(
        ({"name": r["tractor_plate"], "carrier_name": r["carrier_name"], "home_origin": r["home_cd"],
          "reason": _motivo(r["unassigned_reason_label"]), "tractor_plate": r["tractor_plate"]}
         for r in sin_trabajar),
        key=lambda d: (d["carrier_name"] or "", d["name"] or ""),
    )
    return {"reasons": _motivos_que_ocurrieron(catalogo, (f["reason"] for f in filas)),
            "by_reason": _por_motivo(filas), "detail": detail}


def _empresas(rows: list[dict]) -> list[dict]:
    """Utilización por empresa del tipo, la de mayor utilización primero."""
    acc: dict = {}
    for r in rows:
        b = acc.setdefault(r["carrier_name"], {"carrier_name": r["carrier_name"], "enrolled": 0, "assigned": 0,
                                               "unassigned": 0})
        b["enrolled"] += 1
        b["assigned" if r["con_carga"] else "unassigned"] += 1
    return sorted(
        ({**b, "utilization_pct": round(b["assigned"] / b["enrolled"] * 100, 1)} for b in acc.values()),
        key=lambda b: b["utilization_pct"], reverse=True,
    )


def _reporte_del_tipo(rows: list[dict], *, no_trabajaron: dict, catalogo_sin_asignacion: list[str]) -> dict:
    return {
        "summary": _resumen_del_tipo(rows),
        "assigned": {"rows": _asignados(rows), "other_origin": _cargaron_en_otro_origen(rows)},
        "worked_without_assignment": _trabajaron_sin_asignacion(rows, catalogo_sin_asignacion),
        "second_legs": _segundas_vueltas(rows),
        "not_working": no_trabajaron,
        "carriers": _empresas(rows),
    }


@router.get("")
async def get_status_report(fecha: str, client: str | None = None, pool=Depends(get_pool), _=Depends(require(Permission.OPERATIONS_READ))):
    business_date = _parse_business_date(fecha)
    clientes_por_empresa = {r["carrier_id"]: list(r["clients"]) for r in await pool.fetch(_SQL_CLIENTES_POR_EMPRESA)}
    all_rows = await _build_asset_rows(pool, business_date)
    rows = _filter_by_client(all_rows, client, clientes_por_empresa)
    por_tipo = {clave: [r for r in rows if codigo in r["categories"]] for clave, codigo in _TIPOS.items()}
    # Conductores y faltante de dotación, con la misma regla de pertenencia.
    driver_rows = _filter_by_client(await _build_driver_rows(pool, business_date), client, clientes_por_empresa)
    faltantes = _filter_by_client(await compute_fleet_driver_gap(pool), client, clientes_por_empresa)
    catalogo_no_trabajo = [r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_NO_TRABAJANDO)]
    catalogo_sin_asignacion = [
        r["label"] for r in await pool.fetch(_SQL_MOTIVOS_DEL_GRUPO, GRUPO_TRABAJANDO_SIN_ASIGNACION)
    ]
    no_trabajaron = {
        "tractoreo": _no_trabajaron_por_conductor(
            driver_rows, catalogo_no_trabajo, faltantes=faltantes,
            sin_conductor=await pool.fetchval(_SQL_ETIQUETA_SIN_CONDUCTOR),
        ),
        "equipo_completo": _no_trabajaron_por_equipo(por_tipo["equipo_completo"], catalogo_no_trabajo),
    }
    return {
        "business_date": business_date.isoformat(),
        "client_filter": client,
        "clients": _clientes_del_dia(all_rows),
        "by_operation_type": {
            clave: _reporte_del_tipo(
                por_tipo[clave], no_trabajaron=no_trabajaron[clave], catalogo_sin_asignacion=catalogo_sin_asignacion,
            )
            for clave in _TIPOS
        },
        **await frescura_del_dia(pool, business_date),
    }
