import hashlib
import json
import re
import unicodedata
from datetime import date as _date
from datetime import datetime
from typing import Annotated, Any, Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from ..auth import get_current_user, get_supabase
from ..authz import Permission, require, require_fields
from ..db import get_pool
from ..services.closure_scope import scope_sql, tractor_scope_join
from ..services.cliente_del_viaje import (
    SIN_VINCULAR, join_cliente, leer_filtro_de_cliente, nombre_del_cliente, resolver_cliente, texto_del_cliente_en_el_tms,
)
from ..services.vencimientos import pendiente_predicate
from ..services.entity_summary import usual_tractor_lateral
from ..services.fleet_compliance import alert_severity_sql, carrier_compliance_cte
from ..services.reglas_del_monitor import SQL_REGLAS_DEL_MONITOR
from ..services.ventana_en_curso import dentro_de_la_ventana
from ..schemas.trip import (
    AsignarConductorBody, TripBulkCloseBody, TripVoidBody, TripVoidRevertBody, TripBulkReopenBody, TripPatch, TripStopPatch,
    STOP_FIELD_PERMISSIONS, TRIP_FIELD_PERMISSIONS,
)
from ..services.audit import log_change
from ..services.assignment_guard import AssignmentSubjects, check_assignments, enforce_assignment
from ..services.anular_viajes import (
    SQL_COLUMNAS_ANULABLE, SQL_JOIN_ANULABLE, anotar_anulable, anular_viajes, exigir_vigentes, revertir_anulacion,
)
from ..services.cierre_lineas import frescura_del_dia, ultima_firma
from ..services.cierre_viajes import SQL_CON_MOTIVO, SQL_GRUPOS_CIERRE
from ..services.origen_del_viaje import origen_del_viaje
from ..services.destination_zone import load_operation_type_buckets, resolve_operation_type, trip_zones
from ..utils.identity import canonical_plate, plate_matches_sql, rut_matches_sql


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


_CAN_OPERATE_SQL = f"""
WITH {carrier_compliance_cte()}
SELECT cc.carrier_id::text AS carrier_id, cc.can_operate AS carrier_can_operate,
       c.operational_status AS carrier_operational_status
FROM carrier_compliance cc
JOIN public.carriers c ON c.id = cc.carrier_id
WHERE cc.carrier_id = ANY($1::uuid[])
"""


async def _attach_carrier_can_operate(pool, trips: list[dict]) -> None:
    """¿Puede operar la empresa del viaje? (D1, R-B5). Una consulta por página
    y no un JOIN en _TRIP_FROM: ese FROM también arma los COUNT(*) y la faceta
    de clientes, que no necesitan la base de Pendientes (~150 ms). Sin empresa
    resuelta no hay a quién preguntar: None, no "habilitada".

    Junto viaja el ciclo de vida de la empresa (revisión final D1, M2): una
    empresa que no está activa tampoco puede operar, pero eso no es estar en
    falta (gris, no rojo) y la guarda no deja asignarle el viaje (409)."""
    ids = sorted({str(t["carrier_id"]) for t in trips if t.get("carrier_id")})
    por_empresa: dict[str, Any] = {}
    if ids:
        por_empresa = {f["carrier_id"]: f for f in await pool.fetch(_CAN_OPERATE_SQL, ids)}
    for t in trips:
        fila = por_empresa.get(str(t["carrier_id"])) if t.get("carrier_id") else None
        t["carrier_can_operate"] = fila["carrier_can_operate"] if fila else None
        t["carrier_operational_status"] = fila["carrier_operational_status"] if fila else None


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




def _attach_origin(d: dict) -> None:
    """Deriva d['origin'] (nombre del local) desde la parada stop_type=ORIGIN
    de d['stops'] — ya no es una columna propia de app.trips (Fase 1 del
    hardening del Diario, 2026-07-18: origen unificado como parada 0). Se
    computa acá, después de cargar stops, para no romper vistas/consumidores
    que solo necesitan el nombre de origen de un vistazo (ej. TripTable)."""
    origin_stop = next((s for s in d.get("stops", []) if s.get("stop_type") == "ORIGIN"), None)
    d["origin"] = origin_stop["local"] if origin_stop else None


def _apply_operation_types(d: dict, buckets: dict) -> None:
    bucket = buckets.get(str(d["shipper_id"])) if d.get("shipper_id") else None
    d["origin_operation_type"] = resolve_operation_type(bucket, d.get("origin"))
    stops = d.get("stops")
    if stops:
        for stop in stops:
            stop["operation_type"] = resolve_operation_type(bucket, stop.get("local"))


router = APIRouter(prefix="/trips", tags=["trips"])

# SQL fragment that maps actual DB columns to the expected API response shape.
# fleet JSONB holds tractor/driver info; trip_fleet_links holds the resolved
# ── Señal "Ya no está en el TMS" (Ronda 126) ────────────────────────────
#
# Un viaje se marca cuando su TMS siguió corriendo durante N horas sin
# traerlo. `status_reported_at` es el instante del archivo que lo reportó por
# última vez (verificado contra bronze.tms_trips_snapshot.file_generated_at,
# 8/8 filas de Sodimac), así que el máximo por fuente es su última lectura del
# portal.
#
# NO ES LO MISMO QUE `stale`, que compara contra now(): si el que se cae es
# nuestro scraper, `stale` se enciende para todos y ésta para ninguno, que es
# el comportamiento correcto — nadie eliminó nada. Y al revés: `stale` no
# aplica a Sodimac por diseño (macro is_live_tracked_source del proyecto dbt,
# su estado crudo deja de actualizarse aunque el viaje siga vigente), mientras
# que ésta es precisamente para Sodimac, que es el TMS que borra viajes.
#
# Se calcula acá y no en el frontend porque el umbral vive en la base y así el
# booleano viaja resuelto en el Trip — mismo patrón que `temp_status`, y evita
# arrastrar la última corrida por cinco firmas de funciones de kpis.ts.
#
# HUSO HORARIO: `status_reported_at` es `timestamp without time zone` y los dos
# lados de la resta salen de esa misma columna, así que no hay conversión de
# por medio (ver el bug recurrente de datetime naive con asyncpg).
_TMS_DROPPED_DEFAULT_HOURS = 3.0


async def _load_tms_dropped_context(pool) -> tuple[dict, float]:
    """Última corrida por TMS + el umbral configurado. Un agregado sobre
    ~3.5k filas, despreciable; se resuelve una vez por request, no por viaje."""
    rows = await pool.fetch(
        "SELECT source_system, max(status_reported_at) AS last_run_at "
        "FROM app.trips WHERE status_reported_at IS NOT NULL GROUP BY source_system"
    )
    last_run = {r["source_system"]: r["last_run_at"] for r in rows}
    # Resiliente al orden de deploy, igual que /meta: si la columna todavía no
    # existe, la señal usa el default en vez de romper el listado.
    try:
        hours = await pool.fetchval(
            "SELECT tms_dropped_hours FROM app.monitor_alert_rules WHERE id = 1"
        )
    except Exception:
        hours = None
    return last_run, float(hours) if hours is not None else _TMS_DROPPED_DEFAULT_HOURS


def _tms_dropped(d: dict, ctx: tuple[dict, float]) -> bool:
    last_run_by_source, hours = ctx
    # Sólo viajes abiertos — mismo criterio que isOpenTrip() en kpis.ts. Que un
    # viaje ya cerrado deje de reportarse es lo normal, no una novedad.
    status = d.get("current_status") or ""
    if status.startswith("CERRADO") or status in ("CANCELADO", "Declinada", "Removida"):
        return False
    reported = d.get("status_reported_at")
    last_run = last_run_by_source.get(d.get("source_system"))
    # Sin ninguno de los dos no hay comparación posible: se apaga, no se asume.
    if reported is None or last_run is None:
        return False
    return (last_run - reported).total_seconds() > hours * 3600


# carrier link (public.carriers — repointed from the legacy
# app.transporter_profiles on 2026-07-17, see migration
# migrate_trip_fleet_links_to_carriers).
_TRIP_SELECT = """
    t.id,
    t.source_system,
    -- El cliente que se muestra (spec 2026-10-11): el del directorio, o el texto
    -- del TMS marcado. Una sola definición, en services/cliente_del_viaje.py.
    """ + nombre_del_cliente("t", "sh") + """ AS client_name,
    t.client_name AS source_client_name,
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
    tcomp.pending_count AS tractor_pending_docs,
    ccomp.pending_count AS carrier_pending_docs,
    -- D1 (R-B5): el aviso crítico por entidad, NULL si no está resuelta
    -- (igual que *_pending_docs). No hay un campo del viaje: cada badge dice
    -- de quién es el problema.
    dcomp.has_critical_alert AS driver_has_critical_alert,
    tcomp.has_critical_alert AS tractor_has_critical_alert,
    ccomp.has_critical_alert AS carrier_has_critical_alert,
    notes.last_human_note_at,
    -- D4 (minuta 02/10): desde cuándo el TMS ya no trae el viaje, según la
    -- reconciliación diaria (dbt). NULL = presente o nunca juzgado.
    t.tms_missing_since,
    -- 'eliminado' | 'oferta_retirada', según el catálogo de estados.
    t.tms_absence_kind
"""

