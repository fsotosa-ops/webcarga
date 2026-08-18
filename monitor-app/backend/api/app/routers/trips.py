import hashlib
import json
import re
import unicodedata
from datetime import date as _date
from datetime import datetime
from typing import Annotated, Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.trip import AsignarConductorBody, TripBulkCloseBody, TripPatch, TripStopPatch
from ..services.audit import log_change
from ..services.cierre_viajes import SQL_GRUPOS_CIERRE


def _parse_date(s: str) -> _date | None:
    try:
        return _date.fromisoformat(s) if s else None
    except ValueError:
        return None


_CHILE_TZ = ZoneInfo("America/Santiago")


def _parse_timestamptz(s: str | None) -> datetime | None:
    """asyncpg no acepta str para un parámetro casteado a ::timestamptz (usa
    protocolo binario, exige datetime.datetime) — hay que parsear acá antes
    de mandarlo. Bug real encontrado en vivo 2026-07-17 verificando Fase 2
    (mismo patrón ya estaba roto en cag_inicio_at/cag_fin_at, sin cobertura
    porque los tests mockean el pool y nunca ejecutan SQL real).

    Si el string no trae offset (caso normal: el frontend manda hora local
    de Chile sin zona, mismo formato que datetime-local del browser), hay
    que fijar la zona EXPLÍCITAMENTE acá — asyncpg interpreta un
    datetime.datetime naive usando el huso horario del SISTEMA OPERATIVO
    donde corre el proceso, no el de la sesión de Postgres. Confirmado en
    vivo: en una máquina con TZ=America/Santiago el round-trip da la hora
    correcta por pura coincidencia; en un contenedor de Cloud Run (TZ=UTC
    casi seguro) el mismo código habría guardado la hora 3-4 horas
    corrida. Mismo criterio de conversión que ya usa parse_date_tms en el
    pipeline dbt (AT TIME ZONE 'America/Santiago'), aplicado acá porque
    asyncpg no permite ese macro."""
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, f"Fecha/hora inválida: '{s}'")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_CHILE_TZ)
    return dt


_TRIP_STOP_FIELDS = (
    "stop_id, trip_id, stop_order, stop_type, local, destination_city, destination_region, "
    "on_time_status, milestone_status, s2s, delivery_numbers, temperature, planning_date, "
    "arrival_date, departure_date, departure_date_prog, gps_arrival_date, "
    "gps_departure_date, unload_start, unload_end, desc_inicio_manual, desc_fin_manual, "
    "arrival_date_manual, departure_date_manual, "
    "created_at, updated_at"
)


def _stop_display_key(d: dict):
    """Orden de despliegue: origen siempre primero; destinos ordenados por
    llegada ascendente. Paradas sin llegada van al final, con stop_order
    como desempate estable entre paradas sin llegada o con la misma fecha
    (bug real 2026-07-28: stop_order refleja un orden inestable calculado
    aguas arriba por dbt, no una posición fiable — ver AGENTLOG Ronda
    58/59).

    FIX 2026-08-01: la llegada usada para ordenar prioriza gps_arrival_date
    sobre arrival_date (TR) — antes solo miraba TR, que QAnalytics reporta
    en ~8% de las paradas. Con 2 destinos ambos sin TR, empataban y caían a
    stop_order crudo, mostrando el destino SIN evidencia de visita ANTES
    del que sí tenía gps_arrival_date real (viaje 2021621 confirmado en
    vivo). Como el estado done/activo/pendiente del frontend es puramente
    posicional respecto al índice de is_active (ver _mark_active_stop,
    misma prioridad GPS-primero), un orden incorrecto invertía también
    "completado" vs "pendiente" en la UI, no solo la posición visual."""
    is_origin = d.get("stop_type") == "ORIGIN"
    arrival = d.get("gps_arrival_date") or d.get("arrival_date")
    return (0 if is_origin else 1, arrival is None, arrival or "", d["stop_order"])


def _stop_arrived(d: dict) -> bool:
    """GPS es la señal principal (reportado ~87% de las veces en paradas
    reales de QAnalytics) — TR (arrival_date) es el fallback, se reporta
    en solo ~8% de las paradas."""
    return bool(d.get("gps_arrival_date") or d.get("arrival_date"))


def _stop_departed(d: dict) -> bool:
    return bool(d.get("gps_departure_date") or d.get("departure_date"))


def _cargo_delivered(stops: list[dict]) -> bool:
    """True cuando el camión ya salió de TODOS sus destinos — no queda
    carga fría a bordo. Bug real reportado 2026-08-01: QAnalytics reporta
    'T°' como la lectura EN VIVO del vehículo (confirmado con datos reales:
    62 paradas nunca visitadas ya traían temperatura poblada, y el primer
    scrape de un viaje ya mostraba la misma T° en todas las paradas antes
    de llegar a ninguna) — no una foto histórica por parada. Una vez
    entregada toda la carga, esa misma lectura sigue subiendo (vehículo
    vacío) pero ya no representa un posible incumplimiento de cadena de
    frío — se usa para dejar de evaluar temp_out desde ese punto (ver
    kpis.ts, temperature.ts)."""
    destinations = [d for d in stops if d.get("stop_type") != "ORIGIN"]
    return bool(destinations) and all(_stop_departed(d) for d in destinations)


def _latest_temp_stop(stops: list[dict]) -> dict | None:
    """Misma prioridad que _mark_active_stop: parada activa primero, si no
    tiene lectura propia cae a la última parada visitada (en el orden ya
    resuelto por _stop_display_key) con temperatura no nula. Requiere que
    is_active ya esté marcado (llamar después de _mark_active_stop)."""
    active = next((d for d in stops if d.get("is_active")), None)
    if active is not None and active.get("temperature") is not None:
        return active
    visited = [d for d in stops if _stop_arrived(d)]
    for d in reversed(visited):
        if d.get("temperature") is not None:
            return d
    return None


def _classify_temperature(
    temp: float | None, cargo_type: str | None, ranges: dict[str, tuple[float, float]]
) -> str | None:
    """cargo_type es texto libre reportado por la TMS (no un enum fijo) —
    un viaje cuyo cargo_type no matchea ninguna fila de app.temperature_ranges
    queda intencionalmente sin clasificar (None), no se asume un rango
    default."""
    if temp is None or not cargo_type:
        return None
    r = ranges.get(cargo_type)
    if r is None:
        return None
    min_c, max_c = r
    return "out_of_range" if (temp < min_c or temp > max_c) else "ok"


def _trip_temp_status(
    stops: list[dict], cargo_type: str | None, cargo_delivered: bool,
    ranges: dict[str, tuple[float, float]],
) -> str | None:
    """Clasificación de cumplimiento de cadena de frío del viaje. FIX
    2026-08-01: vivía en el frontend (temperature.ts) — se movió acá
    porque es una regla de negocio real, misma categoría que
    _mark_active_stop/_cargo_delivered, no una decisión de presentación.
    Una vez cargo_delivered=True, nunca cuenta como incumplimiento aunque
    la lectura en vivo del vehículo (vacío) esté fuera de rango — ver
    _cargo_delivered."""
    if cargo_delivered:
        return None
    stop = _latest_temp_stop(stops)
    if stop is None:
        return None
    return _classify_temperature(stop.get("temperature"), cargo_type, ranges)


async def _load_temperature_ranges(pool) -> dict[str, tuple[float, float]]:
    rows = await pool.fetch("SELECT cargo_type, min_c, max_c FROM app.temperature_ranges")
    return {r["cargo_type"]: (r["min_c"], r["max_c"]) for r in rows}


def _annotate_stop_temp_status(
    stops: list[dict], cargo_type: str | None, ranges: dict[str, tuple[float, float]]
) -> None:
    """Clasificación de cumplimiento POR PARADA — 2026-08-01, pedido
    explícito del usuario tras congelar `temperature` al salir de cada
    destino (trip_stops.sql): a diferencia de _trip_temp_status, esta
    clasificación NUNCA se apaga por cargo_delivered — un valor ya
    congelado es exactamente lo que se quiere auditar por entrega, incluso
    después de que el viaje completo termine. Solo se clasifican paradas
    YA visitadas: una parada pendiente todavía espeja la lectura EN VIVO
    del vehículo (no es su propio dato todavía), clasificarla sugeriría
    una falsa certeza sobre una entrega que ni siquiera ocurrió."""
    for d in stops:
        d["temp_status"] = (
            _classify_temperature(d.get("temperature"), cargo_type, ranges)
            if _stop_arrived(d) else None
        )


def _mark_active_stop(stops: list[dict]) -> None:
    """Marca exactamente una parada con is_active=True (o ninguna, si el
    viaje ya completó todas sus paradas) — única fuente de verdad de "en
    qué parada está el camión ahora", consumida por el frontend (antes
    reimplementada, con reglas ligeramente distintas, en 2 archivos
    separados: lib/utils/temperature.ts y StopTimeline.tsx).

    FIX 2026-08-01 (bug real reportado en producción): el origen no tiene
    "llegada" — su única señal de salida es departure_date/gps_departure_date,
    pero QAnalytics y Sodimac (~90% de los viajes activos) nunca la
    reportan (solo Wingsuite la reporta, ver Ronda 61). Sin el fallback de
    abajo, el origen quedaba marcado como parada activa PARA SIEMPRE en
    esos viajes, aunque el GPS ya hubiera visto al camión en un destino
    real más adelante (viaje 2021346 confirmado en vivo)."""
    origin = next((d for d in stops if d.get("stop_type") == "ORIGIN"), None)
    origin_departed = (
        origin is None
        or _stop_departed(origin)
        or any(d.get("stop_type") != "ORIGIN" and _stop_arrived(d) for d in stops)
    )
    relevant = [d for d in stops if d.get("stop_type") != "ORIGIN" or not origin_departed]

    active = next((d for d in relevant if _stop_arrived(d) and not _stop_departed(d)), None)
    if active is None:
        active = next((d for d in relevant if not _stop_arrived(d) and not _stop_departed(d)), None)
    # FIX 2026-08-02 (bug real reportado en vivo, viajes 2021621/30159639):
    # antes, si NINGUNA parada relevante calzaba en los 2 casos de arriba
    # (es decir, TODAS ya llegaron Y salieron — el viaje entregó todo y
    # está retornando), se caía a "la última visitada" como fallback y esa
    # parada quedaba marcada is_active=True aunque ya tuviera salida real
    # registrada — se veía "en curso" (pulsing) en vez de "completada"
    # (check verde) tanto en la tabla como en el detalle del viaje. Este
    # caso ya estaba identificado en la Ronda 63 pero se dejó a propósito
    # por no ser parte del bug de ese momento; el docstring de esta función
    # siempre documentó el comportamiento correcto ("o ninguna, si el viaje
    # ya completó todas sus paradas") — el código no lo cumplía. Ahora sí:
    # sin fallback adicional, active queda None.

    for d in stops:
        d["is_active"] = d is active


def _stop_dedup_key(d: dict):
    """Prioridad de desempate cuando dos filas comparten (trip_id, stop_type,
    stop_order) — ver _load_trip_stops. `(v is not None, v)` evita comparar
    None contra un valor real: si ambos lados son None, Python resuelve la
    tupla completa por igualdad antes de necesitar comparar los None entre
    sí, así que nunca explota con TypeError."""
    def rank(v):
        return (v is not None, v)
    return (
        rank(d.get("updated_at")),
        rank(d.get("created_at")),
        d.get("local") is not None,
        d.get("arrival_date") is not None,
    )


async def _load_trip_stops(pool, trip_ids: set[str]) -> dict[str, list[dict]]:
    """Carga app.trip_stops en batch (Fase 2 del hardening H2.6 — reemplaza
    el jsonb app.trips.stops + el parche stop_manual_fields). Resuelve
    unload_start/unload_end contra el override manual (desc_inicio_manual/
    desc_fin_manual, columnas reales — antes jsonb keyed por stop_id) al
    mismo tiempo que arma la lista, sin N+1.

    Bug real encontrado 2026-07-28: el pipeline dbt calcula stop_id con
    md5(trip_id + nombre_del_local + orden) — cuando el TMS corrige el
    nombre de una parada entre dos pasadas de scraping, el hash cambia y el
    MERGE inserta una fila nueva en vez de actualizar la vieja, dejando
    huérfanas filas duplicadas para la misma posición real del viaje. Se
    colapsa acá a una sola fila por (trip_id, stop_type, stop_order) — gana
    la que _stop_dedup_key considere más reciente/completa. Es un
    heurístico de lectura, no corrige las filas duplicadas en la tabla (ver
    docs/superpowers/plans/2026-07-28-locales-duplicados-trip-stops-plan.md
    para el fix de raíz en el pipeline)."""
    if not trip_ids:
        return {}
    rows = await pool.fetch(
        f"SELECT {_TRIP_STOP_FIELDS} FROM app.trip_stops "
        "WHERE trip_id = ANY($1::uuid[]) ORDER BY trip_id, stop_order",
        list(trip_ids),
    )
    best_by_position: dict[tuple, dict] = {}
    for r in rows:
        d = dict(r)
        key = (str(d["trip_id"]), d.get("stop_type"), d["stop_order"])
        current = best_by_position.get(key)
        if current is None or _stop_dedup_key(d) > _stop_dedup_key(current):
            best_by_position[key] = d

    stops_by_trip: dict[str, list[dict]] = {}
    for d in best_by_position.values():
        trip_id = str(d.pop("trip_id"))
        stops_by_trip.setdefault(trip_id, []).append(d)

    for stops in stops_by_trip.values():
        # Resolver overrides manuales ANTES de ordenar: si el equipo de
        # operaciones cargó a mano un arrival_date que la TMS nunca reportó,
        # la parada debe ordenarse por ese valor, no seguir al final como si
        # siguiera sin llegada.
        for d in stops:
            desc_inicio_manual = d.pop("desc_inicio_manual")
            desc_fin_manual = d.pop("desc_fin_manual")
            if desc_inicio_manual is not None:
                d["unload_start"] = desc_inicio_manual
            if desc_fin_manual is not None:
                d["unload_end"] = desc_fin_manual
            d["desc_manual"] = desc_inicio_manual is not None or desc_fin_manual is not None

            arrival_date_manual = d.pop("arrival_date_manual")
            departure_date_manual = d.pop("departure_date_manual")
            if arrival_date_manual is not None:
                d["arrival_date"] = arrival_date_manual
            if departure_date_manual is not None:
                d["departure_date"] = departure_date_manual
            d["arrival_manual"] = arrival_date_manual is not None
            d["departure_manual"] = departure_date_manual is not None
            # GPS Llegada/Salida son inamovibles (minuta 29/07 §4.2, fix
            # 2026-07-31) — nunca se resuelve un override manual acá, a
            # diferencia de arrival_date/departure_date arriba.

        stops.sort(key=_stop_display_key)
        _mark_active_stop(stops)
        for d in stops:
            d.pop("stop_order")
            d.pop("created_at")
            d.pop("updated_at")
    return stops_by_trip


_LOCAL_NUMBER_PATTERN = re.compile(r"^(.*?)\s*-\s*(\d+)\s*$")


def _split_local(local: str | None) -> tuple[str | None, str | None]:
    """Extrae (nombre, número) de un string de local tipo "ALAMEDA - 72"
    (patrón real de stops[].local para Walmart). Si no matchea (ej. los CDs
    de origen: "CD LO AGUIRRE", que nunca traen número) el string completo
    se trata como nombre, sin número — resuelve por nombre solo."""
    if not local:
        return None, None
    local = local.strip()
    m = _LOCAL_NUMBER_PATTERN.match(local)
    if m:
        return m.group(1).strip(), m.group(2)
    return local, None


def _normalize_location_name(name: str) -> str:
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", name).strip().upper()


async def _load_operation_type_buckets(pool, client_names: set[str]) -> dict:
    """shipper_name (lower) -> {"by_number": {site_number: [(nombre_norm, operation_type)]},
    "by_name": {nombre_norm: operation_type}} — resuelve operation_type contra
    public.locations, siempre scopeado por shipper (nunca un lookup global de
    site_number, que sería ambiguo si dos shippers reusan el mismo número)."""
    if not client_names:
        return {}
    rows = await pool.fetch(
        """
        SELECT lower(s.name) AS shipper_name, l.name, l.site_number, l.operation_type
        FROM public.locations l
        JOIN public.shippers s ON s.id = l.entity_id AND l.entity_type = 'SHIPPER'
        WHERE lower(s.name) = ANY($1::text[])
          AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
        """,
        list(client_names),
    )
    buckets: dict = {}
    for r in rows:
        bucket = buckets.setdefault(r["shipper_name"], {"by_number": {}, "by_name": {}})
        norm_name = _normalize_location_name(r["name"])
        if r["site_number"]:
            bucket["by_number"].setdefault(r["site_number"], []).append((norm_name, r["operation_type"]))
        bucket["by_name"].setdefault(norm_name, r["operation_type"])
    return buckets


def _resolve_operation_type(bucket: dict | None, local: str | None) -> str | None:
    """Resuelve primero por número (clave más exacta cuando existe); si el
    número aparece más de una vez para el shipper (pasa en 3/490 casos
    reales — ver plan maestro H2.6), desempata por nombre normalizado.
    Sin número (o sin match), cae a lookup por nombre solo."""
    if not bucket or not local:
        return None
    name, number = _split_local(local)
    if number:
        candidates = bucket["by_number"].get(number, [])
        if len(candidates) == 1:
            return candidates[0][1]
        if len(candidates) > 1:
            if name:
                norm = _normalize_location_name(name)
                for cand_name, op in candidates:
                    if cand_name == norm:
                        return op
                # El nombre que reporta el TMS a veces trae el formato como
                # prefijo (ej. parada real "SBA San Bernardo Eucaliptus" vs
                # nombre maestro "San Bernardo Eucaliptus", formato "SBA"
                # aparte) — contención en cualquier sentido, verificado en
                # vivo contra un viaje real 2026-07-17. Solo se acepta si
                # desambigua a un único candidato.
                contained = [op for cand_name, op in candidates if cand_name in norm or norm in cand_name]
                if len(contained) == 1:
                    return contained[0]
            return None
    if name:
        return bucket["by_name"].get(_normalize_location_name(name))
    return None


def _attach_origin(d: dict) -> None:
    """Deriva d['origin'] (nombre del local) desde la parada stop_type=ORIGIN
    de d['stops'] — ya no es una columna propia de app.trips (Fase 1 del
    hardening del Diario, 2026-07-18: origen unificado como parada 0). Se
    computa acá, después de cargar stops, para no romper vistas/consumidores
    que solo necesitan el nombre de origen de un vistazo (ej. TripTable)."""
    origin_stop = next((s for s in d.get("stops", []) if s.get("stop_type") == "ORIGIN"), None)
    d["origin"] = origin_stop["local"] if origin_stop else None


def _apply_operation_types(d: dict, buckets: dict) -> None:
    bucket = buckets.get((d.get("client_name") or "").strip().lower())
    d["origin_operation_type"] = _resolve_operation_type(bucket, d.get("origin"))
    stops = d.get("stops")
    if stops:
        for stop in stops:
            stop["operation_type"] = _resolve_operation_type(bucket, stop.get("local"))


router = APIRouter(prefix="/trips", tags=["trips"])

# SQL fragment that maps actual DB columns to the expected API response shape.
# fleet JSONB holds tractor/driver info; trip_fleet_links holds the resolved
# carrier link (public.carriers — repointed from the legacy
# app.transporter_profiles on 2026-07-17, see migration
# migrate_trip_fleet_links_to_carriers).
_TRIP_SELECT = """
    t.id,
    t.source_system,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    t.trip_status                                  AS current_status,
    -- FIX 2026-07-18 (Fase 1): prioriza el dato resuelto contra la tabla
    -- maestra (public.assets/drivers, vía driver_id/tractor_asset_id) sobre
    -- el texto libre de trip_fleet_links, que a su vez sigue siendo mejor
    -- que el texto crudo del TMS. Antes solo existían los últimos dos
    -- niveles — driver_id/tractor_asset_id se guardaban pero nunca se
    -- resolvían a nombre/patente real.
    -- Fase B (2026-07-22): ta/d/c ahora joinean directo contra el ID ya
    -- resuelto por app.v_trip_fleet_resolution — no hace falta un segundo
    -- COALESCE acá, la vista ya solo devuelve un id por viaje.
    COALESCE(ta.license_plate, fl.tractor_plate,
             t.fleet->>'tractor_plate')           AS tractor_plate,
    -- Valor crudo del TMS, sin resolver contra el vínculo manual — permite
    -- detectar divergencia cuando ops vinculó a mano y el TMS reporta otro
    -- dato después (reconciliación TMS↔manual, Fase 1.5b).
    t.fleet->>'tractor_plate'                     AS tractor_plate_tms,
    COALESCE(tr.license_plate, fl.trailer_plate,
             t.fleet->>'trailer_plate')           AS trailer_plate,
    COALESCE(d.full_name, fl.driver_name_raw,
             t.fleet->>'driver_name_tms')         AS driver_name,
    t.fleet->>'driver_name_tms'                   AS driver_name_tms,
    COALESCE(d.tax_id, t.fleet->>'driver_rut_tms') AS driver_tax_id,
    COALESCE(fl.driver_phone,
             t.fleet->>'driver_phone')            AS driver_phone,
    t.origin_tms,
    c.business_name                                AS carrier_name,
    t.fleet->>'transporter_name_tms'              AS carrier_name_tms,
    -- FIX 2026-07-18 (Fase 1, cutover final): t.origin/cag_inicio_at/
    -- cag_fin_at se eliminaron de app.trips — el nombre de origen ahora se
    -- deriva de la parada ORIGIN en app.trip_stops (_attach_origin, después
    -- de cargar d["stops"]) y Carga Inicio/Fin se edita ahí mismo, con el
    -- mismo mecanismo que Desc. Inicio/Fin de cualquier destino.
    t.origin_region,
    t.origin_city,
    t.cargo_type,
    t.is_active,
    t.is_working,
    t.is_assigned,
    t.is_first_leg,
    t.manual_status,
    t.notes,
    t.comments,
    t.unassigned_reason_id,
    t.manually_edited_fields,
    t.fleet_link_id,
    vfr.resolved_carrier_id                        AS carrier_id,
    vfr.resolved_driver_id                         AS driver_id,
    vfr.resolved_tractor_asset_id                  AS tractor_asset_id,
    fl.trailer_asset_id,
    t.edited_at,
    t.updated_at,
    t.created_at,
    COALESCE(p.full_name, p.email)                 AS edited_by,
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at,
    -- "Vuelta N" del conductor ese día — reemplaza a is_first_leg (manual/
    -- TMS) como fuente del filtro "2ª+ vuelta". Lookup de una fila contra
    -- app.v_driver_daily_trip_legs (migración 20260718120000) — la ventana
    -- vive adentro de esa vista, no acá, para que el resultado sea estable
    -- sin importar qué WHERE aplique la consulta de afuera (list_trips
    -- filtra, get_trip restringe a un solo id — una ventana calculada acá
    -- se rompería en ambos casos). NULL si el viaje no tiene
    -- trip_fleet_links.driver_id explícito (la vista no lo incluye).
    (SELECT vdtl.leg_number FROM app.v_driver_daily_trip_legs vdtl WHERE vdtl.trip_id = t.id) AS driver_leg_number,
    sh.id   AS shipper_id,
    sh.name AS shipper_name,
    {fleet_match_case} AS fleet_match_status,
    c_home.business_name AS fleet_match_driver_home_carrier,
    ins.insurance_alert,
    dcomp.pending_count AS driver_pending_docs,
    dcomp.has_critical_pending AS driver_pending_docs_critical,
    tcomp.pending_count AS tractor_pending_docs,
    tcomp.has_critical_pending AS tractor_pending_docs_critical,
    ccomp.pending_count AS carrier_pending_docs,
    ccomp.has_critical_pending AS carrier_pending_docs_critical,
    notes.last_human_note_at
"""

# HU-04 (Fase 0, 2026-07-21): antes, cuando un viaje no lograba cruzar con
# empresa/conductor (_auto_resolve_fleet_link/el fallback en vivo de acá
# abajo no encontraban match), el caso se perdía en silencio — no quedaba
# ningún flag ni fila que lo distinguiera de "todavía no se intentó
# resolver". Este CASE se repite en el WHERE de list_trips (mismo patrón ya
# usado por second_leg_plus, que tampoco puede referenciar un alias del
# SELECT) para exponer un filtro real. 'MISMATCH' es la subcategoría
# adicional que pidió Pablo en la reunión del 20/07: el conductor tiene
# empresa propia activa (public.driver_assignments) distinta de la empresa
# resuelta para el tracto — "algo tenemos mal puesto", no un simple faltante.
_FLEET_MATCH_CASE = """
    CASE
      WHEN vfr.resolved_carrier_id IS NULL
           AND (t.fleet->>'tractor_plate' IS NOT NULL OR fl.tractor_plate IS NOT NULL
                OR t.fleet->>'driver_name_tms' IS NOT NULL OR fl.driver_name_raw IS NOT NULL)
        THEN 'UNMATCHED'
      WHEN vfr.resolved_driver_home_carrier_id IS NOT NULL
           AND vfr.resolved_driver_home_carrier_id IS DISTINCT FROM vfr.resolved_carrier_id
        THEN 'MISMATCH'
      ELSE 'MATCHED'
    END
"""
_TRIP_SELECT = _TRIP_SELECT.format(fleet_match_case=_FLEET_MATCH_CASE)


def _compliance_alert_lateral(alias: str, entity_type: str, id_expr: str, critical_codes: tuple[str, ...] = ()) -> str:
    """Cierre del gap detectado 2026-07-22: el Diario solo mostraba alerta de
    Seguros (HU-12) — la documentación LEGAL_MANDATORY de conductor/tracto/
    empresa (HU-08/09) nunca llegó a mostrarse acá (el summary endpoint viejo
    que la alimentaba se borró en Checkpoint A-E; TripTable.tsx quedó con un
    ComplianceBadge sin productor). Mismo criterio de is_expired/
    is_expiring_soon que ya usa GET /drivers/{id}/compliance-records y
    _pending_mandatory_join (carriers.py).
    Diseño confirmado por el usuario 2026-07-22: NO un tri-state ok/vencido —
    hoy el 100% de conductores/tractos/empresas tiene al menos 1 documento
    LEGAL_MANDATORY pendiente (verificado contra datos reales, misma consulta
    que ya usa Empresas), así que un badge binario saturaría cada fila del
    Diario sin aportar señal. En cambio: un CONSOLIDADO (cuántos documentos
    pendientes) + un flag de "crítico" cuando el pendiente incluye uno de
    `critical_codes` (ej. Licencia de Conducir/Carnet para conductor, pedido
    explícito del usuario) — se recalcula en cada request, así que baja solo
    a medida que el equipo sube documentación, sin cache que actualizar.
    `entity_type`/`critical_codes` siempre vienen hardcodeados por el caller,
    nunca de request."""
    codes_sql = "ARRAY[" + ", ".join(f"'{c}'" for c in critical_codes) + "]::varchar[]" if critical_codes else "ARRAY[]::varchar[]"
    return f"""
    LEFT JOIN LATERAL (
        SELECT
            -- CASE por {id_expr} IS NULL: distingue "sin conductor/tracto/
            -- empresa resuelto todavía" (NULL, no hay nada que evaluar) de
            -- "resuelto y sin pendientes" (0) — un COUNT(*) FILTER liso sobre
            -- cero filas ya da 0 por sí solo, lo que mentiría "todo en orden"
            -- cuando en realidad no hay ningún ID contra el que preguntar.
            CASE WHEN {id_expr} IS NULL THEN NULL ELSE COUNT(*) FILTER (
                WHERE req.requirement_level = 'LEGAL_MANDATORY' AND (
                    cr.status IN ('MISSING', 'EXPIRED', 'REJECTED')
                    OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE)
                )
            ) END AS pending_count,
            CASE WHEN {id_expr} IS NULL THEN NULL ELSE bool_or(
                req.requirement_level = 'LEGAL_MANDATORY'
                AND req.requirement_code = ANY({codes_sql})
                AND (cr.status IN ('MISSING', 'EXPIRED', 'REJECTED')
                     OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE))
            ) END AS has_critical_pending
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.entity_type = '{entity_type}' AND cr.entity_id = {id_expr} AND cr.is_current = true
    ) {alias} ON true
    """


# Licencia de Conducir/Carnet — pedido explícito del usuario 2026-07-22 como
# "de los más críticos" dentro de la documentación de conductor.
_DRIVER_CRITICAL_DOC_CODES = ("LICENCIA_CONDUCIR", "COPIA_CI_CONDUCTOR")