# HU-04 (Fase 0, 2026-07-21): antes, cuando un viaje no lograba cruzar con
# empresa/conductor (el fallback en vivo de acá
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
      -- D2 (14/10): la empresa que el conductor y el tracto tenían EL DÍA del viaje
      -- (app.fleet_assignment_periods). Transferir a alguien ya no deja en MISMATCH
      -- sus viajes anteriores.
      WHEN (vfr.resolved_driver_home_carrier_id IS NOT NULL
            AND vfr.resolved_driver_home_carrier_id IS DISTINCT FROM vfr.resolved_carrier_id)
        OR (vfr.resolved_tractor_home_carrier_id IS NOT NULL
            AND vfr.resolved_tractor_home_carrier_id IS DISTINCT FROM vfr.resolved_carrier_id)
        THEN 'MISMATCH'
      ELSE 'MATCHED'
    END
"""
_TRIP_SELECT = _TRIP_SELECT.format(fleet_match_case=_FLEET_MATCH_CASE) + ",\n" + SQL_COLUMNAS_ANULABLE


def _compliance_alert_lateral(alias: str, entity_type: str, id_expr: str, critical_codes: tuple[str, ...] = ()) -> str:
    """Cierre del gap detectado 2026-07-22: el Diario solo mostraba alerta de
    Seguros (HU-12) — la documentación LEGAL_MANDATORY de conductor/tracto/
    empresa (HU-08/09) nunca llegó a mostrarse acá (el summary endpoint viejo
    que la alimentaba se borró en Checkpoint A-E; TripTable.tsx quedó con un
    ComplianceBadge sin productor). Mismo criterio de is_expired/
    is_expiring_soon que ya usa GET /drivers/{id}/compliance-records (el
    `_pending_mandatory_join` de carriers.py que lo compartía se retiró en D1).
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
    # El vocabulario de estados y fechas sale de la definición compartida.
    # El ámbito (LEGAL_MANDATORY) sigue siendo propio de este semáforo.
    pendiente = pendiente_predicate("cr")
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
                    {pendiente}
                )
            ) END AS pending_count,
            CASE WHEN {id_expr} IS NULL THEN NULL ELSE bool_or(
                req.requirement_level = 'LEGAL_MANDATORY'
                AND req.requirement_code = ANY({codes_sql})
                AND ({pendiente})
            ) END AS has_critical_pending,
            -- D1 (R-B5): aviso crítico = un obligatorio dentro de los días
            -- críticos de Configuración › Alertas (severidad calculada en
            -- fleet_compliance), o uno de los documentos críticos pendiente:
            -- el significado de has_critical_pending, que se conserva.
            CASE WHEN {id_expr} IS NULL THEN NULL ELSE COALESCE(bool_or(
                req.requirement_level = 'LEGAL_MANDATORY' AND (
                    {alert_severity_sql('cr')} = 'critical'
                    OR (req.requirement_code = ANY({codes_sql}) AND ({pendiente}))
                )
            ), false) END AS has_critical_alert
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
    -- Quién creó un viaje manual, quién lo anuló y si su día está firmado: deciden
    -- si se puede anular (ver services/anular_viajes.py). 1:1, no multiplican filas.
    """ + SQL_JOIN_ANULABLE + """
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
    -- Alerta de póliza de la empresa del viaje (HU-12; Seguros E1, 15/10): la
    -- MISMA vista de empresa que leen Seguros y la ficha de empresa (EXPIRED,
    -- OVERDUE_INSTALLMENTS = 2 o más cuotas vencidas en una póliza, EXPIRING).
    LEFT JOIN app.carrier_insurance_summary ins ON ins.carrier_id = vfr.resolved_carrier_id
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
    -- El cliente del directorio, por id (spec 2026-10-11; services/cliente_del_viaje.py).
    """ + join_cliente("t", "sh") + """
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
# Ordenables que no son alias del SELECT. El origen es la definición única de
# services/origen_del_viaje.py (Monitor, 15/10: "Origen · Carga" alfabético).
# Expresión fija, nunca input del usuario.
_SORT_EXPRESSIONS = {
    "origin": origen_del_viaje("t"),
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
    shipper_id: Annotated[str, Query()] = "",
    cargo_type: Annotated[str, Query()] = "",
    origin: Annotated[str, Query()] = "",
    origin_region: Annotated[str, Query()] = "",
    origin_city: Annotated[str, Query()] = "",
    fleet_match: Annotated[str, Query()] = "",  # unmatched | mismatch — HU-04 (Fase 0)
    insurance_alert: Annotated[str, Query()] = "",  # EXPIRED | OVERDUE_INSTALLMENTS | EXPIRING — HU-12; Seguros E1
    no_asignado_webcarga: Annotated[bool, Query()] = False,
    sort_by: Annotated[str, Query()] = "planning_date",
    sort_dir: Annotated[str, Query()] = "desc",
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    pool=Depends(get_pool),
    user=Depends(require(Permission.OPERATIONS_READ)),
):
    filters: list[str] = [
        # Los anulados no se listan (spec 2026-10-10 anulación §2.2); el detalle sí los abre.
        "t.voided_at IS NULL",
        "($1 = '' OR t.fleet->>'tractor_plate' ILIKE '%'||$1||'%' "
        "OR fl.tractor_plate ILIKE '%'||$1||'%' "
        "OR t.fleet->>'driver_name_tms' ILIKE '%'||$1||'%' "
        "OR COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms') ILIKE '%'||$1||'%' "
        "OR t.fleet->>'driver_rut_tms' ILIKE '%'||$1||'%' "
        "OR c.business_name ILIKE '%'||$1||'%' "
        "OR t.fleet->>'transporter_name_tms' ILIKE '%'||$1||'%' "
        "OR sh.name ILIKE '%'||$1||'%' "
        "OR t.client_name ILIKE '%'||$1||'%' "
        "OR t.source_system_trip_id ILIKE '%'||$1||'%' "
        # El conductor y el tracto RESUELTOS (D4): "Ver viajes en el Monitor" de su
        # ficha busca por su RUT o su patente, y tiene que encontrar los mismos
        # viajes que cuenta su Actividad, no solo los que el TMS escribió igual.
        f"OR {rut_matches_sql('d.tax_id', '$1')} "
        f"OR {plate_matches_sql('ta.license_plate', '$1')} "
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
        # "El TMS es la Biblia" (minuta 02/10): lo que el TMS borró no sigue en
        # curso aunque dbt todavía no lo haya apagado. Queda en el historial.
        filters.append("t.tms_missing_since IS NULL")
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
    if insurance_alert in ("EXPIRED", "OVERDUE_INSTALLMENTS", "EXPIRING"):
        add("ins.insurance_alert = ?", insurance_alert)
    if no_asignado_webcarga:
        # No mira is_active: el punto es el HISTORIAL de lo que nos
        # ofrecieron y no tomamos, incluidos los que ya se apagaron hace
        # meses (Pablo, spec §6.3).
        filters.append("t.unassigned_reason_id IS NOT NULL")

    # "En curso" es la ventana de los que se movieron hace poco (decisión del
    # usuario 11/10, services/ventana_en_curso.py). Los demás siguen activos y
    # se cuentan aparte para decirlo al pie.
    ventana = dentro_de_la_ventana("t") if view == "en_curso" else None
    if ventana:
        filters.append(ventana)

    # Las opciones del filtro de cliente salen de la vista sin ese mismo filtro
    # (faceta disyuntiva): elegir un cliente no hace desaparecer a los demás. Por
    # eso el filtro de cliente va último, después de esta foto.
    where_sin_cliente = "WHERE " + " AND ".join(filters)
    params_sin_cliente = list(params)
    if shipper_id:
        # Por id del directorio (spec 2026-10-11). "unlinked" = viajes de un
        # cliente del TMS todavía sin vincular en Configuración.
        reales, sin_vincular = leer_filtro_de_cliente(shipper_id)
        if reales and sin_vincular:
            add("(t.shipper_id = ANY(?::uuid[]) OR t.shipper_id IS NULL)", reales)
        elif reales:
            add("t.shipper_id = ANY(?::uuid[])", reales)
        else:
            filters.append("t.shipper_id IS NULL")

    where = "WHERE " + " AND ".join(filters)
    # Los mismos filtros, con la ventana dada vuelta: lo que se está mirando,
    # pero sin movimiento reciente.
    where_fuera_de_la_ventana = (
        "WHERE " + " AND ".join(f"NOT {c}" if c == ventana else c for c in filters) if ventana else None)
    offset = (page - 1) * limit
    sort_col = _SORT_EXPRESSIONS.get(sort_by) or (sort_by if sort_by in _SORTABLE_COLUMNS else "planning_date")
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
    shipper_ids = set()
    trip_ids = set()
    for r in rows:
        d = dict(r)
        if d.get("shipper_id"):
            shipper_ids.add(str(d["shipper_id"]))
        trip_ids.add(str(d["id"]))
        data.append(d)

    await _attach_carrier_can_operate(pool, data)
    stops_by_trip = await _load_trip_stops(pool, trip_ids)
    op_type_buckets = await load_operation_type_buckets(pool, shipper_ids)
    temp_ranges = await _load_temperature_ranges(pool)
    dropped_ctx = await _load_tms_dropped_context(pool)
    for d in data:
        d["stops"] = stops_by_trip.get(str(d["id"]), [])
        d["cargo_delivered"] = _cargo_delivered(d["stops"])
        d["temp_status"] = _trip_temp_status(d["stops"], d.get("cargo_type"), d["cargo_delivered"], temp_ranges)
        _annotate_stop_temp_status(d["stops"], d.get("cargo_type"), temp_ranges)
        _attach_origin(d)
        _apply_operation_types(d, op_type_buckets)
        d["tms_dropped"] = _tms_dropped(d, dropped_ctx)
        anotar_anulable(d, user)

    clientes = await pool.fetch(
        f"SELECT t.shipper_id::text AS id, sh.name, count(*) AS count {_TRIP_FROM} {where_sin_cliente} "
        "GROUP BY t.shipper_id, sh.name ORDER BY sh.name NULLS LAST",
        *params_sin_cliente,
    )
    clients = [
        {"id": r["id"] or SIN_VINCULAR, "name": r["name"] or "Sin cliente vinculado", "count": r["count"]}
        for r in clientes
    ]

    respuesta = {"data": data, "count": count, "page": page, "limit": limit, "clients": clients}
    if where_fuera_de_la_ventana:
        respuesta["outside_window_count"] = await pool.fetchval(
            f"SELECT COUNT(*) {_TRIP_FROM} {where_fuera_de_la_ventana}", *params)
    return respuesta


# ── Metadatos de presentación (sin auth — igual que /roles) ──────────────────

_TMS_META = [
    {"id": "qanalytics", "label": "QA"},
    {"id": "wingsuite",  "label": "WS"},
    {"id": "sodimac",    "label": "SDM"},
    {"id": "manual",     "label": "Manual"},
]

# Clasificación RM/Zona Cero de la minuta UAT (catálogo de locales, H2.6) —
# valores fijos tal cual vienen de la planilla de generadores de carga
# (public.locations.operation_type), no una tabla configurable como
# trip_statuses: no hay pedido de negocio para editarlos desde Configuración.
_OPERATION_TYPE_META = [
    {"id": "RM",            "label": "RM"},
    {"id": "Z0",             "label": "Zona Cero"},
    {"id": "Region Norte",  "label": "Región Norte"},
    {"id": "Region Sur",    "label": "Región Sur"},
]

_CSV_COLUMNS = [
    {"field": "planning_date",    "csv_key": "fecha_planificacion", "label": "Fecha planificación", "required": True,  "type": "date",       "example": "2026-05-29"},
    {"field": "source_system_trip_id", "csv_key": "id_origen",     "label": "ID en sistema origen", "required": False, "type": "text",       "example": "VJE-001"},
    {"field": "origin_tms",       "csv_key": "tms_origen",          "label": "TMS de origen",       "required": False, "type": "tms_source", "example": "qanalytics"},
    {"field": "client_name",      "csv_key": "cliente",             "label": "Cliente",             "required": True,  "type": "text",       "example": "Walmart"},
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
    # group_id con el nombre que usa el frontend; nulo = "Sin columna" (se ve neutro).
    group:      Optional[str] = None


class TmsSourceMeta(BaseModel):
    id:         str
    label:      str
    # Última corrida de esta TMS: el `status_reported_at` más reciente de
    # TODOS sus viajes. Verificado 2026-08-18 contra bronze: ese campo es
    # exactamente el `file_generated_at` del archivo que trajo al viaje, así
    # que el máximo por fuente es el instante de su última lectura del portal.
    #
    # Lo usa la señal "Ya no está en el TMS" (kpis.ts): un viaje cuyo
    # status_reported_at quedó atrás de este valor es un viaje que la TMS
    # tuvo oportunidad de reportar y no reportó. Distinto de la señal
    # `stale`, que compara contra now() y por lo tanto también se enciende
    # cuando el que está caído es nuestro scraper.
    #
    # None si la fuente todavía no tiene ningún viaje — el frontend apaga la
    # señal en ese caso en vez de tratar el nulo como "hace mucho".
    last_run_at: Optional[datetime] = None


class OperationalStateMeta(BaseModel):
    id:         str
    label:      str
    # Grupo del tablero (misma taxonomía que StatusMeta.group) — permite que un
    # override manual (manual_status) bucketee a su columna en vez de caer a "Otro"
    group:      Optional[str] = None


class MonitorAlertRulesMeta(BaseModel):
    stale_report_hours:     float
    dwell_hours:            float
    late_arrival_grace_min: int
    unassigned_enabled:     bool
    dwell_yellow_min:       int
    dwell_orange_min:       int
    dwell_red_min:          int
    tms_dropped_hours:      float
    stale_trip_days:        Optional[int] = None
    in_progress_idle_days:  int


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
    group: str = "no_trabajando"


class OperationTypeMeta(BaseModel):
    id:         str
    label:      str


class TripsMeta(BaseModel):
    statuses:            list[StatusMeta]
    tms_sources:         list[TmsSourceMeta]
    operational_states:  list[OperationalStateMeta]
    csv_columns:         list[CSVColumnDef]
    temperature_ranges:  list[TemperatureRangeMeta]
    unassigned_reasons:  list[UnassignedReasonMeta]
    operation_types:     list[OperationTypeMeta]
    origins:             list[str]
    monitor_alert_rules: Optional[MonitorAlertRulesMeta] = None


@router.get("/meta", response_model=TripsMeta)
async def get_trips_meta(pool=Depends(get_pool), _=Depends(require(Permission.OPERATIONS_READ))):
    status_rows = await pool.fetch(
        "SELECT id, label, group_id AS group "
        "FROM app.trip_statuses WHERE active = true ORDER BY sort_order"
    )
    op_rows = await pool.fetch(
        'SELECT id::text, label, group_id AS "group" '
        "FROM app.status_taxonomies WHERE domain = 'OPERATIONAL_STATE' AND active = true ORDER BY sort_order"
    )
    # Resiliente al orden de deploy: si la tabla aún no existe (migración
    # pendiente), /meta sigue funcionando y el frontend usa sus defaults
    try:
        alert_rules_row = await pool.fetchrow(SQL_REGLAS_DEL_MONITOR)
    except Exception:
        alert_rules_row = None
    # Última corrida por TMS — ver TmsSourceMeta.last_run_at. Se calcula sobre
    # app.trips y no sobre bronze a propósito: la API lee la capa app, y ese
    # campo ya trae el dato exacto.
    last_run_rows = await pool.fetch(
        "SELECT source_system, max(status_reported_at) AS last_run_at "
        "FROM app.trips WHERE status_reported_at IS NOT NULL GROUP BY source_system"
    )
    last_run_by_source = {r["source_system"]: r["last_run_at"] for r in last_run_rows}
    temp_range_rows = await pool.fetch(
        "SELECT cargo_type, label, min_c, max_c "
        "FROM app.temperature_ranges ORDER BY cargo_type"
    )
    unassigned_reason_rows = await pool.fetch(
        # `group`: si el motivo es "no trabajó" o "trabajó sin asignación"
        # (migración 20260917000000). Sin grupo se lee como "no trabajó".
        "SELECT id::text, label, COALESCE(group_id, 'no_trabajando') AS \"group\" "
        "FROM app.status_taxonomies "
        "WHERE domain = 'DRIVER_REASON' AND active = true ORDER BY sort_order"
    )
    # Los CD de origen que EXISTEN (bug 5.2):
    # dinamico segun lo que hay en la base, no un catalogo. El filtro de Origen
    # era un autocomplete con el argumento de que son "cientos de locales" —
    # cierto para los DESTINOS (279 distintos) y falso para los origenes:
    # medido el 2026-09-07, son 23 en todo el historico y cinco concentran el
    # 98% del volumen. Con eso, una lista se lee de un vistazo y el
    # autocomplete obligaba a saber el nombre antes de buscarlo.
    #
    # Ordenados por volumen y no alfabeticamente: los CD que mueven la
    # operacion tienen que estar arriba.
    origin_rows = await pool.fetch(
        "SELECT ts.local "
        "FROM app.trip_stops ts "
        "WHERE ts.stop_type = 'ORIGIN' AND NULLIF(btrim(ts.local), '') IS NOT NULL "
        "GROUP BY ts.local ORDER BY count(*) DESC, ts.local"
    )
    return TripsMeta(
        statuses=[StatusMeta(**dict(r)) for r in status_rows],
        tms_sources=[
            TmsSourceMeta(**t, last_run_at=last_run_by_source.get(t["id"])) for t in _TMS_META
        ],
        operational_states=[OperationalStateMeta(**dict(r)) for r in op_rows],
        csv_columns=[CSVColumnDef(**c) for c in _CSV_COLUMNS],
        temperature_ranges=[TemperatureRangeMeta(**dict(r)) for r in temp_range_rows],
        unassigned_reasons=[UnassignedReasonMeta(**dict(r)) for r in unassigned_reason_rows],
        operation_types=[OperationTypeMeta(**t) for t in _OPERATION_TYPE_META],
        origins=[r["local"] for r in origin_rows],
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
# como un id de viaje.

@router.get("/available-drivers")
async def available_drivers(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(require(Permission.OPERATIONS_READ)),
):
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    rows = await pool.fetch(
        f"""
        WITH active_roster AS (
            SELECT d.id, d.full_name, d.tax_id, c.id AS carrier_id, c.business_name AS carrier_name
            FROM public.drivers d
            JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE d.operational_status = 'ACTIVE'
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
            -- Los viajes del día salen de app.trips_del_dia() (16/09), la
            -- misma definición que el Cierre: cuenta el multi-día abierto
            -- desde un día anterior y ya no cuenta un CANCELADO — antes un
            -- conductor con la ruta cancelada no aparecía como disponible.
            WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
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
            sv.id            AS tractor_asset_id,
            COALESCE(tt.tractor_plate, sv.license_plate) AS tractor_plate,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.driver_id = ar.id
        -- Vehículo que el conductor maneja habitualmente (migración
        -- 20260718070000) — independiente de si tuvo viaje hoy, para no
        -- perder la patente de alguien con 0 viajes hoy pero con equipo fijo.
        -- Uno solo por conductor (F-07).
        {usual_tractor_lateral('ar.id', 'sv')}
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
    _=Depends(require(Permission.OPERATIONS_READ)),
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
            WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
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
        f"""
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
                {nombre_del_cliente('t', 'sh')} AS client_name,
                t.trip_status AS current_status
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            {join_cliente('t', 'sh')}
            -- FIX 2026-08-02 (ítem 16 de la minuta) — mismo criterio que las
            -- 2 queries de arriba: un viaje multi-día abierto desde un día
            -- anterior sigue haciendo "ocupado" al equipo hoy.
            WHERE t.id IN (SELECT trip_id FROM app.trips_del_dia($1))
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
    # El cliente del directorio (spec 2026-10-11). El formulario manda el id;
    # la carga CSV, el nombre, que se resuelve contra el directorio.
    shipper_id:             Optional[str] = None
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


async def _preparar_cliente(conn, body: TripCreateBody) -> TripCreateBody:
    """El cliente del alta, resuelto contra el directorio (spec 2026-10-11): el
    id del cliente, y el texto que entra al id canónico del viaje. Una sola
    definición para el alta individual y la validación del CSV.

    Un viaje de un TMS integrado guarda el cliente como lo escribe ese TMS: así
    su id calza con el que el TMS va a reportar, aunque el cliente se haya
    renombrado en el directorio (revisión final, Importante 1)."""
    shipper_id, nombre_cliente = await resolver_cliente(
        conn, shipper_id=body.shipper_id, client_name=body.client_name)
    if body.origin_tms in MAPPED_TMS_IDS:
        nombre_cliente = await texto_del_cliente_en_el_tms(
            conn, source_system=body.origin_tms, shipper_id=shipper_id) or nombre_cliente
    return body.model_copy(update={"client_name": nombre_cliente, "shipper_id": shipper_id})


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


async def _activo_de_la_patente(conn, patente: str | None, asset_id: str | None) -> tuple[str | None, str | None]:
    """(asset_id, patente) coherentes para un vínculo manual.

    El formulario manda las dos cosas: al elegir el conductor autocompleta el
    tracto habitual (id y patente) y deja la patente editable para corregirla
    si ese día manejó otro. Corregir el texto no cambia el id, así que confiar
    en el par guardaba "CVZP50" apuntando al activo de FWKL67 (viaje 2048292,
    16/09). La patente es lo que la persona ve y corrige: si viene, el activo
    sale de ella —o ninguno, si no está en el directorio—. Sin patente, se
    toma la del activo."""
    patente = (patente or "").strip().upper() or None
    if patente:
        encontrado = await conn.fetchval(
            "SELECT id::text FROM public.assets WHERE license_plate = public.canonical_plate($1) LIMIT 1", patente,
        )
        # 'AB-CD12' encuentra ABCD12 y se guarda canónica; una patente fuera del
        # directorio se guarda como se escribió.
        return encontrado, canonical_plate(patente) or patente
    if asset_id:
        return asset_id, await conn.fetchval(
            "SELECT license_plate FROM public.assets WHERE id = $1", asset_id,
        )
    return None, None


async def _assignment_subjects(conn, body: TripCreateBody) -> AssignmentSubjects | None:
    """Lo que el alta va a vincular, para la guarda (D1 §7.1). Nada si no hay
    empresa: sin empresa el alta no escribe vínculo manual y lo resuelve el
    trigger (C-R7). El equipo sale de la patente, igual que en _insert_trip."""
    if not body.carrier_id:
        return None
    tractor_id, _ = await _activo_de_la_patente(conn, body.tractor_plate, body.tractor_asset_id)
    trailer_id, _ = await _activo_de_la_patente(conn, body.trailer_plate, body.trailer_asset_id)
    return AssignmentSubjects(carrier_id=body.carrier_id, driver_id=body.driver_id,
                              asset_ids=tuple(a for a in (tractor_id, trailer_id) if a))


async def _escribir_link_manual(
    conn, trip_id: str, *, user: dict,
    carrier_id: str | None, driver_id: str | None,
    tractor_asset_id: str | None, tractor_plate: str | None,
    trailer_asset_id: str | None, trailer_plate: str | None,
    driver_name: str | None, driver_phone: str | None = None,
) -> str:
    """Único punto que escribe el vínculo MANUAL de un viaje.

    El vínculo tiene dos dueños posibles y UNA sola fila por viaje
    (UNIQUE(trip_id)): el trigger `trg_trips_resolve_fleet_*` escribe el
    `auto` (capas 1-4 de app.resolve_trip_fleet) y la persona escribe el
    `manual`, que es terminal. Por eso es un upsert que CONVIERTE la fila:
    la elección humana reemplaza a la inferencia, y lo que era propio de la
    inferencia (regla de match, fecha de resolución) se limpia.

    Antes había dos escrituras distintas: el alta hacía un INSERT pelado y
    chocaba contra el `auto` que el trigger acababa de escribir (500 del
    23/09, nunca funcionó desde el 17/08), y la reasignación hacía
    SELECT+DELETE+INSERT para esquivar el mismo choque."""
    link_id = await conn.fetchval(
        """
        INSERT INTO app.trip_fleet_links
          (trip_id, carrier_id, driver_id, tractor_asset_id, trailer_asset_id,
           tractor_plate, trailer_plate, driver_name_raw, driver_phone,
           link_source, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10::uuid)
        ON CONFLICT (trip_id) DO UPDATE SET
            carrier_id           = EXCLUDED.carrier_id,
            driver_id            = EXCLUDED.driver_id,
            tractor_asset_id     = EXCLUDED.tractor_asset_id,
            trailer_asset_id     = EXCLUDED.trailer_asset_id,
            tractor_plate        = EXCLUDED.tractor_plate,
            trailer_plate        = EXCLUDED.trailer_plate,
            driver_name_raw      = EXCLUDED.driver_name_raw,
            driver_phone         = EXCLUDED.driver_phone,
            transporter_name_raw = NULL,
            link_source          = 'manual',
            driver_match_rule    = NULL,
            resolved_at          = NULL,
            created_by           = EXCLUDED.created_by,
            updated_at           = NOW()
        RETURNING id
        """,
        trip_id, carrier_id, driver_id, tractor_asset_id, trailer_asset_id,
        tractor_plate, trailer_plate, driver_name, driver_phone, user["sub"],
    )
    await conn.execute("UPDATE app.trips SET fleet_link_id = $1 WHERE id = $2", link_id, trip_id)
    return link_id


async def _insert_trip(conn, body: TripCreateBody, user: dict, valid_statuses: set[str]) -> str:
    """Crea un viaje manual: fuente de verdad en app.trips_manual (sobrevive al
    full-refresh de dbt vía la rama UNION del modelo) + espejo inmediato en
    app.trips (visibilidad sin esperar al pipeline). Mismo id en ambas."""
    _validate_create_body(body, valid_statuses)
    body = await _preparar_cliente(conn, body)

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
                id, origin_tms, source_system_trip_id, client_name, shipper_id, planning_date,
                origin_region, origin_city, cargo_type, trip_status,
                fleet, stops, created_by
            ) VALUES ($1,$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::uuid)
            """,
            trip_id, body.origin_tms, body.source_system_trip_id, body.client_name, body.shipper_id,
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

    # Activo y asignado los calcula la regla (app.is_trip_open / is_trip_assigned),
    # la misma que usa dbt; nunca un literal (spec 2026-10-11). El vínculo de
    # flota que se escribe más abajo lo recoge el trigger trg_sync_trip_assignment.
    await conn.execute(
        """
        INSERT INTO app.trips (
            id, source_system, origin_tms, source_system_trip_id, client_name, shipper_id,
            planning_date, origin_region, origin_city, cargo_type,
            trip_status, fleet, stops,
            is_active, is_working, is_assigned, is_first_leg,
            status_reported_at, pipeline_updated_at, created_at, updated_at,
            manually_edited_fields
        ) VALUES ($1,'manual',$2,$3,$4,$5::uuid,$6,$7,$8,$9,$10::text,$11::jsonb,$12::jsonb,
                  COALESCE(app.is_trip_open($10::text), true), false,
                  app.is_trip_assigned($10::text, $11::jsonb, $1::uuid), false,
                  NOW(),NOW(),NOW(),NOW(),'{}')
        """,
        trip_id, body.origin_tms, body.source_system_trip_id, body.client_name, body.shipper_id,
        body.planning_date, body.origin_region, body.origin_city,
        body.cargo_type, body.current_status,
        fleet_json, stops_json,
    )

    await _insert_trip_stops(conn, body.stops, trip_id)

    # Vínculo manual sólo si la persona eligió empresa. Sin empresa (carga
    # masiva CSV) no se escribe nada acá: el INSERT de arriba ya disparó
    # `trg_trips_resolve_fleet_ins`, que resuelve por patente, RUT y nombre
    # con las 4 capas del modelo de flota. Una segunda resolución en Python
    # —la que había acá— sólo podía duplicarlo o contradecirlo.
    if body.carrier_id:
        tractor_asset_id, tractor_plate = await _activo_de_la_patente(
            conn, body.tractor_plate, body.tractor_asset_id)
        trailer_asset_id, trailer_plate = await _activo_de_la_patente(
            conn, body.trailer_plate, body.trailer_asset_id)
        link_id = await _escribir_link_manual(
            conn, trip_id, user=user,
            carrier_id=body.carrier_id, driver_id=body.driver_id,
            tractor_asset_id=tractor_asset_id, tractor_plate=tractor_plate,
            trailer_asset_id=trailer_asset_id, trailer_plate=trailer_plate,
            driver_name=body.driver_name, driver_phone=body.driver_phone,
        )
        await conn.execute(
            "UPDATE app.trips_manual SET fleet_link_id = $1 WHERE id = $2",
            link_id, trip_id,
        )

    return trip_id


async def _lock_trip_for_update(conn, trip_id: str) -> None:
    """Bloquea el viaje antes de tocar su vínculo de flota, en el mismo orden que
    la corrida de dbt (MERGE de app.trips y después resolve_trip_fleet sobre
    app.trip_fleet_links). Con el orden inverso, una edición y la ingesta sobre
    el mismo viaje se bloqueaban en cruz: deadlock, y Postgres cortaba la
    edición o la corrida completa (revisión final, spec 2026-10-11)."""
    await conn.execute("SELECT 1 FROM app.trips WHERE id = $1 FOR UPDATE", trip_id)


async def _mirror_manual_trip(conn, trip_id: str) -> None:
    """Copia los campos editables de un viaje manual de app.trips a
    app.trips_manual, de donde dbt lo reconstruye. Sin copia, la siguiente
    corrida pisa la edición del operador. No hace nada en un viaje del TMS (no
    tiene fila en trips_manual).

    Corre dentro de la transacción de la edición y propaga cualquier error:
    antes se lo tragaba un `except Exception: pass`, y la edición se perdía en
    silencio en la corrida siguiente (spec 2026-10-11)."""
    await conn.execute(
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


@router.post("")
async def create_trip(
    body: TripCreateBody,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_CREATE)),
):
    valid_statuses = await _valid_status_ids(pool)
    # Todo o nada, igual que /bulk: sin transacción, un error a mitad de
    # camino dejaba el viaje, sus paradas y el vínculo ya confirmados, y cada
    # reintento del usuario creaba otro (7 copias del mismo viaje el 23/09).
    async with pool.acquire() as conn:
        async with conn.transaction():
            # La guarda antes de cualquier INSERT: un 409 no deja nada.
            warnings = await enforce_assignment(conn, await _assignment_subjects(conn, body))
            trip_id = await _insert_trip(conn, body, user, valid_statuses)
    await _log_system_note(pool, trip_id, user, "Creó el viaje manualmente")
    trip = await get_trip(trip_id, pool, user)
    trip["warnings"] = warnings
    return trip


@router.post("/bulk")
async def bulk_create_trips(
    body: list[TripCreateBody],
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_CREATE)),
):
    if not body:
        raise HTTPException(422, "Lista vacía")
    if len(body) > 500:
        raise HTTPException(422, "Máximo 500 viajes por carga")

    valid_statuses = await _valid_status_ids(pool)

    # Validar TODAS las filas antes de tocar la base — errores con índice de fila.
    # El cliente también: cada fila con uno fuera del directorio queda marcada, y
    # el id se calcula con el cliente ya resuelto (el mismo que usará el alta).
    errors: list[dict] = []
    seen_ids: dict[str, int] = {}
    preparadas: list[tuple[int, TripCreateBody]] = []  # (nº de fila, fila con cliente resuelto)
    async with pool.acquire() as conn:
        for i, trip in enumerate(body):
            try:
                _validate_create_body(trip, valid_statuses)
                preparadas.append((i + 1, await _preparar_cliente(conn, trip)))
            except HTTPException as e:
                errors.append({"row": i + 1, "error": str(e.detail)})
        # La guarda, para todo el lote y antes de abrir la transacción. Dos
        # consultas en total, no dos por fila (Review Focus 4 de D1).
        con_vinculo = [(fila, s) for fila, trip in preparadas
                       if (s := await _assignment_subjects(conn, trip)) is not None]
        checks = await check_assignments(conn, [s for _, s in con_vinculo])
    for fila, trip in preparadas:
        tid = _manual_trip_id(trip)
        if tid in seen_ids:
            errors.append({
                "row": fila,
                "error": f"Duplicado dentro del archivo (misma fila que la #{seen_ids[tid]})",
            })
        else:
            seen_ids[tid] = fila
    if errors:
        raise HTTPException(422, {"message": "Filas con errores — no se importó nada", "errors": errors})
    bloqueadas = [{"row": fila, "code": c.blocking["code"], "error": c.blocking["message"]}
                  for (fila, _), c in zip(con_vinculo, checks) if c.blocking]
    if bloqueadas:
        n = len(bloqueadas)
        # `errors` con la forma que TripBulkUpload ya lee (C-R10).
        raise HTTPException(409, {
            "code": bloqueadas[0]["code"],
            "message": f"No se importó nada: {n} fila{'s' if n != 1 else ''} asigna{'n' if n != 1 else ''} "
                       "flota que no puede operar",
            "errors": bloqueadas,
        })
    warnings = [{"row": fila, **w} for (fila, _), c in zip(con_vinculo, checks) for w in c.warnings]

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
    return {"created": len(ids), "ids": ids, "errors": [], "warnings": warnings}


@router.post("/assign-driver")
async def assign_driver_bulk(
    body: AsignarConductorBody,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
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
    await exigir_vigentes(pool, body.trip_ids)

    async with pool.acquire() as conn:
        async with conn.transaction():
            # La empresa del conductor, no la que el vínculo ya traía (C-R6).
            warnings = await enforce_assignment(conn, AssignmentSubjects(driver_id=body.driver_id))
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

    return {"asignados": len(filas), "warnings": warnings}


@router.get("/driver-candidates")
async def driver_candidates(
    nombre: str = Query("", description="Nombre tal como lo reporta el TMS"),
    limit: int = Query(5, ge=1, le=25),
    pool=Depends(get_pool),
    _=Depends(require(Permission.OPERATIONS_READ)),
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
               c.operational_status AS carrier_operational_status,
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
        LEFT JOIN public.carriers c ON c.id = app.carrier_of('DRIVER', d.id)
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
                "carrier_operational_status": r["carrier_operational_status"],
                "contiene": r["contiene"],
                "similitud": float(r["similitud"] or 0),
            }
            for r in rows
        ],
        "trip_ids_de_la_persona": [str(v["id"]) for v in viajes],
    }


@router.get("/conteo-activos")
async def conteo_de_viajes_activos(
    entity_type: str = Query(..., pattern="^(DRIVER|ASSET)$"),
    entity_id: str = Query(...),
    pool=Depends(get_pool),
    _=Depends(require(Permission.OPERATIONS_READ)),
):
    """Cuántos viajes activos tiene hoy este conductor o este vehículo.

    Existe para UNA pregunta, y se pide sólo cuando se va a hacer daño: antes
    de desvincular a alguien de su empresa. Un conductor sin empresa
    **desaparece del cierre del día** —el roster de Tractoreo se arma desde
    `driver_assignments`— así que sacarle la empresa a alguien que está
    manejando lo vuelve invisible sin que nada avise.

    No es hipotético. El 25/08, durante la propia revisión de la app, se
    desvinculó a un conductor con **70 viajes en 60 días**; al 27/08 hay 8
    conductores en esa situación, con 278 viajes entre todos. La app dejaba
    crear el problema y no ofrecía cómo deshacerlo.

    Endpoint propio y no una columna más en `/compliance-records/summary`: esa
    consulta la pide la ficha entera al abrirse, y este dato sólo lo necesita
    un diálogo de confirmación. Cobrarle a todos por lo que usa uno es cómo se
    pone lenta una pantalla.

    Va declarado ANTES de `/{trip_id}`: FastAPI resuelve por orden, y después
    del path param genérico un GET acá entraría como `trip_id="conteo-activos"`
    — mismo gotcha que documenta PATCH /bulk-close.
    """
    if entity_type == "DRIVER":
        condicion = "vfr.resolved_driver_id = $1::uuid"
    else:
        # La vista resuelve el TRACTO, no la rampla: `v_trip_fleet_resolution`
        # no tiene `resolved_trailer_asset_id` (verificado contra la base). Para
        # una rampla este conteo da 0, y eso es correcto: hoy nada la vincula a
        # un viaje activo por esta cadena.
        condicion = "vfr.resolved_tractor_asset_id = $1::uuid"

    fila = await pool.fetchrow(
        f"""
        SELECT count(*) AS activos,
               max(t.planning_date) AS ultimo
        FROM app.trips t
        JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
        WHERE t.is_active AND t.voided_at IS NULL AND {condicion}
        """,
        entity_id,
    )
    return {"activos": fila["activos"], "ultimo": fila["ultimo"]}


@router.get("/cierre-viajes")
async def cierre_viajes(
    fecha: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(require(Permission.OPERATIONS_READ)),
):
    """Los cuatro grupos del paso "Viajes" del Cierre.

    Sólo `hoy` y `rezago` bloquean el cierre: son cargas que nos ofrecieron y
    todavía no contestamos. `en_curso` y `abandonado` se muestran para que no
    desaparezcan de la vista —regla 5 de Pablo, "si no me cerraron el viaje no
    me lo van a pagar"— pero no impiden firmar el día. Tampoco
    `pendiente_cierre_tms` (ítem 6): ya están asignados; falta el cierre del TMS.
    `incomplete_assignment` (minuta 09/10 §2.4) bloquea solo si es del día.

    Declarado ANTES de GET /{trip_id} — FastAPI matchea rutas en el orden en
    que se registran, así que el literal "/cierre-viajes" debe ir antes del
    path param genérico o quedaría absorbido como trip_id="cierre-viajes"
    (mismo gotcha que documenta PATCH /bulk-close)."""
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    filas = await pool.fetch(
        f"""
        WITH g AS (({SQL_GRUPOS_CIERRE}) UNION ALL ({SQL_CON_MOTIVO}))
        SELECT g.*, ur.label AS unassigned_reason_label, {scope_sql('sc')} AS scope
        FROM g
        LEFT JOIN app.status_taxonomies ur ON ur.id = g.unassigned_reason_id
        {tractor_scope_join('g.tractor_asset_id', 'sc')}
        ORDER BY g.grupo, g.planning_date DESC
        """,
        day,
    )

    # Origen y destinos con la misma lectura de paradas que el Monitor
    # (_load_trip_stops colapsa los duplicados por posición): HU-D2.
    paradas = await _load_trip_stops(pool, {str(r["trip_id"]) for r in filas})
    # La zona de su último destino (RM, Z0, Región…), la misma del Reporte.
    zonas = await trip_zones(pool, [str(r["trip_id"]) for r in filas])

    grupos: dict[str, list] = {
        "hoy": [], "rezago": [], "en_curso": [], "abandonado": [], "con_motivo": [],
        "oferta_sin_declarar": [], "pendiente_cierre_tms": [], "incomplete_assignment": [],
    }
    for r in filas:
        stops = paradas.get(str(r["trip_id"]), [])
        origen = next((p["local"] for p in stops if p.get("stop_type") == "ORIGIN"), None)
        grupos[r["grupo"]].append({
            "trip_id": str(r["trip_id"]),
            "planning_date": r["planning_date"].isoformat() if r["planning_date"] else None,
            "client_name": r["client_name"],
            "source_system": r["source_system"],
            "source_system_trip_id": r["source_system_trip_id"],
            "trip_status": r["trip_status"],
            "tractor_plate": r["tractor_plate"],
            "driver_name": r["driver_name"],
            "carrier_name": r["carrier_name"],
            "origin": origen,
            "destinations": [p["local"] for p in stops if p.get("stop_type") == "DESTINATION" and p.get("local")],
            "destination_zone": zonas.get(str(r["trip_id"])),
            "dias_sin_novedad": float(r["dias_sin_novedad"] or 0),
            "unassigned_reason_id": str(r["unassigned_reason_id"]) if r["unassigned_reason_id"] else None,
            "unassigned_reason_label": r["unassigned_reason_label"],
            "missing_fleet": list(r["missing_fleet"] or []),
            "carrier_id": r["carrier_id"],
            "driver_id": r["driver_id"],
            "tractor_asset_id": r["tractor_asset_id"],
            # El alcance del Cierre (D6): el del tracto resuelto; sin tracto, None (los dos).
            "scope": r["scope"],
        })

    # Una asignación incompleta bloquea solo si es del día (decisión del 11/10).
    incompletas_del_dia = sum(1 for v in grupos["incomplete_assignment"] if v["planning_date"] == day.isoformat())
    return {
        "grupos": grupos,
        "bloquean": len(grupos["hoy"]) + len(grupos["rezago"]) + incompletas_del_dia,
        # La misma marca que daily-closure y equipment-closures (bloque 0, 0.6):
        # mientras el día tiene un recálculo pendiente, la pantalla relee cada 15 s.
        **await frescura_del_dia(pool, day),
    }


@router.get("/{trip_id}")
async def get_trip(
    trip_id: str,
    pool=Depends(get_pool),
    user=Depends(require(Permission.OPERATIONS_READ)),
):
    row = await pool.fetchrow(
        f"SELECT {_TRIP_SELECT} {_TRIP_FROM} WHERE t.id = $1",
        trip_id,
    )
    if not row:
        raise HTTPException(404, "Viaje no encontrado")
    d = dict(row)
    await _attach_carrier_can_operate(pool, [d])
    stops_by_trip = await _load_trip_stops(pool, {trip_id})
    d["stops"] = stops_by_trip.get(trip_id, [])
    d["cargo_delivered"] = _cargo_delivered(d["stops"])
    temp_ranges = await _load_temperature_ranges(pool)
    d["temp_status"] = _trip_temp_status(d["stops"], d.get("cargo_type"), d["cargo_delivered"], temp_ranges)
    _annotate_stop_temp_status(d["stops"], d.get("cargo_type"), temp_ranges)
    _attach_origin(d)
    shipper_ids = {str(d["shipper_id"])} if d.get("shipper_id") else set()
    op_type_buckets = await load_operation_type_buckets(pool, shipper_ids)
    _apply_operation_types(d, op_type_buckets)
    # Abrir un viaje no escribe nada: la Divergencia TMS la anota la base cuando
    # llega el dato del TMS (app.log_tms_divergence, migración 20261016090000).
    anotar_anulable(d, user)
    return d


@router.post("/void")
async def void_trips(body: TripVoidBody, pool=Depends(get_pool), user=Depends(require(Permission.TRIPS_VOID))):
    """Anula viajes manuales con motivo, todo o nada. El permiso fino (creador,
    trips.void_any o closures.sign si su día está firmado) se decide por viaje en
    services/anular_viajes.py. Declarado antes de las rutas /{trip_id}."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            n = await anular_viajes(conn, [str(t) for t in body.trip_ids], str(body.reason_id), body.note, user)
    return {"ok": True, "voided": n}


@router.post("/void/revert")
async def revert_void_trips(
    body: TripVoidRevertBody, pool=Depends(get_pool), user=Depends(require(Permission.TRIPS_VOID)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            n = await revertir_anulacion(conn, [str(t) for t in body.trip_ids], user)
    return {"ok": True, "reverted": n}


@router.patch("/bulk-close")
async def bulk_close_trips(
    body: TripBulkCloseBody, pool=Depends(get_pool), user=Depends(require(Permission.CLOSURES_DECLARE)),
):
    """Selección masiva en el Diario (TripTable) para cerrar/finalizar
    varios viajes de una — mismo mecanismo que ya usa IndicatorSwitches por
    viaje individual (is_active/is_working=false), solo que en lote.
    Declarado ANTES de PATCH /{trip_id} — FastAPI matchea rutas en el orden
    en que se registran, así que un literal "/bulk-close" debe ir antes del
    path param genérico o quedaría absorbido como trip_id="bulk-close"."""
    if not body.trip_ids:
        raise HTTPException(422, "trip_ids no puede estar vacío")
    await exigir_vigentes(pool, body.trip_ids)
    if not body.unassigned_reason_id:
        raise HTTPException(422, "Indica el motivo por el que no se tomó la carga")

    rows = await pool.fetch(
        "SELECT id, manually_edited_fields, is_active, is_working "
        "FROM app.trips WHERE id = ANY($1::uuid[])",
        body.trip_ids,
    )
    found_ids = {str(r["id"]) for r in rows}
    missing = [tid for tid in body.trip_ids if tid not in found_ids]
    if missing:
        raise HTTPException(404, f"Viaje(s) no encontrado(s): {missing}")

    # Importante 3 + 6 (revision de rama, 2026-08-18): app.trips.unassigned_reason_id
    # tiene DOS escritores con catalogos distintos — GestionPanel.tsx (vivo)
    # escribe ids de DRIVER_REASON, bulk-close escribe ids de
    # TRIP_UNASSIGNED_REASON. La FK no restringe el dominio y nadie lo
    # validaba: un id de DRIVER_REASON pasaba derecho y ensuciaba el filtro
    # "No asignado por WebCarga" con motivos como "Vacaciones". Una sola
    # consulta valida existencia Y dominio a la vez — si el id no existe O es
    # de otro dominio, `motivo_row` viene None y se corta ANTES de escribir
    # nada (antes: `fetchval` devolvia None en silencio, la nota y el
    # audit_log quedaban con "None", y recien el UPDATE fallaba por FK con
    # un 500 en vez de un 422 de negocio).
    motivo_row = await pool.fetchrow(
        "SELECT label FROM app.status_taxonomies "
        "WHERE id = $1 AND domain = 'TRIP_UNASSIGNED_REASON'",
        body.unassigned_reason_id,
    )
    if motivo_row is None:
        raise HTTPException(
            422,
            "Motivo inválido: no existe o no pertenece al catálogo de no asignación por WebCarga",
        )
    motivo = motivo_row["label"]

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
            for r in rows:
                tid = str(r["id"])
                await log_change(
                    conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                    action="no_asignado_por_webcarga", field="unassigned_reason_id",
                    old_value=None, new_value=motivo, source="cierre_viajes",
                )
                # Lo que el viaje era antes de apagarlo: "Deshacer" (HU-D3)
                # lo devuelve a esto en vez de adivinar con la fórmula de dbt.
                await log_change(
                    conn, actor=user["sub"], entity_type="TRIP", entity_id=tid,
                    action="no_asignado_por_webcarga", field="is_active",
                    old_value={"is_active": r["is_active"], "is_working": r["is_working"]},
                    new_value={"is_active": False, "is_working": False},
                    source="cierre_viajes",
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


@router.patch("/bulk-reopen")
async def bulk_reopen_trips(
    body: TripBulkReopenBody, pool=Depends(get_pool), user=Depends(require(Permission.CLOSURES_DECLARE)),
):
    """Deshace "No asignado por WebCarga" (HU-D3). El viaje vuelve a lo que
    era antes de apagarlo —leído de la traza que deja bulk-close— y a su grupo
    del cierre. Sin traza (viajes cerrados antes del 06/10) vuelve activo:
    si el TMS ya no lo reporta, la corrida siguiente de dbt lo apaga sola,
    porque se le quitan las marcas manuales.

    Nunca sobre un día firmado: sin motivo, el viaje volvería a contar en ese
    día y le cambiaría las cifras sin reabrirlo (misma regla que eliminar).
    Declarado ANTES de PATCH /{trip_id}, mismo motivo que /bulk-close."""
    if not body.trip_ids:
        raise HTTPException(422, "trip_ids no puede estar vacío")
    await exigir_vigentes(pool, body.trip_ids)
    ids = list(dict.fromkeys(body.trip_ids))

    async with pool.acquire() as conn:
        async with conn.transaction():
            filas = await conn.fetch(
                """
                SELECT t.id, t.unassigned_reason_id,
                       (SELECT a.old_value FROM public.audit_log a
                         WHERE a.entity_type = 'TRIP' AND a.entity_id = t.id
                           AND a.action = 'no_asignado_por_webcarga' AND a.field = 'is_active'
                         ORDER BY a.occurred_at DESC LIMIT 1) AS antes
                FROM app.trips t
                WHERE t.id = ANY($1::uuid[])
                FOR UPDATE OF t
                """,
                ids,
            )
            encontrados = {str(f["id"]) for f in filas}
            faltan = [i for i in ids if i not in encontrados]
            if faltan:
                raise HTTPException(404, f"Viaje(s) no encontrado(s): {faltan}")

            for f in filas:
                antes = json.loads(f["antes"]) if isinstance(f["antes"], str) else f["antes"]
                activo = bool(antes.get("is_active", True)) if antes else True
                trabajando = bool(antes.get("is_working")) if antes else False
                # Dos sentencias a propósito: el trigger app.protect_manual_overrides
                # devuelve is_active/is_working a su valor anterior mientras
                # OLD.manually_edited_fields los marque como manuales. Primero se
                # sueltan las marcas; recién entonces se pueden restaurar.
                await conn.execute(
                    """
                    UPDATE app.trips
                    SET unassigned_reason_id = NULL,
                        manually_edited_fields = array_remove(array_remove(array_remove(
                            COALESCE(manually_edited_fields, '{}'),
                            'is_active'), 'is_working'), 'unassigned_reason_id'),
                        edited_by = $2::uuid, edited_at = NOW(), updated_at = NOW()
                    WHERE id = $1
                    """,
                    f["id"], user["sub"],
                )
                await conn.execute(
                    "UPDATE app.trips SET is_active = $2, is_working = $3 WHERE id = $1",
                    f["id"], activo, trabajando,
                )
                await log_change(
                    conn, actor=user["sub"], entity_type="TRIP", entity_id=str(f["id"]),
                    action="deshacer_no_asignado", field="unassigned_reason_id",
                    old_value=str(f["unassigned_reason_id"]) if f["unassigned_reason_id"] else None,
                    new_value=None, source="cierre_viajes",
                )

            # El día firmado se mira DESPUÉS de deshacer y en la misma
            # transacción: app.trips_del_dia excluye los viajes con motivo, así
            # que antes de quitarlo ningún día "lo contaba". Bloquea sólo un día
            # firmado DESPUÉS de la declaración: ése se firmó sin el viaje, y
            # devolverlo le cambiaría las cifras. Si el día se firmó ANTES
            # (con el viaje adentro), deshacer devuelve el día a lo que se firmó
            # — caso real del 06/10: un rezago planificado el 02/10, día ya
            # firmado, no se podía deshacer. Sin traza de la declaración no hay
            # cómo saberlo, y se bloquea.
            firmados = await conn.fetch(
                f"""
                SELECT DISTINCT cp.business_date
                FROM app.trips t
                JOIN app.closure_periods cp
                  ON cp.status = 'CLOSED'
                 AND cp.business_date BETWEEN t.planning_date AND t.planning_date + 45
                {ultima_firma('cp.business_date', 'firma')}
                LEFT JOIN LATERAL (
                    SELECT max(a.occurred_at) AS declarado_at
                    FROM public.audit_log a
                    WHERE a.entity_type = 'TRIP' AND a.entity_id = t.id
                      AND a.action = 'no_asignado_por_webcarga'
                      AND a.field = 'unassigned_reason_id'
                ) decl ON true
                WHERE t.id = ANY($1::uuid[])
                  AND t.id IN (SELECT trip_id FROM app.trips_del_dia(cp.business_date))
                  AND (decl.declarado_at IS NULL OR firma.signed_at >= decl.declarado_at)
                ORDER BY 1
                """,
                ids,
            )
            if firmados:
                raise HTTPException(
                    409,
                    "No se puede deshacer: el viaje contaría en un día ya firmado ("
                    + ", ".join(f["business_date"].strftime("%d/%m") for f in firmados)
                    + "). Reabre el día primero.",
                )

    for tid in ids:
        await _log_system_note(pool, tid, user, "Se deshizo \"No asignado por WebCarga\"")
    return {"ok": True, "reopened": len(ids)}


async def _patch_plate_subjects(conn, data: dict) -> AssignmentSubjects | None:
    """Los equipos de las patentes que trae el PATCH, para la guarda. Misma
    búsqueda que _activo_de_la_patente (patente canónica); una patente vacía
    limpia el campo y una fuera del directorio no apunta a ningún equipo: ninguna
    de las dos tiene qué evaluar. `conn.fetch` y no `fetchval`, como la guarda."""
    plates = [p.strip() for p in (data.get("tractor_plate"), data.get("trailer_plate")) if p and p.strip()]
    if not plates:
        return None
    filas = await conn.fetch(
        "SELECT id::text FROM public.assets "
        "WHERE license_plate IN (SELECT public.canonical_plate(p) FROM unnest($1::text[]) AS p)",
        plates,
    )
    return AssignmentSubjects(asset_ids=tuple(f["id"] for f in filas), check_carrier=False)


@router.patch("/{trip_id}")
async def patch_trip(
    trip_id: str,
    body: TripPatch,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_EDIT_BASIC)),
):
    # Un anulado es de solo lectura (services/anular_viajes.py).
    await exigir_vigentes(pool, [trip_id])
    source_system = await pool.fetchval("SELECT source_system FROM app.trips WHERE id = $1", trip_id)
    if source_system is None:
        raise HTTPException(404, "Viaje no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    # Antes de cualquier escritura, y antes de los `pop` de más abajo: acá
    # `data` todavía tiene los nombres tal como los mandó el cliente. El guardia
    # de la ruta da o niega la ruta entera; este cuerpo mezcla el teléfono
    # (básico) con la patente (sensible), así que el permiso es por campo, y un
    # campo sin permiso invalida el cuerpo completo.
    require_fields(user, data, TRIP_FIELD_PERMISSIONS)

    # EN UN VIAJE DEL TMS, ACTIVO Y TRABAJANDO LOS DEFINE EL TMS (09/10).
    #
    # El 2065805 llegó CERRADO FINALIZADO por SAP y alguien encendió Activo y
    # Trabajando desde el detalle: el trigger protect_manual_overrides retira
    # la marca de un viaje cerrado pero conserva el valor, y dbt no lo volvió
    # a procesar, así que el Cierre lo mostraba "En curso". Decisión del
    # usuario: "todo depende de la tms, uno no hace esos cambios cuando viene
    # de una tms". En un viaje manual la persona sí manda. Declarar "No
    # asignado por WebCarga" (bulk-close) y deshacerlo no pasan por acá.
    if source_system != "manual":
        del_tms = sorted(k for k in ("is_active", "is_working") if k in data)
        if del_tms:
            raise HTTPException(
                422, "Activo y Trabajando los define el TMS en este viaje: "
                     f"no se pueden cambiar a mano ({', '.join(del_tms)})",
            )

    # EL MOTIVO DE UN VIAJE ES DEL CATALOGO DEL VIAJE.
    #
    # `app.trips.unassigned_reason_id` tuvo dos escritores con catalogos
    # distintos: bulk-close validaba el dominio desde el 2026-08-18 y este
    # PATCH no, asi que el detalle del viaje en el Monitor escribia ids de
    # DRIVER_REASON —"Vacaciones", "Panne"— sobre un campo que significa "por
    # que WebCarga no tomo este viaje". Pedido del usuario (07/09): que se
    # sincronice con el motivo de no asignacion DEL VIAJE.
    #
    # Se valida aca y no en el schema porque hace falta la base: el dominio
    # vive en app.status_taxonomies. Medido antes de arreglarlo: 0 viajes
    # tenian motivo escrito, asi que no hubo dato sucio que limpiar.
    if data.get("unassigned_reason_id"):
        del_dominio = await pool.fetchval(
            "SELECT 1 FROM app.status_taxonomies "
            "WHERE id = $1 AND domain = 'TRIP_UNASSIGNED_REASON'",
            data["unassigned_reason_id"],
        )
        if not del_dominio:
            raise HTTPException(
                422,
                "Motivo inválido: no existe o no pertenece al catálogo de no asignación del viaje",
            )

    # Todo o nada (spec 2026-10-11): el vínculo, los campos del viaje y la copia a
    # trips_manual van en una transacción. La nota de bitácora va después, como
    # en create_trip: es best-effort y adentro dejaría la transacción abortada.
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_trip_for_update(conn, trip_id)

            # Una patente nueva apunta a un equipo: si está dado de baja, no se
            # vincula (D1 §7.1, Ruling F4). Antes de cualquier escritura del
            # vínculo. El conductor de este PATCH es texto libre (driver_name_raw),
            # sin id que evaluar, y la empresa del vínculo no cambia: solo el equipo.
            warnings = await enforce_assignment(conn, await _patch_plate_subjects(conn, data))

            # driver_name goes to trip_fleet_links.driver_name_raw (not app.trips)
            if "driver_name" in data:
                new_name = data.pop("driver_name")
                link_id = await conn.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
                if link_id:
                    await conn.execute(
                        "UPDATE app.trip_fleet_links SET driver_name_raw = $1, updated_at = NOW() WHERE id = $2",
                        new_name, link_id,
                    )
                else:
                    new_link_id = await conn.fetchval(
                        """INSERT INTO app.trip_fleet_links
                           (trip_id, driver_name_raw, link_source, created_by)
                           VALUES ($1, $2, 'manual', $3) RETURNING id""",
                        trip_id, new_name, user["sub"],
                    )
                    await conn.execute(
                        "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
                        new_link_id, trip_id,
                    )

            # driver_phone goes to trip_fleet_links
            if "driver_phone" in data:
                new_phone = data.pop("driver_phone")
                link_id = await conn.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
                if link_id:
                    await conn.execute(
                        "UPDATE app.trip_fleet_links SET driver_phone = $1, updated_at = NOW() WHERE id = $2",
                        new_phone, link_id,
                    )
                else:
                    new_link_id = await conn.fetchval(
                        """INSERT INTO app.trip_fleet_links
                           (trip_id, driver_phone, link_source, created_by)
                           VALUES ($1, $2, 'manual', $3) RETURNING id""",
                        trip_id, new_phone, user["sub"],
                    )
                    await conn.execute(
                        "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
                        new_link_id, trip_id,
                    )

            # tractor_plate / trailer_plate go to trip_fleet_links
            plate_updates = {k: data.pop(k) for k in ("tractor_plate", "trailer_plate") if k in data}
            if plate_updates:
                link_id = await conn.fetchval("SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
                if link_id:
                    for col, val in plate_updates.items():
                        await conn.execute(
                            f"UPDATE app.trip_fleet_links SET {col} = $1, updated_at = NOW() WHERE id = $2",
                            val, link_id,
                        )
                else:
                    cols = ", ".join(plate_updates.keys())
                    phs  = ", ".join(f"${i + 2}" for i in range(len(plate_updates)))
                    new_link_id = await conn.fetchval(
                        f"""INSERT INTO app.trip_fleet_links
                           (trip_id, {cols}, link_source, created_by)
                           VALUES ($1, {phs}, 'manual', ${len(plate_updates) + 2}) RETURNING id""",
                        trip_id, *plate_updates.values(), user["sub"],
                    )
                    await conn.execute(
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

                await conn.execute(
                    f"UPDATE app.trips SET {', '.join(sets)} WHERE id = $1",
                    *vals,
                )

            await _mirror_manual_trip(conn, trip_id)

    if "manual_status" in data:
        await _log_system_note(
            pool, trip_id, user,
            f"Estableció estado operativo manual: {data['manual_status']}",
        )

    trip = await get_trip(trip_id, pool, user)
    trip["warnings"] = warnings
    return trip


@router.patch("/{trip_id}/stops/{stop_id}")
async def patch_trip_stop(
    # Los cuatro campos de la parada son los que el equipo completa al operar
    # (trips.edit_basic). Ver STOP_FIELD_PERMISSIONS.
    trip_id: str,
    stop_id: str,
    body: TripStopPatch,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_EDIT_BASIC)),
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
    # Un anulado es de solo lectura (services/anular_viajes.py).
    await exigir_vigentes(pool, [trip_id])
    exists = await pool.fetchval("SELECT stop_id FROM app.trip_stops WHERE stop_id = $1 AND trip_id = $2", stop_id, trip_id)
    if not exists:
        raise HTTPException(404, "Parada no encontrada")

    patch = body.model_dump(exclude_none=True)
    require_fields(user, patch, STOP_FIELD_PERMISSIONS)
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
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
):
    """Create or replace a manual fleet link for a trip."""
    # Un anulado es de solo lectura (services/anular_viajes.py).
    await exigir_vigentes(pool, [trip_id])
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

    # El vínculo y la copia a trips_manual, en una transacción (spec 2026-10-11).
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_trip_for_update(conn, trip_id)
            tractor_asset_id, tractor_plate = await _activo_de_la_patente(
                conn, body.get("tractor_plate"), body.get("tractor_asset_id"))
            trailer_asset_id, trailer_plate = await _activo_de_la_patente(
                conn, body.get("trailer_plate"), body.get("trailer_asset_id"))
            warnings = await enforce_assignment(conn, AssignmentSubjects(
                carrier_id=carrier_id, driver_id=driver_id,
                asset_ids=tuple(a for a in (tractor_asset_id, trailer_asset_id) if a)))
            await _escribir_link_manual(
                conn, trip_id, user=user,
                carrier_id=carrier_id, driver_id=driver_id,
                tractor_asset_id=tractor_asset_id, tractor_plate=tractor_plate,
                trailer_asset_id=trailer_asset_id, trailer_plate=trailer_plate,
                driver_name=body.get("driver_name"),
            )
            await _mirror_manual_trip(conn, trip_id)

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
    trip = await get_trip(trip_id, pool, user)
    trip["warnings"] = warnings
    return trip


@router.delete("/{trip_id}/fleet-link")
async def remove_fleet_link(
    trip_id: str,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
):
    # Un anulado es de solo lectura (services/anular_viajes.py).
    await exigir_vigentes(pool, [trip_id])
    """Remove the manual fleet link from a trip."""
    # FIX 2026-07-18: mismo motivo que assign_fleet_link — buscar por trip_id,
    # no por trips.fleet_link_id (huérfano tras cualquier --full-refresh).
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_trip_for_update(conn, trip_id)
            link_id = await conn.fetchval(
                "SELECT id FROM app.trip_fleet_links WHERE trip_id = $1", trip_id
            )
            if link_id:
                await conn.execute("DELETE FROM app.trip_fleet_links WHERE id = $1", link_id)
                await conn.execute(
                    "UPDATE app.trips SET fleet_link_id = NULL, updated_at = NOW() WHERE id = $1",
                    trip_id,
                )
                await _mirror_manual_trip(conn, trip_id)
    if link_id:
        await _log_system_note(pool, trip_id, user, "Desvinculó la empresa transportista")
    return {"ok": True}


@router.delete("/{trip_id}/overrides/{field}")
async def reset_field(
    trip_id: str,
    field: str,
    pool=Depends(get_pool),
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
):
    VALID = {"manual_status", "notes", "comments",
             "is_active", "is_working", "is_assigned", "is_first_leg"}
    if field not in VALID:
        raise HTTPException(422, f"Campo no restaurable: {field}")
    # Un anulado es de solo lectura (services/anular_viajes.py).
    await exigir_vigentes(pool, [trip_id])
    async with pool.acquire() as conn:
        async with conn.transaction():
            await _lock_trip_for_update(conn, trip_id)
            await conn.execute(
                """
                UPDATE app.trips
                SET manually_edited_fields = array_remove(manually_edited_fields, $2),
                    updated_at = NOW()
                WHERE id = $1
                """,
                trip_id, field,
            )
            # Sin el override, "asignado" vuelve a la regla en el acto, no en la
            # corrida siguiente de dbt (spec 2026-10-11). "Activo" de un viaje del
            # TMS depende además de la recencia, que solo conoce dbt.
            if field == "is_assigned":
                await conn.execute(
                    "UPDATE app.trips SET is_assigned = app.is_trip_assigned(trip_status, fleet, id) "
                    "WHERE id = $1",
                    trip_id,
                )
            await _mirror_manual_trip(conn, trip_id)
    if field == "manual_status":
        await _log_system_note(
            pool, trip_id, user, "Revirtió el estado manual al valor del TMS"
        )
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
    _=Depends(require(Permission.OPERATIONS_READ)),
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
    # `writer` escribe acá: la bitácora ES el campo "observaciones" que su rol
    # promete — el `notes` de TripPatch es texto legacy y la UI no lo usa.
    # Fijar (pin) y resolver quedan en editor a propósito: cambian cómo el
    # resto lee esa nota, no la observación en sí.
    trip_id: str,
    body: str = Form(""),
    note_type: str = Form("observacion"),
    files: list[UploadFile] = File(default=[]),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require(Permission.TRIPS_EDIT_BASIC)),
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
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
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
    user=Depends(require(Permission.TRIPS_EDIT_SENSITIVE)),
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