_TRIP_FROM = """
    FROM app.trips t
    -- FIX 2026-07-18 (Fase 1 del hardening): antes unía por fl.id = t.fleet_link_id,
    -- una columna que dbt resetea a NULL en cada --full-refresh de app.trips
    -- (protegida solo en el MERGE incremental, no en un full-refresh que
    -- reconstruye la tabla completa). Confirmado en vivo: 608 de 609 vínculos
    -- reales quedaron huérfanos (trip_fleet_links.trip_id válido, pero
    -- trips.fleet_link_id en NULL) — la trazabilidad carrier/driver/asset
    -- nunca se veía vía API pese a que el dato existía. trip_id es la llave
    -- estable (trip_fleet_links nunca lo toca el pipeline).
    LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
    -- Fase B (ítem 5, feedback post-weekly 2026-07-22): la cadena de
    -- resolución en vivo (stored → auto por patente → auto por
    -- vehicle_driver_assignments → match exacto de nombre) vivía inline acá
    -- Y en 3 lugares más (available_drivers, available_assets,
    -- daily_closures.py) — la duplicación fue la causa raíz de un bug real
    -- (Ronda 38). Consolidada en app.v_trip_fleet_resolution (migración
    -- 20260722030000), inlineada por el planner — mismo plan de ejecución
    -- que antes, verificado con EXPLAIN antes de aplicar.
    LEFT JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
    LEFT JOIN public.carriers c ON c.id = vfr.resolved_carrier_id
    LEFT JOIN public.drivers d ON d.id = vfr.resolved_driver_id
    LEFT JOIN public.assets ta ON ta.id = vfr.resolved_tractor_asset_id
    LEFT JOIN public.assets tr ON tr.id = fl.trailer_asset_id
    -- HU-04 (Fase 0): empresa PROPIA del conductor (independiente de la
    -- empresa resuelta para el tracto) — permite detectar "MISMATCH" cuando
    -- conductor y tracto calzan cada uno por su lado pero no bajo la misma
    -- empresa (regla explícita de Pablo: ambos deben estar bajo la misma
    -- empresa de transporte). Ver _FLEET_MATCH_CASE.
    LEFT JOIN public.carriers c_home ON c_home.id = vfr.resolved_driver_home_carrier_id
    -- Fase 2 (HU-12, 2026-07-22): alerta de póliza crítica en el Diario —
    -- pedido explícito de Pablo ("recibir una alerta prominente cuando un
    -- equipo tenga póliza vencida o cuotas críticas impagas"). Una empresa
    -- puede tener varias pólizas (app.carrier_insurance_status, 1 fila por
    -- póliza) — se toma el peor caso (regla del eslabón más débil, mismo
    -- criterio ya usado para calcular policy_health). "2+ cuotas impagas"
    -- es el umbral que Pablo mencionó explícitamente en notes-meeting.md.
    LEFT JOIN LATERAL (
        SELECT CASE
            WHEN bool_or(cis.policy_health = 'EXPIRED') THEN 'EXPIRED'
            WHEN bool_or(cis.overdue_installments >= 2) THEN 'OVERDUE_INSTALLMENTS'
            WHEN bool_or(cis.policy_health = 'EXPIRING_SOON') THEN 'EXPIRING_SOON'
        END AS insurance_alert
        FROM app.carrier_insurance_status cis
        WHERE cis.carrier_id = vfr.resolved_carrier_id
    ) ins ON true
    -- Badge "necesita seguimiento en bitácora" (2026-07-28, ver spec
    -- docs/superpowers/specs/2026-07-28-diario-bitacora-followup-badge-design.md):
    -- nota humana más reciente del viaje, para cruzarla en el frontend
    -- contra el momento en que se disparó cada alerta automática.
    -- note_type != 'sistema' excluye las notas auto-generadas (ej.
    -- "Divergencia TMS: ..."), que no cuentan como que un humano atendió
    -- la alerta.
    LEFT JOIN LATERAL (
        SELECT MAX(created_at) AS last_human_note_at
        FROM app.trip_notes
        WHERE trip_id = t.id AND note_type != 'sistema'
    ) notes ON true
""" + _compliance_alert_lateral("dcomp", "DRIVER", "vfr.resolved_driver_id", _DRIVER_CRITICAL_DOC_CODES) \
    + _compliance_alert_lateral("tcomp", "ASSET", "vfr.resolved_tractor_asset_id") \
    + _compliance_alert_lateral("ccomp", "CARRIER", "vfr.resolved_carrier_id") + """
    -- Cliente/shipper real, resuelto en vivo (Ronda 26, Fase 2) — mismo
    -- patrón "resolución en vivo" que driver_id/carrier_id/tractor_asset_id
    -- (Rondas 18-19), sin tocar el pipeline dbt. client_name va a estar
    -- garantizado como el nombre exacto de un shipper real desde que el
    -- formulario de creación usa el directorio real (ClientPicker) — el
    -- match por texto alcanza, no hace falta una columna persistida.
    LEFT JOIN public.shippers sh
        ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    LEFT JOIN public.profiles p ON p.id = t.edited_by
"""

# Allow-listed columnas ordenables — never build ORDER BY from raw user
# input. Los 7 nombres son exactamente los alias de salida de _TRIP_SELECT
# (Postgres permite ORDER BY por alias de la propia consulta), y coinciden
# 1:1 con el type SortKey del frontend (TripTable.tsx) — ordenamiento
# server-side real (2026-08-02), reemplaza al sort 100% client-side de
# antes que solo reordenaba la página ya cargada.
_SORTABLE_COLUMNS = {
    "planning_date", "tractor_plate", "driver_name", "carrier_name",
    "client_name", "current_status", "source_system_trip_id",
    "status_reported_at",
}


@router.get("")
async def list_trips(
    # Annotated[Type, Query(...)] = default, no `Type = Query(default)`: con
    # el segundo estilo, invocar list_trips directo desde Python (fuera del
    # ciclo de request de FastAPI, ej. tests de integración) deja el objeto
    # `Query(...)` como valor real del parámetro no pasado — no el default
    # que aparenta — y explota más abajo (split/fromisoformat sobre un
    # `Query`, no un str). Con Annotated el default del propio parámetro de
    # Python vuelve a ser el valor plano; Query() sólo aporta metadata para
    # el schema/validación de OpenAPI. Confirmado con el filtro de Task 8
    # (no_asignado_webcarga), que se llama así desde tests/test_cierre_viajes.py.
    fecha: Annotated[str, Query()] = "",
    view: Annotated[str, Query()] = "en_curso",      # en_curso | historial
    q: Annotated[str, Query()] = "",
    fecha_desde: Annotated[str, Query()] = "",
    fecha_hasta: Annotated[str, Query()] = "",
    status: Annotated[str, Query()] = "",
    is_active: Annotated[str, Query()] = "",
    is_working: Annotated[str, Query()] = "",
    is_assigned: Annotated[str, Query()] = "",
    second_leg_plus: Annotated[str, Query()] = "",
    tms: Annotated[str, Query()] = "",
    client: Annotated[str, Query()] = "",
    cargo_type: Annotated[str, Query()] = "",
    origin: Annotated[str, Query()] = "",
    origin_region: Annotated[str, Query()] = "",
    origin_city: Annotated[str, Query()] = "",
    fleet_match: Annotated[str, Query()] = "",  # unmatched | mismatch — HU-04 (Fase 0)
    insurance_alert: Annotated[str, Query()] = "",  # EXPIRED | OVERDUE_INSTALLMENTS | EXPIRING_SOON — HU-12 (Fase 2)
    no_asignado_webcarga: Annotated[bool, Query()] = False,
    sort_by: Annotated[str, Query()] = "planning_date",
    sort_dir: Annotated[str, Query()] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    filters: list[str] = [
        "($1 = '' OR t.fleet->>'tractor_plate' ILIKE '%'||$1||'%' "
        "OR fl.tractor_plate ILIKE '%'||$1||'%' "
        "OR t.fleet->>'driver_name_tms' ILIKE '%'||$1||'%' "
        "OR COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms') ILIKE '%'||$1||'%' "
        "OR t.fleet->>'driver_rut_tms' ILIKE '%'||$1||'%' "
        "OR c.business_name ILIKE '%'||$1||'%' "
        "OR t.fleet->>'transporter_name_tms' ILIKE '%'||$1||'%' "
        "OR t.client_name ILIKE '%'||$1||'%' "
        "OR t.source_system_trip_id ILIKE '%'||$1||'%' "
        # Nº de entrega (IANSA): Facturación y Operaciones arrancan desde el
        # número de entrega, no desde el viaje — buscarlo es el flujo de
        # entrada real, no un extra. Vive en app.trip_stops como text[] (una
        # parada puede tener varias), por eso el EXISTS en vez de una columna
        # de t. array_to_string permite match parcial igual que los demás ILIKE.
        # El guard `$1 = ''` de arriba cortocircuita esto cuando no hay búsqueda.
        "OR EXISTS (SELECT 1 FROM app.trip_stops ts_q "
        "WHERE ts_q.trip_id = t.id "
        "AND array_to_string(ts_q.delivery_numbers, ',') ILIKE '%'||$1||'%'))"
    ]
    params: list = [q]

    def add(clause: str, value) -> None:
        params.append(value)
        filters.append(clause.replace("?", f"${len(params)}"))

    if d := _parse_date(fecha):
        add("t.planning_date = ?", d)
    if d := _parse_date(fecha_desde):
        add("t.planning_date >= ?", d)
    if d := _parse_date(fecha_hasta):
        add("t.planning_date <= ?", d)
    if status:
        statuses = [s.strip() for s in status.split(',') if s.strip()]
        add("t.trip_status = ANY(?)", statuses)
    if is_active == "true":
        filters.append("t.is_active = true")
    elif is_active == "false":
        filters.append("t.is_active = false")
    if is_working == "true":
        filters.append("t.is_working = true")
    elif is_working == "false":
        filters.append("t.is_working = false")
    if is_assigned == "true":
        filters.append("t.is_assigned = true")
    elif is_assigned == "false":
        filters.append("t.is_assigned = false")
    # "2ª+ vuelta" — reemplaza a is_first_leg (columna manual/TMS, que sigue
    # existiendo sin relación con este filtro) como fuente. driver_leg_number
    # es un alias de _TRIP_SELECT (subconsulta contra la vista), no una
    # columna real — no se puede referenciar en este WHERE, así que se
    # resuelve de nuevo contra app.v_driver_daily_trip_legs (Plan 1).
    if second_leg_plus == "true":
        filters.append(
            "EXISTS (SELECT 1 FROM app.v_driver_daily_trip_legs vdtl "
            "WHERE vdtl.trip_id = t.id AND vdtl.leg_number >= 2)"
        )
    elif second_leg_plus == "false":
        filters.append(
            "NOT EXISTS (SELECT 1 FROM app.v_driver_daily_trip_legs vdtl "
            "WHERE vdtl.trip_id = t.id AND vdtl.leg_number >= 2)"
        )
    if tms:
        tms_list = [t.strip() for t in tms.split(',') if t.strip()]
        add("t.source_system = ANY(?)", tms_list)
    if client:
        # Lista (multi-select en la UI), normalizada con lower(trim(...))
        # igual que el JOIN de sh (líneas 660-661): el client_name crudo del
        # TMS no garantiza casing/whitespace estable contra el nombre
        # canónico del shipper (bug 5.1, confirmado contra datos reales:
        # ~100% de los viajes tienen client_name en minúsculas).
        client_list = [c.strip().lower() for c in client.split(',') if c.strip()]
        add("lower(trim(t.client_name)) = ANY(?)", client_list)
    if cargo_type:
        cargo_type_list = [c.strip() for c in cargo_type.split(',') if c.strip()]
        add("t.cargo_type = ANY(?)", cargo_type_list)
    if origin:
        # origin no es columna de app.trips (se deriva de la parada
        # stop_type=ORIGIN en app.trip_stops, ver _attach_origin) — el
        # filtro necesita un EXISTS contra esa tabla.
        origin_list = [o.strip() for o in origin.split(',') if o.strip()]
        add(
            "EXISTS (SELECT 1 FROM app.trip_stops ts WHERE ts.trip_id = t.id "
            "AND ts.stop_type = 'ORIGIN' AND ts.local = ANY(?))",
            origin_list,
        )
    if origin_region:
        add("t.origin_region = ?", origin_region)
    if origin_city:
        add("t.origin_city = ?", origin_city)
    # HU-04 (Fase 0): "unmatched" = flota reportada sin poder cruzar con
    # empresa; "mismatch" = conductor y tracto calzan cada uno por su lado
    # pero bajo empresas distintas. Repite _FLEET_MATCH_CASE porque el WHERE
    # no puede referenciar el alias fleet_match_status del SELECT (mismo
    # motivo que second_leg_plus más arriba).
    if fleet_match in ("unmatched", "mismatch"):
        add(f"({_FLEET_MATCH_CASE}) = ?", fleet_match.upper())
    # HU-12 (Fase 2): a diferencia de fleet_match_status, ins.insurance_alert
    # es un alias real de la LATERAL join (no un CASE repetido) — se puede
    # referenciar directo en el WHERE.
    if insurance_alert in ("EXPIRED", "OVERDUE_INSTALLMENTS", "EXPIRING_SOON"):
        add("ins.insurance_alert = ?", insurance_alert)
    if no_asignado_webcarga:
        # No mira is_active: el punto es el HISTORIAL de lo que nos
        # ofrecieron y no tomamos, incluidos los que ya se apagaron hace
        # meses (Pablo, spec §6.3).
        filters.append("t.unassigned_reason_id IS NOT NULL")

    where = "WHERE " + " AND ".join(filters)
    offset = (page - 1) * limit
    sort_col = sort_by if sort_by in _SORTABLE_COLUMNS else "planning_date"
    sort_dir_sql = "ASC" if sort_dir == "asc" else "DESC"
    # Tie-break con status_reported_at (última vez que el TMS reportó el
    # viaje), no t.updated_at — ese campo se pisa también con ediciones
    # manuales del usuario (edited_at = NOW(), updated_at = NOW()), no es un
    # proxy limpio de "hubo novedad real del TMS" (bug 5.6).
    order_clause = f"{sort_col} {sort_dir_sql} NULLS LAST, status_reported_at DESC NULLS LAST"

    rows = await pool.fetch(
        f"SELECT {_TRIP_SELECT} {_TRIP_FROM} {where} "
        f"ORDER BY {order_clause} "
        f"LIMIT {limit} OFFSET {offset}",
        *params,
    )
    count = await pool.fetchval(
        f"SELECT COUNT(*) {_TRIP_FROM} {where}", *params
    )
    data = []
    client_names = set()
    trip_ids = set()
    for r in rows:
        d = dict(r)
        if d.get("client_name"):
            client_names.add(d["client_name"].strip().lower())
        trip_ids.add(str(d["id"]))
        data.append(d)

    stops_by_trip = await _load_trip_stops(pool, trip_ids)
    op_type_buckets = await _load_operation_type_buckets(pool, client_names)
    temp_ranges = await _load_temperature_ranges(pool)
    for d in data:
        d["stops"] = stops_by_trip.get(str(d["id"]), [])
        d["cargo_delivered"] = _cargo_delivered(d["stops"])
        d["temp_status"] = _trip_temp_status(d["stops"], d.get("cargo_type"), d["cargo_delivered"], temp_ranges)
        _annotate_stop_temp_status(d["stops"], d.get("cargo_type"), temp_ranges)
        _attach_origin(d)
        _apply_operation_types(d, op_type_buckets)

    return {"data": data, "count": count, "page": page, "limit": limit}


# ── Metadatos de presentación (sin auth — igual que /roles) ──────────────────

_STATUS_META = [
    {"id": "ASIGNADO",               "bg_color": "#e8eeff", "text_color": "#053bfa", "group": "en_ruta"},
    {"id": "ORIGEN",                 "bg_color": "#f3e8ff", "text_color": "#8a00dd", "group": "en_ruta"},
    {"id": "RUTA",                   "bg_color": "#eef6e6", "text_color": "#62a420", "group": "en_ruta"},
    {"id": "EN LOCAL",               "bg_color": "#fef0e6", "text_color": "#ea6b25", "group": "en_local"},
    {"id": "VIAJE EN PREDIO",        "bg_color": "#fef0e6", "text_color": "#ea6b25", "group": "en_local"},
    {"id": "RETORNANDO",             "bg_color": "#e6f8fd", "text_color": "#0e8db5", "group": "retornando"},
    {"id": "RETORNADO CD",           "bg_color": "#f3f4f6", "text_color": "#6b7280", "group": "retornando"},
    {"id": "CERRADO FINALIZADO",     "bg_color": "#f3f4f6", "text_color": "#9ca3af", "group": "cerrado"},
    {"id": "CERRADO INCOMPLETO",     "bg_color": "#fef3c7", "text_color": "#d97706", "group": "cerrado"},
    {"id": "CERRADO MANUAL",         "bg_color": "#f3f4f6", "text_color": "#9ca3af", "group": "cerrado"},
    {"id": "CERRADO SIN GPS",        "bg_color": "#f3f4f6", "text_color": "#9ca3af", "group": "cerrado"},
    {"id": "CERRADO POR OTRO VIAJE", "bg_color": "#f3f4f6", "text_color": "#9ca3af", "group": "cerrado"},
    {"id": "CERRADO FINALIZADO CC",  "bg_color": "#f3f4f6", "text_color": "#9ca3af", "group": "cerrado"},
    {"id": "CANCELADO",              "bg_color": "#fee2e2", "text_color": "#b00020", "group": "problema"},
    {"id": "EN PANA",                "bg_color": "#fee2e2", "text_color": "#b00020", "group": "problema"},
    {"id": "DEVUELTO",               "bg_color": "#fee2e2", "text_color": "#b00020", "group": "problema"},
]

_TMS_META = [
    {"id": "qanalytics", "label": "QA",     "bg_color": "#dbeafe", "text_color": "#2563eb"},
    {"id": "wingsuite",  "label": "WS",     "bg_color": "#f3e8ff", "text_color": "#9333ea"},
    {"id": "sodimac",    "label": "SDM",    "bg_color": "#ffedd5", "text_color": "#ea580c"},
    {"id": "manual",     "label": "Manual", "bg_color": "#f0fdf4", "text_color": "#166534"},
]

# Clasificación RM/Zona Cero de la minuta UAT (catálogo de locales, H2.6) —
# valores fijos tal cual vienen de la planilla de generadores de carga
# (public.locations.operation_type), no una tabla configurable como
# trip_statuses: no hay pedido de negocio para editarlos desde Configuración.
_OPERATION_TYPE_META = [
    {"id": "RM",            "label": "RM",            "bg_color": "#e8eeff", "text_color": "#053bfa"},
    {"id": "Z0",             "label": "Zona Cero",     "bg_color": "#fef0e6", "text_color": "#ea6b25"},
    {"id": "Region Norte",  "label": "Región Norte",  "bg_color": "#fef3c7", "text_color": "#d97706"},
    {"id": "Region Sur",    "label": "Región Sur",    "bg_color": "#e6f8fd", "text_color": "#0e8db5"},
]

_CSV_COLUMNS = [
    {"field": "planning_date",    "csv_key": "fecha_planificacion", "label": "Fecha planificación", "required": True,  "type": "date",       "example": "2026-05-29"},
    {"field": "source_system_trip_id", "csv_key": "id_origen",     "label": "ID en sistema origen", "required": False, "type": "text",       "example": "VJE-001"},
    {"field": "origin_tms",       "csv_key": "tms_origen",          "label": "TMS de origen",       "required": False, "type": "tms_source", "example": "qanalytics"},
    {"field": "client_name",      "csv_key": "cliente",             "label": "Cliente",             "required": False, "type": "text",       "example": "Walmart"},
    {"field": "tractor_plate",    "csv_key": "patente_tracto",      "label": "Patente tracto",      "required": False, "type": "text",       "example": "BGVS12"},
    {"field": "trailer_plate",    "csv_key": "patente_rampla",      "label": "Patente rampla",      "required": False, "type": "text",       "example": ""},
    {"field": "driver_name",      "csv_key": "conductor",           "label": "Conductor",           "required": False, "type": "text",       "example": "Juan Pérez"},
    {"field": "driver_rut",       "csv_key": "rut_conductor",       "label": "RUT conductor",       "required": False, "type": "text",       "example": "12345678-9"},
    {"field": "driver_phone",     "csv_key": "telefono",            "label": "Teléfono conductor",  "required": False, "type": "text",       "example": "+56912345678"},
    {"field": "transporter_name", "csv_key": "empresa_tt",          "label": "Empresa TT",          "required": False, "type": "text",       "example": "TransCargo"},
    {"field": "origin",           "csv_key": "origen",              "label": "Origen",              "required": False, "type": "text",       "example": "Santiago CD"},
    {"field": "cargo_type",       "csv_key": "tipo_carga",          "label": "Tipo carga",          "required": False, "type": "text",       "example": "Refrigerado"},
    {"field": "current_status",   "csv_key": "estado",              "label": "Estado",              "required": False, "type": "status",     "example": "ASIGNADO"},
    {"field": "stops",            "csv_key": "destinos",            "label": "Destinos (separados por |)", "required": False, "type": "stops", "example": "Local Maipú@2026-05-29 09:00|Local Puente Alto"},
]


class StatusMeta(BaseModel):
    id:         str
    label:      str
    bg_color:   str
    text_color: str
    group:      str  # group_id aliased for frontend compat


class TmsSourceMeta(BaseModel):
    id:         str
    label:      str
    bg_color:   str
    text_color: str


class OperationalStateMeta(BaseModel):
    id:         str
    label:      str
    bg_color:   str
    text_color: str
    # Grupo del tablero (misma taxonomía que StatusMeta.group) — permite que un
    # override manual (manual_status) bucketee a su columna en vez de caer a "Otro"
    group:      str = "otro"


class MonitorAlertRulesMeta(BaseModel):
    stale_report_hours:     float
    dwell_hours:            float
    late_arrival_grace_min: int
    unassigned_enabled:     bool
    dwell_yellow_min:       int
    dwell_orange_min:       int
    dwell_red_min:          int


class AlertThresholdMeta(BaseModel):
    doc_type:     str
    label:        str
    warning_days: int
    error_days:   int


class CSVColumnDef(BaseModel):
    field:    str
    csv_key:  str
    label:    str
    required: bool
    type:     str
    example:  str


class TemperatureRangeMeta(BaseModel):
    cargo_type: str
    label:      str
    min_c:      float
    max_c:      float


class UnassignedReasonMeta(BaseModel):
    id:    str
    label: str


class OperationTypeMeta(BaseModel):
    id:         str
    label:      str
    bg_color:   str
    text_color: str


class ClientMeta(BaseModel):
    id:   str
    name: str


class TripsMeta(BaseModel):
    statuses:            list[StatusMeta]
    tms_sources:         list[TmsSourceMeta]
    operational_states:  list[OperationalStateMeta]
    alert_thresholds:    list[AlertThresholdMeta]
    csv_columns:         list[CSVColumnDef]
    temperature_ranges:  list[TemperatureRangeMeta]
    unassigned_reasons:  list[UnassignedReasonMeta]
    operation_types:     list[OperationTypeMeta]
    clients:             list[ClientMeta]
    monitor_alert_rules: Optional[MonitorAlertRulesMeta] = None


@router.get("/meta", response_model=TripsMeta)
async def get_trips_meta(pool=Depends(get_pool)):
    status_rows = await pool.fetch(
        "SELECT id, label, bg_color, text_color, group_id AS group "
        "FROM app.trip_statuses WHERE active = true ORDER BY sort_order"
    )
    op_rows = await pool.fetch(
        'SELECT id::text, label, bg_color, text_color, group_id AS "group" '
        "FROM app.status_taxonomies WHERE domain = 'OPERATIONAL_STATE' AND active = true ORDER BY sort_order"
    )
    # Resiliente al orden de deploy: si la tabla aún no existe (migración
    # pendiente), /meta sigue funcionando y el frontend usa sus defaults
    try:
        alert_rules_row = await pool.fetchrow(
            "SELECT stale_report_hours, dwell_hours, late_arrival_grace_min, unassigned_enabled, "
            "dwell_yellow_min, dwell_orange_min, dwell_red_min "
            "FROM app.monitor_alert_rules WHERE id = 1"
        )
    except Exception:
        alert_rules_row = None
    thresh_rows = await pool.fetch(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds ORDER BY doc_type"
    )
    temp_range_rows = await pool.fetch(
        "SELECT cargo_type, label, min_c, max_c "
        "FROM app.temperature_ranges ORDER BY cargo_type"
    )
    unassigned_reason_rows = await pool.fetch(
        "SELECT id::text, label FROM app.status_taxonomies "
        "WHERE domain = 'DRIVER_REASON' AND active = true ORDER BY sort_order"
    )
    # Bug 5.2: dinámico según quién realmente tiene viajes en el Diario, no
    # el catálogo completo de public.shippers (que incluye clientes
    # históricos sin actividad — confirmado contra datos reales 2026-08-07:
    # 11 shippers ACTIVE en el catálogo, solo 3-5 con viajes reales). Mismo
    # patrón de normalización lower(trim(...)) que el filtro de cliente
    # (bug 5.1) y el JOIN de _TRIP_FROM — si un cliente vuelve a tener
    # viajes reales, aparece solo, sin tocar código.
    client_rows = await pool.fetch(
        "SELECT DISTINCT sh.id::text, sh.name "
        "FROM app.trips t "
        "JOIN public.shippers sh "
        "  ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE' "
        "ORDER BY sh.name"
    )
    return TripsMeta(
        statuses=[StatusMeta(**dict(r)) for r in status_rows],
        tms_sources=[TmsSourceMeta(**t) for t in _TMS_META],
        operational_states=[OperationalStateMeta(**dict(r)) for r in op_rows],
        alert_thresholds=[AlertThresholdMeta(**dict(r)) for r in thresh_rows],
        csv_columns=[CSVColumnDef(**c) for c in _CSV_COLUMNS],
        temperature_ranges=[TemperatureRangeMeta(**dict(r)) for r in temp_range_rows],
        unassigned_reasons=[UnassignedReasonMeta(**dict(r)) for r in unassigned_reason_rows],
        operation_types=[OperationTypeMeta(**t) for t in _OPERATION_TYPE_META],
        clients=[ClientMeta(**dict(r)) for r in client_rows],
        monitor_alert_rules=MonitorAlertRulesMeta(**dict(alert_rules_row)) if alert_rules_row else None,
    )


# ── Disponibilidad de conductores/equipos — Fase 3 del hardening del Diario
# (2026-07-18): antes agrupaba por nombre de texto libre DENTRO de los
# viajes del día — un conductor sin NINGÚN viaje ese día ni siquiera
# aparecía, y no cruzaba contra public.carriers.operational_status. El
# diseño correcto parte del directorio real (conductor/equipo activo de una
# empresa transportista activa, público.driver_assignments/
# asset_assignments) y recién ahí cruza contra los viajes del día — mismo
# patrón que ya usa Empresas para membresía activa/inactiva.
# Declarado ANTES de /{trip_id} para que FastAPI no matchee "available-drivers"
# como un id de viaje. Sodimac excluido: nunca reporta patente ni conductor.

@router.get("/available-drivers")
async def available_drivers(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT d.id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name
            FROM public.drivers d
            JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE d.operational_status = 'ACTIVE'
        ),
        -- Vehículo que el conductor maneja habitualmente (migración
        -- 20260718070000) — independiente de si tuvo viaje hoy, para no
        -- perder la patente de alguien con 0 viajes hoy pero con equipo fijo.
        standing_vehicle AS (
            SELECT vda.driver_id, a.id AS tractor_asset_id, a.license_plate AS tractor_plate
            FROM public.vehicle_driver_assignments vda
            JOIN public.assets a ON a.id = vda.asset_id
            WHERE vda.status = 'ACTIVE'
        ),
        -- Fase B (ítem 5, feedback post-weekly 2026-07-22): antes solo
        -- miraba trip_fleet_links.driver_id (sin la cadena de resolución en
        -- vivo) — trip_fleet_links casi no recibe filas nuevas para viajes
        -- del TMS, así que un conductor con viaje ya resuelto podía seguir
        -- apareciendo acá como "disponible". Ahora usa
        -- app.v_trip_fleet_resolution (misma vista que _TRIP_FROM/
        -- daily_closures.py) — LEFT JOIN a trip_fleet_links, no INNER, para
        -- no perder los viajes resueltos solo por la cadena auto/nombre
        -- (que no tienen ninguna fila en trip_fleet_links).
        today_trips AS (
            SELECT
                vfr.resolved_driver_id AS driver_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.tractor_plate, t.fleet->>'tractor_plate')) AS tractor_plate
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            -- FIX 2026-08-02 (ítem 16 de la minuta, "los números no cuadran"):
            -- antes solo miraba planning_date = fecha exacta — un conductor
            -- con viaje multi-día abierto desde un día anterior aparecía acá
            -- como "disponible" cuando en realidad seguía ocupado. Ahora
            -- también cuenta el viaje de un día anterior mientras siga
            -- is_active=true (ya considera la recencia por fuente, ver
            -- trips.sql).
            WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
              AND t.source_system != 'sodimac'
              AND vfr.resolved_driver_id IS NOT NULL
            GROUP BY vfr.resolved_driver_id
        )
        SELECT
            ar.id            AS driver_id,
            ar.full_name     AS driver_name,
            ar.tax_id        AS driver_rut,
            -- Último teléfono capturado para este conductor en cualquier
            -- viaje anterior — public.drivers no tiene columna de teléfono
            -- propia, y no hay un viaje de hoy del que tomarlo si está libre.
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = ar.id AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            )                AS driver_phone,
            ar.carrier_id,
            ar.carrier_name,
            sv.tractor_asset_id,
            COALESCE(tt.tractor_plate, sv.tractor_plate) AS tractor_plate,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.driver_id = ar.id
        LEFT JOIN standing_vehicle sv ON sv.driver_id = ar.id
        WHERE tt.driver_id IS NULL OR tt.trips_total = tt.closed_count
        ORDER BY tt.last_report_at DESC NULLS LAST, ar.full_name
        """,
        day,
    )
    return [dict(r) for r in rows]


@router.get("/available-assets")
async def available_assets(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Mismo diseño que /available-drivers, para equipos: parte de
    public.assets activos de una empresa transportista activa
    (asset_assignments) y cruza contra los viajes del día.

    Centro de Flota (2026-07-28): la respuesta pasa de lista pelada a
    {total_active, items} — total_active permite calcular "en viaje hoy" en
    el cliente (= total_active - len(items), ya que este endpoint solo
    devuelve equipo IDLE) sin duplicar esa cuenta en dos lugares. Se agrega
    standing_driver (mismo patrón que standing_vehicle en available_drivers,
    en la dirección inversa) para que un equipo sin viajes hoy siga
    mostrando su conductor habitual — antes quedaba en blanco."""
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    total_active = await pool.fetchval(
        """
        SELECT count(*)
        FROM public.assets a
        JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
        WHERE a.operational_status = 'ACTIVE'
        """
    )

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT a.id, a.license_plate, a.asset_type, c.id AS carrier_id, c.business_name AS carrier_name
            FROM public.assets a
            JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE a.operational_status = 'ACTIVE'
        ),
        -- Centro de Flota (2026-07-28): conductor habitual de este equipo,
        -- para cuando no tuvo ningún viaje hoy (ver docstring de arriba).
        standing_driver AS (
            SELECT vda.asset_id, d.id AS driver_id, d.full_name AS driver_name, d.tax_id AS driver_rut
            FROM public.vehicle_driver_assignments vda
            JOIN public.drivers d ON d.id = vda.driver_id
            WHERE vda.status = 'ACTIVE'
        ),
        -- Fase B (ítem 5, feedback post-weekly 2026-07-22): mismo fix que
        -- available-drivers — antes solo miraba trip_fleet_links.tractor_asset_id,
        -- ahora usa la cadena de resolución completa vía la vista compartida.
        today_trips AS (
            SELECT
                vfr.resolved_tractor_asset_id AS asset_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms')) AS driver_name,
                -- Postgres no tiene max(uuid) — cast a text para agregar y
                -- volver a uuid (bug real encontrado en producción 2026-07-28).
                max(vfr.resolved_driver_id::text)::uuid AS driver_id
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            -- FIX 2026-08-02 (ítem 16 de la minuta) — mismo criterio que
            -- available_drivers arriba: un equipo con viaje multi-día
            -- abierto desde un día anterior cuenta como ocupado.
            WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
              AND t.source_system != 'sodimac'
              AND vfr.resolved_tractor_asset_id IS NOT NULL
            GROUP BY vfr.resolved_tractor_asset_id
        )
        SELECT
            ar.id            AS asset_id,
            ar.license_plate AS tractor_plate,
            ar.asset_type,
            ar.carrier_id,
            ar.carrier_name,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at,
            COALESCE(tt.driver_name, sd.driver_name) AS driver_name,
            COALESCE(tt.driver_id, sd.driver_id)     AS driver_id,
            sd.driver_rut,
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = COALESCE(tt.driver_id, sd.driver_id) AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            ) AS driver_phone
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.asset_id = ar.id
        LEFT JOIN standing_driver sd ON sd.asset_id = ar.id
        WHERE tt.asset_id IS NULL OR tt.trips_total = tt.closed_count
        ORDER BY tt.last_report_at DESC NULLS LAST, ar.license_plate
        """,
        day,
    )

    # Centro de Flota, Opción B (2026-07-28): el tile "En viaje hoy" mostraba
    # un conteo pero nunca filas — este endpoint solo devolvía equipo IDLE.
    # Se agrega el complemento real: equipo con un viaje ABIERTO hoy, con el
    # trip_id concreto para poder abrirlo (mismo criterio de "más reciente si
    # hay más de uno" que ya usa daily_closures.py para MISMATCH).
    busy_rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT a.id, a.license_plate, c.business_name AS carrier_name
            FROM public.assets a
            JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE a.operational_status = 'ACTIVE'
        ),
        busy_trip AS (
            SELECT DISTINCT ON (vfr.resolved_tractor_asset_id)
                vfr.resolved_tractor_asset_id AS asset_id,
                t.id AS trip_id,
                t.client_name,
                t.trip_status AS current_status
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            -- FIX 2026-08-02 (ítem 16 de la minuta) — mismo criterio que las
            -- 2 queries de arriba: un viaje multi-día abierto desde un día
            -- anterior sigue haciendo "ocupado" al equipo hoy.
            WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
              AND t.source_system != 'sodimac'
              AND vfr.resolved_tractor_asset_id IS NOT NULL
              AND NOT (t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida'))
            ORDER BY vfr.resolved_tractor_asset_id, t.status_reported_at DESC NULLS LAST
        )
        SELECT ar.id AS asset_id, ar.license_plate AS tractor_plate, ar.carrier_name,
               bt.trip_id, bt.client_name, bt.current_status
        FROM active_roster ar
        JOIN busy_trip bt ON bt.asset_id = ar.id
        ORDER BY ar.license_plate
        """,
        day,
    )

    return {
        "total_active": total_active,
        "items": [dict(r) for r in rows],
        "busy": [dict(r) for r in busy_rows],
    }


@router.get("/fleet-daily-overview")
async def fleet_daily_overview(
    fecha: str = Query(""),
    client: str = Query(""),
    origin: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """HU-01 (Cierre del Día, "Vista de flota del día"): separa la flota
    activa en TRACTOREO / EQUIPO_COMPLETO / SIN_CLASIFICAR según
    `public.assets.webcarga_operation_type_id` (Ronda 85, corrige la Ronda
    80 que usaba `fleet_service_type_id` — columna D, "Tipo Vehículo",
    describe el SUBTIPO físico del vehículo, no el tipo de operación).
    `webcarga_operation_type_id` viene de la columna E, "Tipo de Operación
    WebCarga", dominio `WEBCARGA_OPERATION_TYPE` (solo 2 valores:
    Tractoreo/Equipo Completo) — confirmado con datos reales que un tracto
    puede ser físicamente "Tractoreo" (columna D) y aun así operar bajo un
    arreglo "Equipo Completo" de WebCarga (columna E).

    "Equipo" = tractocamión activo (`asset_type='TRACTOCAMION'`) de una
    empresa ACTIVA, mismo criterio que `/available-assets`, excluyendo
    ramplas (no son la unidad que un viaje resuelve/asigna). Tractos sin
    `webcarga_operation_type_id` todavía asignado caen en SIN_CLASIFICAR en
    vez de perderse silenciosamente — HU-02 ya contempla esto como
    inconsistencia Tipo B ("falta tipo de operación").

    "CON CARGA hoy" reusa el mismo criterio ya verificado en
    /available-drivers y /available-assets (ítem 16 de la minuta): viaje con
    planning_date de hoy O viaje de un día anterior que siga is_active=true
    (multi-día) — un equipo que YA CERRÓ su viaje de hoy sigue contando como
    CON CARGA (criterio de aceptación #4 de la HU), porque no se exige
    is_active, solo que exista el viaje de hoy. Excluye Sodimac, mismo
    criterio heredado de /available-assets (esa fuente no resuelve
    conductor/tracto por la misma cadena).

    Filtros: `client` (lista separada por coma, nombre de shipper) matchea
    contra `public.carrier_shippers` — no contra el viaje de hoy — para que
    un equipo SIN CARGA de una empresa habilitada para ese cliente se siga
    contando (o contra el cliente real del viaje de hoy, si lo tiene).
    `origin` (lista de nombres de CD) solo puede aplicar a equipos CON
    CARGA — hoy no existe un "CD habitual" por equipo/empresa en el modelo,
    así que un equipo SIN CARGA queda fuera de un filtro por origen.
    """
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")
    client_list = [c.strip().lower() for c in client.split(',') if c.strip()]
    origin_list = [o.strip().lower() for o in origin.split(',') if o.strip()]

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT a.id AS asset_id, a.license_plate AS tractor_plate,
                   c.id AS carrier_id, c.business_name AS carrier_name,
                   wot.code = 'TRACTOREO' AS is_tractoreo,
                   wot.code = 'EQUIPO_COMPLETO' AS is_equipo_completo
            FROM public.assets a
            JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
            LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
            WHERE a.operational_status = 'ACTIVE' AND a.asset_type = 'TRACTOCAMION'
        ),
        today_trips AS (
            SELECT DISTINCT ON (vfr.resolved_tractor_asset_id)
                vfr.resolved_tractor_asset_id AS asset_id,
                t.id AS trip_id,
                t.client_name,
                (
                    SELECT ts.local FROM app.trip_stops ts
                    WHERE ts.trip_id = t.id AND ts.stop_type = 'ORIGIN' LIMIT 1
                ) AS origin_local
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            WHERE (t.planning_date = $1 OR (t.planning_date < $1 AND t.is_active))
              AND t.source_system != 'sodimac'
              AND vfr.resolved_tractor_asset_id IS NOT NULL
            ORDER BY vfr.resolved_tractor_asset_id, t.status_reported_at DESC NULLS LAST
        )
        SELECT
            ar.asset_id, ar.tractor_plate, ar.carrier_id, ar.carrier_name,
            COALESCE(ar.is_tractoreo, false)      AS is_tractoreo,
            COALESCE(ar.is_equipo_completo, false) AS is_equipo_completo,
            tt.trip_id, tt.client_name, tt.origin_local
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.asset_id = ar.asset_id
        """,
        day,
    )

    carriers_for_client: set[str] = set()
    if client_list:
        shipper_rows = await pool.fetch(
            """
            SELECT cs.carrier_id, lower(s.name) AS shipper_name
            FROM public.carrier_shippers cs
            JOIN public.shippers s ON s.id = cs.shipper_id
            WHERE cs.status = 'ACTIVE'
            """
        )
        carriers_for_client = {
            r["carrier_id"] for r in shipper_rows if r["shipper_name"] in client_list
        }

    equipment = []
    for r in rows:
        if client_list:
            today_client_ok = (r["client_name"] or "").strip().lower() in client_list
            carrier_client_ok = r["carrier_id"] in carriers_for_client
            if not (today_client_ok or carrier_client_ok):
                continue
        if origin_list:
            if not r["trip_id"] or (r["origin_local"] or "").strip().lower() not in origin_list:
                continue
        categories = []
        if r["is_tractoreo"]:
            categories.append("TRACTOREO")
        if r["is_equipo_completo"]:
            categories.append("EQUIPO_COMPLETO")
        if not categories:
            categories.append("SIN_CLASIFICAR")
        equipment.append({
            "asset_id":      r["asset_id"],
            "tractor_plate": r["tractor_plate"],
            "carrier_id":    r["carrier_id"],
            "carrier_name":  r["carrier_name"],
            "categories":    categories,
            "con_carga":     r["trip_id"] is not None,
            "trip_id":       r["trip_id"],
            "client_name":   r["client_name"],
            "origin":        r["origin_local"],
        })

    def _summarize(category: str) -> dict:
        items = [e for e in equipment if category in e["categories"]]
        assigned = sum(1 for e in items if e["con_carga"])
        total = len(items)
        return {
            "category":         category,
            "assigned":         assigned,
            "unassigned":       total - assigned,
            "utilization_pct":  round(assigned / total * 100, 1) if total else 0.0,
        }

    return {
        "fecha": fecha,
        "categories": [_summarize(c) for c in ("TRACTOREO", "EQUIPO_COMPLETO", "SIN_CLASIFICAR")],
        "equipment": equipment,
    }


# ── Trip creation (manual entry + bulk) ──────────────────────────────────────

class TripStopCreate(BaseModel):
    local:              str
    planning_date:      Optional[str] = None  # 'YYYY-MM-DD HH:mm' o ISO
    # Ubicación del destino (dropdown región/ciudad de Chile) — van a las
    # claves destination_region/destination_city que ya existen en el jsonb
    # stops del pipeline (hoy solo qanalytics las trae)
    destination_region: Optional[str] = None
    destination_city:   Optional[str] = None
    # 'ORIGIN' | 'DESTINATION' — el origen del viaje se manda como una parada
    # más (Ronda 26, Fase 2, unificación crear/editar), no como un campo
    # aparte. Default 'DESTINATION' para no romper a nadie que no lo mande.
    stop_type:          str = 'DESTINATION'


class TripCreateBody(BaseModel):
    planning_date:          _date
    # Sistema de ORIGEN del viaje (no el canal de ingreso, que siempre es 'manual'):
    # un TMS mapeado (permite reconciliación automática), un TMS no integrado
    # (texto libre) o None (operador/generador sin TMS).
    origin_tms:             Optional[str] = None
    source_system_trip_id:  Optional[str] = None
    # Compat: clientes viejos mandan source_system — se IGNORA (siempre 'manual')
    source_system:          str           = 'manual'
    client_name:            Optional[str] = None
    origin_region:          Optional[str] = None
    origin_city:            Optional[str] = None
    cargo_type:             Optional[str] = None
    current_status:         Optional[str] = None
    stops:                  list[TripStopCreate] = []
    tractor_plate:          Optional[str] = None
    trailer_plate:          Optional[str] = None
    driver_name:            Optional[str] = None
    driver_rut:             Optional[str] = None
    driver_phone:           Optional[str] = None
    transporter_name:       Optional[str] = None
    carrier_id:             Optional[str] = None  # si se selecciona desde Empresas
    # Vínculo real de roster (Fase 1.5c) — mismos 3 campos opcionales que
    # assign_fleet_link, para que un viaje creado a mano y un viaje TMS
    # vinculado a mano después escriban la misma estructura en trip_fleet_links.
    driver_id:              Optional[str] = None
    tractor_asset_id:       Optional[str] = None
    trailer_asset_id:       Optional[str] = None


MAPPED_TMS_IDS = {t["id"] for t in _TMS_META if t["id"] != "manual"}

# Keys del TripStop del pipeline (app_trips.sql) — las paradas manuales llevan
# el mismo shape con null en lo que no aplica
_STOP_NULL_KEYS = [
    "destination_city", "destination_region", "on_time_status", "milestone_status",
    "s2s", "delivery_numbers", "temperature", "arrival_date", "departure_date", "departure_date_prog",
    "gps_arrival_date", "gps_departure_date", "unload_start", "unload_end",
]


def _manual_trip_id(body: TripCreateBody) -> str:
    """Id del viaje manual. Si el origen es un TMS mapeado y hay id externo +
    cliente, usa la MISMA fórmula canónica del pipeline
    (md5(tms|cliente|trip_id) como uuid, ver stg_*_trips) — así, cuando el TMS
    reporte ese viaje, el merge de dbt matchea el id y lo reconcilia
    automáticamente. En cualquier otro caso, uuid aleatorio."""
    if (
        body.origin_tms in MAPPED_TMS_IDS
        and body.source_system_trip_id
        and body.client_name
    ):
        digest = hashlib.md5(
            f"{body.origin_tms}|{body.client_name.strip().lower()}|{body.source_system_trip_id.strip()}".encode()
        ).hexdigest()
        return str(UUID(digest))
    return str(uuid4())


def _build_manual_stops(stops: list[TripStopCreate], trip_id: str) -> str:
    out = []
    for i, s in enumerate(stops):
        stop = {
            "stop_id":       hashlib.md5(f"{trip_id}{s.local}{i}".encode()).hexdigest(),
            "local":         s.local,
            "planning_date": s.planning_date,
            **{k: None for k in _STOP_NULL_KEYS},
            "destination_region": s.destination_region,
            "destination_city":   s.destination_city,
        }
        out.append(stop)
    return json.dumps(out)


async def _insert_trip_stops(conn, stops: list[TripStopCreate], trip_id: str) -> None:
    """Espeja las paradas de un viaje manual en app.trip_stops (Fase 2 del
    hardening H2.6) — el pipeline dbt solo puebla esta tabla para viajes
    TMS, los viajes 100% manuales nunca pasan por ahí. Mismo stop_id que
    _build_manual_stops para destinos (misma fórmula que usa el pipeline:
    md5(trip_id + local + índice entre los destinos, 0-based)).

    UNIFICADO (Ronda 26, Fase 2): el origen ya no es un parámetro aparte —
    viene como una fila más de `stops` con stop_type='ORIGIN'. Todas las
    filas que inserta esta función quedan marcadas is_manual_stop=true
    (columna nueva, ver migración de la Task 2 de este plan) — así el
    post_hook de app/trip_stops.sql sabe cuáles limpiar cuando el viaje se
    reconcilia con datos reales de una TMS."""
    dest_index = 0
    for s in stops:
        if s.stop_type == 'ORIGIN':
            stop_id = hashlib.md5(f"{trip_id}{s.local}|origin".encode()).hexdigest()
            await conn.execute(
                """
                INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local, is_manual_stop)
                VALUES ($1, $2, 0, 'ORIGIN', $3, true)
                ON CONFLICT (stop_id) DO UPDATE SET local = EXCLUDED.local, updated_at = NOW()
                """,
                stop_id, trip_id, s.local,
            )
        else:
            stop_id = hashlib.md5(f"{trip_id}{s.local}{dest_index}".encode()).hexdigest()
            await conn.execute(
                """
                INSERT INTO app.trip_stops
                    (stop_id, trip_id, stop_order, stop_type, local, planning_date, destination_region, destination_city, is_manual_stop)
                VALUES ($1, $2, $3, 'DESTINATION', $4, $5::timestamptz, $6, $7, true)
                ON CONFLICT (stop_id) DO UPDATE SET
                    local               = EXCLUDED.local,
                    planning_date       = EXCLUDED.planning_date,
                    destination_region  = EXCLUDED.destination_region,
                    destination_city    = EXCLUDED.destination_city,
                    updated_at          = NOW()
                """,
                # planning_date pasa tal cual (sin macro de huso horario propio,
                # mismo criterio que el resto de fechas manuales), solo parseado
                # a datetime porque asyncpg lo exige para un parámetro ::timestamptz.
                stop_id, trip_id, dest_index + 1, s.local, _parse_timestamptz(s.planning_date),
                s.destination_region, s.destination_city,
            )
            dest_index += 1


async def _valid_status_ids(conn) -> set[str]:
    rows = await conn.fetch("SELECT id FROM app.trip_statuses WHERE active = true")
    return {r["id"] for r in rows}


def _validate_create_body(body: TripCreateBody, valid_statuses: set[str]) -> None:
    if body.current_status and body.current_status not in valid_statuses:
        raise HTTPException(
            422,
            f"Estado inválido: '{body.current_status}'. Válidos: {', '.join(sorted(valid_statuses))}",
        )
    stops_sin_nombre = [s for s in body.stops if not s.local.strip()]
    if stops_sin_nombre:
        raise HTTPException(422, "Cada destino debe tener un nombre")
    origins = [s for s in body.stops if s.stop_type == 'ORIGIN']
    if len(origins) > 1:
        raise HTTPException(422, "Un viaje no puede tener más de un origen")


async def _auto_resolve_fleet_link(conn, tractor_plate: str | None, trailer_plate: str | None):
    """Resuelve carrier_id/driver_id/tractor_asset_id por patente — mismo
    mecanismo que el fallback en vivo de _TRIP_FROM (public.assets +
    asset_assignments + vehicle_driver_assignments). Se usa al crear un
    viaje manual/CSV sin empresa seleccionada explícitamente, para que nazca
    con el mismo nivel de trazabilidad que uno vinculado a mano vía
    EmpresaSelector — unificación de la carga masiva con el alta individual
    (Fase 1 del hardening del Diario, 2026-07-18)."""
    plate = (tractor_plate or trailer_plate or "").strip().upper()
    if not plate:
        return None
    row = await conn.fetchrow(
        """
        SELECT a.id AS tractor_asset_id, aa.carrier_id, vda.driver_id
        FROM public.assets a
        LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.asset_id = a.id AND vda.status = 'ACTIVE'
        WHERE upper(trim(a.license_plate)) = $1
        """,
        plate,
    )
    if not row or (row["carrier_id"] is None and row["driver_id"] is None and row["tractor_asset_id"] is None):
        return None
    return dict(row)


async def _insert_trip(conn, body: TripCreateBody, user: dict, valid_statuses: set[str]) -> str:
    """Crea un viaje manual: fuente de verdad en app.trips_manual (sobrevive al
    full-refresh de dbt vía la rama UNION del modelo) + espejo inmediato en
    app.trips (visibilidad sin esperar al pipeline). Mismo id en ambas."""
    _validate_create_body(body, valid_statuses)

    trip_id = _manual_trip_id(body)

    # Si el id canónico ya existe, el viaje ya está en el sistema
    existing_source = await conn.fetchval(
        "SELECT source_system FROM app.trips WHERE id = $1", trip_id
    )
    if existing_source:
        raise HTTPException(
            409,
            f"El viaje {body.source_system_trip_id} de {body.client_name} ya existe "
            f"(ingresado por {existing_source})",
        )

    fleet = {k: v for k, v in {
        "driver_name_tms":      body.driver_name,
        "driver_rut_tms":       body.driver_rut,
        "transporter_name_tms": body.transporter_name,
        "tractor_plate":        body.tractor_plate,
        "trailer_plate":        body.trailer_plate,
        "driver_phone":         body.driver_phone,
    }.items() if v}
    fleet_json = json.dumps(fleet)
    # app.trips.stops (jsonb legacy, espejo del pipeline) sigue siendo
    # solo-destinos — el origen unificado vive en app.trip_stops (tabla),
    # no en este jsonb. Se filtra acá para no cambiar el shape de ese
    # campo, que otros consumidores (si los hay) siguen esperando igual.
    destination_stops = [s for s in body.stops if s.stop_type != 'ORIGIN']
    stops_json = _build_manual_stops(destination_stops, trip_id)

    try:
        await conn.execute(
            """
            INSERT INTO app.trips_manual (
                id, origin_tms, source_system_trip_id, client_name, planning_date,
                origin_region, origin_city, cargo_type, trip_status,
                fleet, stops, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::uuid)
            """,
            trip_id, body.origin_tms, body.source_system_trip_id, body.client_name,
            body.planning_date, body.origin_region, body.origin_city,
            body.cargo_type, body.current_status,
            fleet_json, stops_json, user["sub"],
        )
    except Exception as e:
        if "trips_manual_dedup_idx" in str(e):
            raise HTTPException(
                409,
                f"Ya registraste el viaje {body.source_system_trip_id} de "
                f"{body.client_name or 'este cliente'}",
            )
        raise

    await conn.execute(
        """
        INSERT INTO app.trips (
            id, source_system, origin_tms, source_system_trip_id, client_name,
            planning_date, origin_region, origin_city, cargo_type,
            trip_status, fleet, stops,
            is_active, is_working, is_assigned, is_first_leg,
            status_reported_at, pipeline_updated_at, created_at, updated_at,
            manually_edited_fields
        ) VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,
                  true,false,false,false,NOW(),NOW(),NOW(),NOW(),'{}')
        """,
        trip_id, body.origin_tms, body.source_system_trip_id, body.client_name,
        body.planning_date, body.origin_region, body.origin_city,
        body.cargo_type, body.current_status,
        fleet_json, stops_json,
    )

    await _insert_trip_stops(conn, body.stops, trip_id)

    # Si se seleccionó una empresa del módulo de Empresas, crear fleet_link
    if body.carrier_id:
        link_id = await conn.fetchval(
            """
            INSERT INTO app.trip_fleet_links
              (trip_id, carrier_id, driver_id, tractor_asset_id, trailer_asset_id,
               tractor_plate, trailer_plate, driver_name_raw, driver_phone,
               link_source, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10::uuid)
            RETURNING id
            """,
            trip_id,
            body.carrier_id,
            body.driver_id,
            body.tractor_asset_id,
            body.trailer_asset_id,
            body.tractor_plate,
            body.trailer_plate,
            body.driver_name,
            body.driver_phone,
            user["sub"],
        )
        await conn.execute(
            "UPDATE app.trips SET fleet_link_id = $1 WHERE id = $2",
            link_id, trip_id,
        )
        await conn.execute(
            "UPDATE app.trips_manual SET fleet_link_id = $1 WHERE id = $2",
            link_id, trip_id,
        )
    elif body.tractor_plate or body.trailer_plate:
        # Sin empresa seleccionada a mano (típicamente carga masiva CSV,
        # que hoy no tiene ningún picker de empresa): intentar resolver por
        # patente antes de dejar el viaje sin ningún vínculo. El fallback en
        # vivo de _TRIP_FROM ya cubriría esto en lectura, pero crear el
        # trip_fleet_links acá deja el viaje con la misma trazabilidad
        # explícita que uno vinculado a mano — mismo trato para viajes
        # cargados de a uno y en lote.
        resolved = await _auto_resolve_fleet_link(conn, body.tractor_plate, body.trailer_plate)
        if resolved:
            link_id = await conn.fetchval(
                """
                INSERT INTO app.trip_fleet_links
                  (trip_id, carrier_id, driver_id, tractor_asset_id,
                   tractor_plate, trailer_plate, driver_name_raw, driver_phone,
                   link_source, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'auto',$9::uuid)
                RETURNING id
                """,
                trip_id,
                resolved["carrier_id"],
                resolved["driver_id"],
                resolved["tractor_asset_id"],
                body.tractor_plate,
                body.trailer_plate,
                body.driver_name,
                body.driver_phone,
                user["sub"],
            )
            await conn.execute(
                "UPDATE app.trips SET fleet_link_id = $1 WHERE id = $2",
                link_id, trip_id,
            )
            await conn.execute(
                "UPDATE app.trips_manual SET fleet_link_id = $1 WHERE id = $2",
                link_id, trip_id,
            )

    return trip_id


async def _mirror_manual_trip(pool, trip_id: str) -> None:
    """Espeja los campos editables de un viaje manual desde app.trips hacia
    app.trips_manual, para que el rebuild de dbt conserve las ediciones del
    operador. No-op para viajes TMS (sin fila en trips_manual)."""
    try:
        await pool.execute(
            """
            UPDATE app.trips_manual m SET
                trip_status            = t.trip_status,
                manual_status          = t.manual_status,
                origin_region          = t.origin_region,
                origin_city            = t.origin_city,
                is_active              = COALESCE(t.is_active, m.is_active),
                is_working             = COALESCE(t.is_working, m.is_working),
                is_assigned            = COALESCE(t.is_assigned, m.is_assigned),
                is_first_leg           = COALESCE(t.is_first_leg, m.is_first_leg),
                notes                  = t.notes,
                comments               = t.comments,
                unassigned_reason_id   = t.unassigned_reason_id,
                fleet_link_id          = t.fleet_link_id,
                manually_edited_fields = COALESCE(t.manually_edited_fields, '{}'),
                updated_at             = NOW()
            FROM app.trips t
            WHERE m.id = t.id AND m.id = $1
            """,
            trip_id,
        )
    except Exception:
        pass  # best-effort: nunca romper la operación principal


@router.post("")
async def create_trip(
    body: TripCreateBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    valid_statuses = await _valid_status_ids(pool)
    trip_id = await _insert_trip(pool, body, user, valid_statuses)
    await _log_system_note(pool, trip_id, user, "Creó el viaje manualmente")
    return await get_trip(trip_id, pool, user)


@router.post("/bulk")
async def bulk_create_trips(
    body: list[TripCreateBody],
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    if not body:
        raise HTTPException(422, "Lista vacía")
    if len(body) > 500:
        raise HTTPException(422, "Máximo 500 viajes por carga")

    valid_statuses = await _valid_status_ids(pool)

    # Validar TODAS las filas antes de tocar la base — errores con índice de fila
    errors: list[dict] = []
    seen_ids: dict[str, int] = {}
    for i, trip in enumerate(body):
        try:
            _validate_create_body(trip, valid_statuses)
        except HTTPException as e:
            errors.append({"row": i + 1, "error": str(e.detail)})
            continue
        tid = _manual_trip_id(trip)
        if tid in seen_ids:
            errors.append({
                "row": i + 1,
                "error": f"Duplicado dentro del archivo (misma fila que la #{seen_ids[tid]})",
            })
        else:
            seen_ids[tid] = i + 1
    if errors:
        raise HTTPException(422, {"message": "Filas con errores — no se importó nada", "errors": errors})

    ids: list[str] = []
    try:
        async with pool.acquire() as conn:
            async with conn.transaction():
                for i, trip in enumerate(body):
                    try:
                        trip_id = await _insert_trip(conn, trip, user, valid_statuses)
                    except HTTPException as e:
                        # 409 de duplicado contra la base → reportar la fila culpable
                        raise HTTPException(
                            e.status_code,
                            {"message": "No se importó nada", "errors": [{"row": i + 1, "error": str(e.detail)}]},
                        )
                    ids.append(trip_id)
    except HTTPException:
        raise

    for trip_id in ids:
        await _log_system_note(pool, trip_id, user, "Creó el viaje vía carga masiva (CSV)")
    return {"created": len(ids), "ids": ids, "errors": []}


async def _log_tms_divergence_once(pool, trip_id: str, user: dict, d: dict) -> None:
    """Reconciliación TMS↔manual (Fase 1.5b): si hay un vínculo manual
    (fleet_link_id) y el TMS reporta un conductor/patente distinto al
    vinculado, registra una nota de bitácora — pero solo la primera vez que
    se ve ESE valor divergente (evita spamear la bitácora en cada GET),
    chequeando la última nota 'sistema' de divergencia ya registrada."""
    if not d.get("fleet_link_id"):
        return
    divergences = []
    if d.get("driver_name_tms") and d.get("driver_name_tms") != d.get("driver_name"):
        divergences.append(("conductor", d["driver_name_tms"]))
    if d.get("tractor_plate_tms") and d.get("tractor_plate_tms") != d.get("tractor_plate"):
        divergences.append(("patente", d["tractor_plate_tms"]))
    if not divergences:
        return
    try:
        last = await pool.fetchval(
            """
            SELECT body FROM app.trip_notes
            WHERE trip_id = $1 AND note_type = 'sistema' AND body LIKE 'Divergencia TMS:%'
            ORDER BY created_at DESC LIMIT 1
            """,
            trip_id,
        )
        new_values = ", ".join(f"{label} reportado por TMS: {value}" for label, value in divergences)
        if last == f"Divergencia TMS: {new_values}":
            return
        await _log_system_note(pool, trip_id, user, f"Divergencia TMS: {new_values}")
    except Exception:
        pass  # best-effort: nunca romper la lectura del viaje


@router.post("/assign-driver")
async def assign_driver_bulk(
    body: AsignarConductorBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Vincula una persona a varios viajes de una, en UNA transacción.

    Conserva lo que ya estaba resuelto. Es la decisión de diseño de este
    endpoint y no es cosmética: los vínculos `auto` traen empresa en 1.457 de
    1.521 filas y tracto en las 1.521, y un vínculo `manual` es TERMINAL —
    `app.resolve_trip_fleet()` no lo vuelve a mirar. Si al asignar el conductor
    pisáramos esos campos con NULL, la empresa y el tracto ya resueltos se
    perderían para siempre: se estaría cambiando la respuesta a una pregunta
    contestando otra.

    Todo o nada. Un lote que se aplica a medias es peor que uno que falla: la
    persona ve algunos viajes resueltos, no sabe cuáles faltaron, y reintentar
    no es idempotente desde su punto de vista.
    """
    if not body.trip_ids:
        raise HTTPException(422, "Indica al menos un viaje")

    async with pool.acquire() as conn:
        async with conn.transaction():
            filas = await conn.fetch(
                """
                INSERT INTO app.trip_fleet_links AS fl
                    (trip_id, driver_id, link_source, created_by)
                SELECT t.id, $1::uuid, 'manual', $2::uuid
                FROM unnest($3::uuid[]) AS t(id)
                ON CONFLICT (trip_id) DO UPDATE SET
                    driver_id   = EXCLUDED.driver_id,
                    link_source = 'manual',
                    created_by  = EXCLUDED.created_by,
                    updated_at  = now(),
                    -- lo ya resuelto se conserva: sólo cambia el conductor
                    driver_match_rule = NULL
                RETURNING fl.id, fl.trip_id
                """,
                body.driver_id, user["sub"], body.trip_ids,
            )
            await conn.execute(
                """
                UPDATE app.trips t SET fleet_link_id = fl.id, updated_at = now()
                FROM app.trip_fleet_links fl
                WHERE fl.trip_id = t.id AND t.id = ANY($1::uuid[])
                """,
                body.trip_ids,
            )

    # Una sola sentencia, no un INSERT por viaje: el lote llega a 33 viajes
    # para una persona, y un `for` acá son 33 viajes de ida y vuelta para
    # escribir el mismo texto. Best-effort como el resto de la bitácora — que
    # falle la nota no puede deshacer una asignación ya confirmada.
    driver_name = await pool.fetchval(
        "SELECT full_name FROM public.drivers WHERE id = $1", body.driver_id
    )
    try:
        await pool.execute(
            """
            INSERT INTO app.trip_notes (trip_id, author_id, body, note_type)
            SELECT t.id, $1::uuid, $2, 'sistema'
            FROM unnest($3::uuid[]) AS t(id)
            """,
            user["sub"],
            f"Vinculó conductor: {driver_name or body.driver_id}",
            body.trip_ids,
        )
    except Exception:
        pass

    return {"asignados": len(filas)}


@router.get("/driver-candidates")
async def driver_candidates(
    nombre: str = Query("", description="Nombre tal como lo reporta el TMS"),
    limit: int = Query(5, ge=1, le=25),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Quién puede ser la persona que el TMS nombra así.

    ORDENA LA CONTENCIÓN, NO LA SIMILITUD, y eso no es una preferencia: está
    medido. Sobre los 7 viajes cuya identidad es SEGURA porque el TMS mandó el
    RUT (`driver_match_rule='tms_rut'`), en los 7 **todos** los tokens del TMS
    están dentro del nombre del roster. La similitud baja únicamente porque el
    TMS reporta MENOS palabras:

        4 tokens vs 2 → 0.400    4 vs 3 → 0.700    4 vs 4 → 1.000

    Un umbral de similitud en 0.5 habría escondido 3 de esos 7 — gente cuya
    identidad no estaba en discusión. La similitud castiga igual a un nombre
    incompleto que a un nombre ajeno; la contención los distingue.

    El orden de las palabras y los acentos ya no son un problema:
    `public.name_tokens()` normaliza y ORDENA alfabéticamente, así que
    "APELLIDO NOMBRE" contra "Nombre Apellido" da 1.000 (fix de la Ronda 122,
    que fue lo que destrabó la resolución de conductor).

    Se devuelven también los NO contenidos, con su bandera en `false`: la
    decisión de mostrarlos o ir directo a dar de alta es de la interfaz, no de
    acá. Medido sobre las 28 personas sin identificar de los últimos 30 días:
    19 no tienen ningún candidato contenido, 7 tienen exactamente uno, y 2 son
    ambiguas — esas 2 son el conductor duplicado del roster, que es limpieza
    de datos pendiente y no un defecto de esta consulta.
    """
    # Con un solo token la contención matchearía a cualquiera que comparta ese
    # apellido: media base. Eso no es una pista, es ruido — y el `@>` con un
    # arreglo vacío es cierto para TODAS las filas, que sería peor.
    tokens = [t for t in re.split(r"\s+", nombre.strip()) if t]
    if len(tokens) < 2:
        return {"candidatos": [], "trip_ids_de_la_persona": []}

    rows = await pool.fetch(
        """
        SELECT d.id, d.full_name, d.tax_id,
               c.business_name AS carrier_name,
               -- Bidireccional, IGUAL que `by_partial` dentro de
               -- app.resolve_trip_fleet(): al TMS le puede FALTAR un nombre
               -- (roster 4 tokens, TMS 2) o le puede SOBRAR (roster 3, TMS 4).
               -- Mirar una sola dirección perdía el segundo caso, y no hay
               -- razón para que la sugerencia sea más pobre que el resolvedor.
               (public.name_tokens(d.full_name) @> public.name_tokens($1)
                OR public.name_tokens(d.full_name) <@ public.name_tokens($1)) AS contiene,
               similarity(
                   array_to_string(public.name_tokens(d.full_name), ' '),
                   array_to_string(public.name_tokens($1), ' ')
               ) AS similitud
        FROM public.drivers d
        LEFT JOIN public.driver_assignments da
               ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id
        WHERE d.full_name IS NOT NULL AND d.operational_status = 'ACTIVE'
        ORDER BY contiene DESC, similitud DESC, d.full_name
        LIMIT $2
        """,
        nombre,
        limit,
    )
    # Los viajes REALES de esa persona, no un número calculado en el cliente.
    # El popover ofrece "aplicar a sus N viajes", y varios de esos no están en
    # pantalla: la tabla del Monitor muestra lo activo. Que el número lo invente
    # el cliente contando lo que tiene cargado significaría prometer un alcance
    # y aplicar otro. Se devuelven los ids y el lote se manda con ESOS.
    #
    # Mismo nombre crudo, sin identificar, y sólo la ventana que el popover
    # anuncia (30 días): un viaje de hace cuatro meses no es lo que la persona
    # cree estar tocando.
    viajes = await pool.fetch(
        """
        SELECT t.id
        FROM app.trips t
        LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
        WHERE public.name_tokens(t.fleet->>'driver_name_tms') = public.name_tokens($1)
          AND fl.driver_id IS NULL
          AND t.planning_date > (now() AT TIME ZONE 'America/Santiago')::date - 30
        """,
        nombre,
    )

    return {
        "candidatos": [
            {
                "driver_id": str(r["id"]),
                "full_name": r["full_name"],
                "tax_id": r["tax_id"],
                "carrier_name": r["carrier_name"],
                "contiene": r["contiene"],
                "similitud": float(r["similitud"] or 0),
            }
            for r in rows
        ],
        "trip_ids_de_la_persona": [str(v["id"]) for v in viajes],
    }


@router.get("/cierre-viajes")
async def cierre_viajes(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Los cuatro grupos del paso "Viajes" del Cierre.

    Sólo `hoy` y `rezago` bloquean el cierre: son cargas que nos ofrecieron y
    todavía no contestamos. `en_curso` y `abandonado` se muestran para que no
    desaparezcan de la vista —regla 5 de Pablo, "si no me cerraron el viaje no
    me lo van a pagar"— pero no impiden firmar el día.

    Declarado ANTES de GET /{trip_id} — FastAPI matchea rutas en el orden en
    que se registran, así que el literal "/cierre-viajes" debe ir antes del
    path param genérico o quedaría absorbido como trip_id="cierre-viajes"
    (mismo gotcha que documenta PATCH /bulk-close)."""
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    filas = await pool.fetch(
        f"""
        WITH g AS ({SQL_GRUPOS_CIERRE})
        SELECT g.*, ur.label AS unassigned_reason_label
        FROM g
        LEFT JOIN app.status_taxonomies ur ON ur.id = g.unassigned_reason_id
        """,
        day,
    )

    grupos: dict[str, list] = {"hoy": [], "rezago": [], "en_curso": [], "abandonado": []}
    for r in filas:
        grupos[r["grupo"]].append({
            "trip_id": str(r["trip_id"]),
            "planning_date": r["planning_date"].isoformat() if r["planning_date"] else None,
            "client_name": r["client_name"],
            "source_system_trip_id": r["source_system_trip_id"],
            "trip_status": r["trip_status"],
            "dias_sin_novedad": float(r["dias_sin_novedad"] or 0),
            "unassigned_reason_id": str(r["unassigned_reason_id"]) if r["unassigned_reason_id"] else None,
            "unassigned_reason_label": r["unassigned_reason_label"],
        })

    return {"grupos": grupos, "bloquean": len(grupos["hoy"]) + len(grupos["rezago"])}


@router.get("/{trip_id}")
async def get_trip(
    trip_id: str,
    pool=Depends(get_pool),
    user=Depends(get_current_user),
):
    row = await pool.fetchrow(
        f"SELECT {_TRIP_SELECT} {_TRIP_FROM} WHERE t.id = $1",
        trip_id,
    )
    if not row:
        raise HTTPException(404, "Viaje no encontrado")
    d = dict(row)
    stops_by_trip = await _load_trip_stops(pool, {trip_id})
    d["stops"] = stops_by_trip.get(trip_id, [])
    d["cargo_delivered"] = _cargo_delivered(d["stops"])
    temp_ranges = await _load_temperature_ranges(pool)
    d["temp_status"] = _trip_temp_status(d["stops"], d.get("cargo_type"), d["cargo_delivered"], temp_ranges)
    _annotate_stop_temp_status(d["stops"], d.get("cargo_type"), temp_ranges)
    _attach_origin(d)
    client_names = {d["client_name"].strip().lower()} if d.get("client_name") else set()
    op_type_buckets = await _load_operation_type_buckets(pool, client_names)
    _apply_operation_types(d, op_type_buckets)
    await _log_tms_divergence_once(pool, trip_id, user, d)
    return d


@router.patch("/bulk-close")
async def bulk_close_trips(
    body: TripBulkCloseBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    """Selección masiva en el Diario (TripTable) para cerrar/finalizar
    varios viajes de una — mismo mecanismo que ya usa IndicatorSwitches por
    viaje individual (is_active/is_working=false), solo que en lote.
    Declarado ANTES de PATCH /{trip_id} — FastAPI matchea rutas en el orden
    en que se registran, así que un literal "/bulk-close" debe ir antes del
    path param genérico o quedaría absorbido como trip_id="bulk-close"."""
    if not body.trip_ids:
        raise HTTPException(422, "trip_ids no puede estar vacío")
    if not body.unassigned_reason_id:
        raise HTTPException(422, "Indica el motivo por el que no se tomó la carga")

    rows = await pool.fetch(
        "SELECT id, manually_edited_fields FROM app.trips WHERE id = ANY($1::uuid[])",
        body.trip_ids,
    )
    found_ids = {str(r["id"]) for r in rows}
    missing = [tid for tid in body.trip_ids if tid not in found_ids]
    if missing:
        raise HTTPException(404, f"Viaje(s) no encontrado(s): {missing}")

    motivo = await pool.fetchval(
        "SELECT label FROM app.status_taxonomies WHERE id = $1", body.unassigned_reason_id)

    # El UPDATE y la traza en public.audit_log van en la MISMA transacción:
    # si log_change revienta para un viaje del lote, el lote entero se
    # revierte — nunca queda una parte con is_active=false y motivo escrito
    # pero sin auditoría, que es justo lo que cruza con facturación.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE app.trips
                SET is_active = false, is_working = false,
                    unassigned_reason_id = $3::uuid,
                    manually_edited_fields = ARRAY(SELECT DISTINCT unnest(
                        COALESCE(manually_edited_fields,'{}')
                        || ARRAY['is_active','is_working','unassigned_reason_id']::text[]
                    )),
                    edited_by = $2::uuid, edited_at = NOW(), updated_at = NOW()
                WHERE id = ANY($1::uuid[])
                """,
                body.trip_ids, user["sub"], body.unassigned_reason_id,
            )
            for tid in body.trip_ids:
                await log_change(
                    conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                    action="no_asignado_por_webcarga", field="unassigned_reason_id",
                    old_value=None, new_value=motivo, source="cierre_viajes",
                )

    # Deliberadamente FUERA de la transacción de arriba: `_log_system_note`
    # es best-effort a propósito y se traga sus errores con
    # `except Exception: pass`. Si corriera adentro de esa transacción, un
    # fallo ahí dejaría la transacción abortada y todo lo que viniera
    # después fallaría en silencio — bug ya conocido en este proyecto (ver
    # `_usuario_real` en tests/conftest.py). "AL LADO, no encima": el viaje
    # conserva su estado del TMS y esto se lee en el historial junto a él.
    # Pablo: "yo despues filtrare en el historial todos los no asignados por
    # WebCarga".
    for tid in body.trip_ids:
        await _log_system_note(pool, tid, user, f"No asignado por WebCarga · {motivo}")
    return {"ok": True, "closed": len(body.trip_ids)}


@router.patch("/{trip_id}")
async def patch_trip(
    trip_id: str,
    body: TripPatch,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.trips WHERE id = $1", trip_id)
    if not exists:
        raise HTTPException(404, "Viaje no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    # driver_name goes to trip_fleet_links.driver_name_raw (not app.trips)
    if "driver_name" in data:
        new_name = data.pop("driver_name")
        link_id = await pool.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
        if link_id:
            await pool.execute(
                "UPDATE app.trip_fleet_links SET driver_name_raw = $1, updated_at = NOW() WHERE id = $2",
                new_name, link_id,
            )
        else:
            new_link_id = await pool.fetchval(
                """INSERT INTO app.trip_fleet_links
                   (trip_id, driver_name_raw, link_source, created_by)
                   VALUES ($1, $2, 'manual', $3) RETURNING id""",
                trip_id, new_name, user["sub"],
            )
            await pool.execute(
                "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
                new_link_id, trip_id,
            )

    # driver_phone goes to trip_fleet_links
    if "driver_phone" in data:
        new_phone = data.pop("driver_phone")
        link_id = await pool.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
        if link_id:
            await pool.execute(
                "UPDATE app.trip_fleet_links SET driver_phone = $1, updated_at = NOW() WHERE id = $2",
                new_phone, link_id,
            )
        else:
            new_link_id = await pool.fetchval(
                """INSERT INTO app.trip_fleet_links
                   (trip_id, driver_phone, link_source, created_by)
                   VALUES ($1, $2, 'manual', $3) RETURNING id""",
                trip_id, new_phone, user["sub"],
            )
            await pool.execute(
                "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
                new_link_id, trip_id,
            )

    # tractor_plate / trailer_plate go to trip_fleet_links
    plate_updates = {k: data.pop(k) for k in ("tractor_plate", "trailer_plate") if k in data}
    if plate_updates:
        link_id = await pool.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
        if link_id:
            for col, val in plate_updates.items():
                await pool.execute(
                    f"UPDATE app.trip_fleet_links SET {col} = $1, updated_at = NOW() WHERE id = $2",
                    val, link_id,
                )
        else:
            cols = ", ".join(plate_updates.keys())
            phs  = ", ".join(f"${i + 2}" for i in range(len(plate_updates)))
            new_link_id = await pool.fetchval(
                f"""INSERT INTO app.trip_fleet_links
                   (trip_id, {cols}, link_source, created_by)
                   VALUES ($1, {phs}, 'manual', ${len(plate_updates) + 2}) RETURNING id""",
                trip_id, *plate_updates.values(), user["sub"],
            )
            await pool.execute(
                "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
                new_link_id, trip_id,
            )

    # Remaining fields go to app.trips
    bool_fields = ("is_active", "is_working", "is_assigned", "is_first_leg")
    str_fields  = ("manual_status", "notes", "comments",
                   "origin_region", "origin_city", "unassigned_reason_id")
    # cag_inicio_at/cag_fin_at (Carga Inicio/Fin, origen) removidos de acá
    # (Fase 1, cutover final, 2026-07-18) — se editan vía TripStopPatch sobre
    # la parada ORIGIN (PATCH /trips/{id}/stops/{stop_id}), mismo mecanismo
    # que Desc. Inicio/Fin de cualquier destino.
    trip_fields = {k: v for k, v in data.items() if k in (*bool_fields, *str_fields)}
    # Ubicación / motivo de no asignación: string vacío = limpiar (NULL) —
    # evita mezclar '' y NULL en filtros exactos y en la FK de unassigned_reason_id
    for k in ("origin_region", "origin_city", "unassigned_reason_id"):
        if trip_fields.get(k) == "":
            trip_fields[k] = None

    if trip_fields:
        sent = list(trip_fields.keys())
        sets: list[str] = []
        vals: list = [trip_id]

        for field in bool_fields:
            if field in trip_fields:
                vals.append(trip_fields[field])
                sets.append(f"{field} = ${len(vals)}")

        for field in str_fields:
            if field in trip_fields:
                vals.append(trip_fields[field])
                sets.append(f"{field} = ${len(vals)}")

        vals.append(sent)
        sets.append(
            f"manually_edited_fields = ARRAY(SELECT DISTINCT unnest("
            f"COALESCE(manually_edited_fields,'{{}}') || ${len(vals)}::text[]))"
        )
        vals.append(user["sub"])
        sets.append(f"edited_by = ${len(vals)}::uuid")
        sets.append("edited_at = NOW(), updated_at = NOW()")

        await pool.execute(
            f"UPDATE app.trips SET {', '.join(sets)} WHERE id = $1",
            *vals,
        )

    if "manual_status" in data:
        await _log_system_note(
            pool, trip_id, user,
            f"Estableció estado operativo manual: {data['manual_status']}",
        )

    await _mirror_manual_trip(pool, trip_id)
    return await get_trip(trip_id, pool, user)


@router.patch("/{trip_id}/stops/{stop_id}")
async def patch_trip_stop(
    trip_id: str,
    stop_id: str,
    body: TripStopPatch,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Override manual por parada — persiste en las columnas *_manual reales
    de app.trip_stops (desc_inicio_manual/desc_fin_manual, Fase 2 del
    hardening H2.6, más arrival_date_manual/departure_date_manual,
    bitácora 2026-07-29), nunca en `stops` (se sobrescribe completo en cada
    corrida del pipeline dbt). GPS Llegada/Salida NO son overrideables acá
    (fix 2026-07-31, minuta 29/07 §4.2, inamovibles) — TripStopPatch ya no
    acepta esos campos, ver schemas/trip.py."""
    # FIX 2026-07-18: app.trip_stops no tiene columna `id` (solo `stop_id`,
    # su PK) — este SELECT tiraba "column id does not exist" en cualquier
    # llamada real (los tests mockean pool.fetchval, nunca ejecutaron el
    # SQL de verdad, así que pasó desapercibido). Encontrado al verificar
    # que este mismo endpoint sirve para editar Carga Inicio/Fin de la
    # parada ORIGIN (Fase 1, unificación de origen como parada 0).
    exists = await pool.fetchval("SELECT stop_id FROM app.trip_stops WHERE stop_id = $1 AND trip_id = $2", stop_id, trip_id)
    if not exists:
        raise HTTPException(404, "Parada no encontrada")

    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(422, "Ningún campo enviado")

    await pool.execute(
        """
        UPDATE app.trip_stops SET
            desc_inicio_manual         = COALESCE($3::timestamptz, desc_inicio_manual),
            desc_fin_manual            = COALESCE($4::timestamptz, desc_fin_manual),
            arrival_date_manual        = COALESCE($5::timestamptz, arrival_date_manual),
            departure_date_manual      = COALESCE($6::timestamptz, departure_date_manual),
            updated_at                 = NOW()
        WHERE stop_id = $1 AND trip_id = $2
        """,
        stop_id, trip_id,
        _parse_timestamptz(patch.get("desc_inicio")), _parse_timestamptz(patch.get("desc_fin")),
        _parse_timestamptz(patch.get("arrival")), _parse_timestamptz(patch.get("departure")),
    )
    return await get_trip(trip_id, pool, user)


@router.post("/{trip_id}/fleet-link")
async def assign_fleet_link(
    trip_id: str,
    body: dict,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Create or replace a manual fleet link for a trip."""
    exists = await pool.fetchval("SELECT id FROM app.trips WHERE id = $1", trip_id)
    if not exists:
        raise HTTPException(404, "Viaje no encontrado")

    # `carrier_id` OPCIONAL desde 2026-08-18. Conductor y empresa son dos
    # preguntas con fuentes distintas: al conductor lo sabe el TMS, a la
    # empresa no (informa "WEBCARGA SPA" en 933 de 1.050 viajes) y la sabe el
    # registro de flota. Exigir las dos juntas es lo que obligaba a resolver
    # esto desde el detalle del viaje, y lo que hacia que forzar un conductor
    # no guardara nada (reporte del viaje 2032999).
    #
    # Aflojar no es quitar: un vinculo sin conductor NI empresa no afirma
    # nada, y crearlo solo serviria para pisar la resolucion automatica con
    # silencio — el vinculo manual es terminal.
    carrier_id = body.get("carrier_id")
    driver_id = body.get("driver_id")
    if not carrier_id and not driver_id:
        raise HTTPException(422, "Indica al menos un conductor o una empresa")

    # FIX 2026-07-18: buscar por trip_id en trip_fleet_links, no por
    # trips.fleet_link_id (se desincroniza con cada --full-refresh de dbt —
    # ver comentario en _TRIP_FROM). Sin este fix, reasignar la empresa de un
    # viaje con un vínculo huérfano fallaba con 23505 (unique violation en
    # trip_id) porque el INSERT de abajo no encontraba nada que borrar antes.
    old_link_id = await pool.fetchval(
        "SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id
    )
    if old_link_id:
        await pool.execute("DELETE FROM app.trip_fleet_links WHERE id = $1", old_link_id)

    link_id = await pool.fetchval(
        """
        INSERT INTO app.trip_fleet_links
          (trip_id, carrier_id, driver_id, tractor_asset_id, trailer_asset_id,
           tractor_plate, trailer_plate, driver_name_raw, link_source, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9)
        RETURNING id
        """,
        trip_id,
        carrier_id,
        driver_id,
        body.get("tractor_asset_id"),
        body.get("trailer_asset_id"),
        body.get("tractor_plate"),
        body.get("trailer_plate"),
        body.get("driver_name"),
        user["sub"],
    )

    await pool.execute(
        "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
        link_id, trip_id,
    )

    # La nota registra lo que efectivamente se vinculó, no siempre la empresa:
    # desde que `carrier_id` es opcional, la mayoría de las veces es sólo el
    # conductor, y una nota que dice "empresa" sobre un vínculo sin empresa
    # convierte la bitácora en ruido.
    vinculado = []
    if driver_id:
        driver_name = await pool.fetchval(
            "SELECT full_name FROM public.drivers WHERE id = $1", driver_id
        )
        vinculado.append(f"conductor: {driver_name or driver_id}")
    if carrier_id:
        carrier_name = await pool.fetchval(
            "SELECT business_name FROM public.carriers WHERE id = $1", carrier_id
        )
        vinculado.append(f"empresa transportista: {carrier_name or carrier_id}")
    await _log_system_note(pool, trip_id, user, "Vinculó " + " · ".join(vinculado))

    await _mirror_manual_trip(pool, trip_id)
    return await get_trip(trip_id, pool, user)


@router.delete("/{trip_id}/fleet-link")
async def remove_fleet_link(
    trip_id: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Remove the manual fleet link from a trip."""
    # FIX 2026-07-18: mismo motivo que assign_fleet_link — buscar por trip_id,
    # no por trips.fleet_link_id (huérfano tras cualquier --full-refresh).
    link_id = await pool.fetchval(
        "SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id
    )
    if link_id:
        await pool.execute("DELETE FROM app.trip_fleet_links WHERE id = $1", link_id)
        await pool.execute(
            "UPDATE app.trips SET fleet_link_id = NULL, updated_at = NOW() WHERE id = $1",
            trip_id,
        )
        await _log_system_note(pool, trip_id, user, "Desvinculó la empresa transportista")
        await _mirror_manual_trip(pool, trip_id)
    return {"ok": True}


@router.delete("/{trip_id}/overrides/{field}")
async def reset_field(
    trip_id: str,
    field: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    VALID = {"manual_status", "notes", "comments",
             "is_active", "is_working", "is_assigned", "is_first_leg"}
    if field not in VALID:
        raise HTTPException(422, f"Campo no restaurable: {field}")
    await pool.execute(
        """
        UPDATE app.trips
        SET manually_edited_fields = array_remove(manually_edited_fields, $2),
            updated_at = NOW()
        WHERE id = $1
        """,
        trip_id, field,
    )
    if field == "manual_status":
        await _log_system_note(
            pool, trip_id, user, "Revirtió el estado manual al valor del TMS"
        )
    await _mirror_manual_trip(pool, trip_id)
    return {"ok": True, "field": field}


# ── Bitácora: feed cronológico inmutable de notas por viaje ──────────────────

# 'sistema' es exclusivo de eventos generados por la API (ver _log_system_note)
CLIENT_NOTE_TYPES = {"observacion", "llamada", "whatsapp", "incidente"}

ATTACHMENT_BUCKET = "trip-attachments"
ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    # Fotos de iPhone transferidas directo (WhatsApp las convierte a JPEG)
    "image/heic", "image/heif",
    # Office: planillas y guías digitalizadas
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
SIGNED_URL_TTL_SECONDS = 3600


def _safe_storage_name(file_name: str) -> str:
    """Nombre seguro para la key de Supabase Storage. Los nombres reales traen
    caracteres que Storage rechaza con InvalidKey — caso real: capturas de
    macOS ("Captura de pantalla 2026-07-06 a la(s) 11.14.57 a.m..png",
    con espacio angosto U+202F y paréntesis). El nombre original se conserva
    intacto en trip_note_attachments.file_name para mostrarlo en la UI."""
    normalized = unicodedata.normalize("NFKD", file_name)
    ascii_name = normalized.encode("ascii", "ignore").decode()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_name).strip("._")
    return safe or "archivo"

_NOTE_SELECT = """
    n.id, n.trip_id, n.author_id,
    COALESCE(p.full_name, p.email) AS author_name,
    n.body, n.note_type, n.pinned, n.created_at, n.resolved_at
    FROM app.trip_notes n
    LEFT JOIN public.profiles p ON p.id = n.author_id
"""


class TripNotePin(BaseModel):
    pinned: bool


class TripNoteResolve(BaseModel):
    resolved: bool


async def _log_system_note(pool, trip_id: str, user: dict, body: str) -> None:
    """Registra un evento del sistema en la bitácora. Best-effort: un fallo acá
    nunca debe romper la operación principal que lo origina."""
    try:
        await pool.execute(
            """
            INSERT INTO app.trip_notes (trip_id, author_id, body, note_type)
            VALUES ($1, $2::uuid, $3, 'sistema')
            """,
            trip_id, user["sub"], body,
        )
    except Exception:
        pass


async def _attachments_by_note(pool, supabase, note_ids: list) -> dict:
    """Adjuntos por nota, con signed URL de 1h para cada archivo."""
    if not note_ids:
        return {}
    rows = await pool.fetch(
        """
        SELECT id, note_id, storage_path, file_name, mime_type, size_bytes
        FROM app.trip_note_attachments
        WHERE note_id = ANY($1::uuid[])
        ORDER BY created_at ASC
        """,
        note_ids,
    )
    out: dict = {}
    for r in rows:
        d = dict(r)
        try:
            signed = supabase.storage.from_(ATTACHMENT_BUCKET).create_signed_url(
                d["storage_path"], SIGNED_URL_TTL_SECONDS
            )
            d["url"] = signed.get("signedURL") or signed.get("signedUrl")
        except Exception:
            d["url"] = None
        d.pop("storage_path", None)
        note_id = d.pop("note_id")
        out.setdefault(str(note_id), []).append(d)
    return out


@router.get("/{trip_id}/notes")
async def list_trip_notes(
    trip_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    _=Depends(get_current_user),
):
    rows = await pool.fetch(
        f"SELECT {_NOTE_SELECT} WHERE n.trip_id = $1 ORDER BY n.created_at ASC",
        trip_id,
    )
    notes = [dict(r) for r in rows]
    attachments = await _attachments_by_note(pool, supabase, [n["id"] for n in notes])
    for n in notes:
        n["attachments"] = attachments.get(str(n["id"]), [])
    return notes


@router.post("/{trip_id}/notes", status_code=201)
async def add_trip_note(
    trip_id: str,
    body: str = Form(""),
    note_type: str = Form("observacion"),
    files: list[UploadFile] = File(default=[]),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    body = body.strip()
    if not body and not files:
        raise HTTPException(422, "La nota no puede estar vacía")
    if note_type == "sistema":
        raise HTTPException(403, "El tipo 'sistema' está reservado para eventos automáticos")
    if note_type not in CLIENT_NOTE_TYPES:
        raise HTTPException(422, f"Tipo de nota inválido: {note_type}")

    # Validar todos los archivos ANTES de insertar nada
    payloads: list[tuple[str, str, bytes]] = []  # (file_name, mime, data)
    for f in files:
        mime = f.content_type or ""
        if mime not in ALLOWED_ATTACHMENT_MIMES:
            raise HTTPException(422, f"Tipo de archivo no permitido: {f.filename} ({mime})")
        data = await f.read()
        if len(data) > ATTACHMENT_MAX_BYTES:
            raise HTTPException(422, f"Archivo supera 10MB: {f.filename}")
        payloads.append((f.filename or "archivo", mime, data))

    # app.trip_notes no tiene FK a app.trips (dbt --full-refresh recrea la tabla);
    # la integridad se garantiza acá
    exists = await pool.fetchval("SELECT id FROM app.trips WHERE id = $1", trip_id)
    if not exists:
        raise HTTPException(404, "Viaje no encontrado")

    note_id = await pool.fetchval(
        """
        INSERT INTO app.trip_notes (trip_id, author_id, body, note_type)
        VALUES ($1, $2::uuid, $3, $4)
        RETURNING id
        """,
        trip_id, user["sub"], body, note_type,
    )

    for file_name, mime, data in payloads:
        storage_path = f"{trip_id}/{note_id}/{uuid4().hex}_{_safe_storage_name(file_name)}"
        try:
            supabase.storage.from_(ATTACHMENT_BUCKET).upload(
                storage_path, data, {"content-type": mime}
            )
        except Exception as e:
            raise HTTPException(502, f"Error subiendo {file_name}: {e}")
        await pool.execute(
            """
            INSERT INTO app.trip_note_attachments
              (note_id, storage_path, file_name, mime_type, size_bytes)
            VALUES ($1, $2, $3, $4, $5)
            """,
            note_id, storage_path, file_name, mime, len(data),
        )

    row = await pool.fetchrow(f"SELECT {_NOTE_SELECT} WHERE n.id = $1", note_id)
    note = dict(row)
    attachments = await _attachments_by_note(pool, supabase, [note_id])
    note["attachments"] = attachments.get(str(note_id), [])
    return note


@router.patch("/{trip_id}/notes/{note_id}/pin")
async def pin_trip_note(
    trip_id: str,
    note_id: str,
    payload: TripNotePin,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    updated = await pool.fetchval(
        """
        UPDATE app.trip_notes SET pinned = $3
        WHERE id = $1 AND trip_id = $2
        RETURNING id
        """,
        note_id, trip_id, payload.pinned,
    )
    if not updated:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True, "pinned": payload.pinned}


@router.patch("/{trip_id}/notes/{note_id}/resolve")
async def resolve_trip_note(
    trip_id: str,
    note_id: str,
    payload: TripNoteResolve,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Marca/desmarca una nota tipo 'incidente' como resuelta — mismo patrón
    que pin_trip_note. resolved_at nulo = abierto (Ronda 26, Fase 2)."""
    updated = await pool.fetchval(
        """
        UPDATE app.trip_notes SET resolved_at = CASE WHEN $3 THEN NOW() ELSE NULL END
        WHERE id = $1 AND trip_id = $2
        RETURNING id
        """,
        note_id, trip_id, payload.resolved,
    )
    if not updated:
        raise HTTPException(404, "Nota no encontrada")
    return {"ok": True, "resolved": payload.resolved}
