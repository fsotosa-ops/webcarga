import hashlib
import json
import re
import unicodedata
from datetime import date as _date
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4
from zoneinfo import ZoneInfo
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.trip import TripPatch, TripStopPatch


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
    "on_time_status, milestone_status, s2s, temperature, planning_date, "
    "arrival_date, departure_date, departure_date_prog, gps_arrival_date, "
    "gps_departure_date, unload_start, unload_end, desc_inicio_manual, desc_fin_manual"
)


async def _load_trip_stops(pool, trip_ids: set[str]) -> dict[str, list[dict]]:
    """Carga app.trip_stops en batch (Fase 2 del hardening H2.6 — reemplaza
    el jsonb app.trips.stops + el parche stop_manual_fields). Resuelve
    unload_start/unload_end contra el override manual (desc_inicio_manual/
    desc_fin_manual, columnas reales — antes jsonb keyed por stop_id) al
    mismo tiempo que arma la lista, sin N+1."""
    if not trip_ids:
        return {}
    rows = await pool.fetch(
        f"SELECT {_TRIP_STOP_FIELDS} FROM app.trip_stops "
        "WHERE trip_id = ANY($1::uuid[]) ORDER BY trip_id, stop_order",
        list(trip_ids),
    )
    stops_by_trip: dict[str, list[dict]] = {}
    for r in rows:
        d = dict(r)
        trip_id = str(d.pop("trip_id"))
        d.pop("stop_order")
        desc_inicio_manual = d.pop("desc_inicio_manual")
        desc_fin_manual = d.pop("desc_fin_manual")
        if desc_inicio_manual is not None:
            d["unload_start"] = desc_inicio_manual
        if desc_fin_manual is not None:
            d["unload_end"] = desc_fin_manual
        d["desc_manual"] = desc_inicio_manual is not None or desc_fin_manual is not None
        stops_by_trip.setdefault(trip_id, []).append(d)
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
    COALESCE(ta.license_plate, ta_auto.license_plate, fl.tractor_plate,
             t.fleet->>'tractor_plate')           AS tractor_plate,
    -- Valor crudo del TMS, sin resolver contra el vínculo manual — permite
    -- detectar divergencia cuando ops vinculó a mano y el TMS reporta otro
    -- dato después (reconciliación TMS↔manual, Fase 1.5b).
    t.fleet->>'tractor_plate'                     AS tractor_plate_tms,
    COALESCE(tr.license_plate, fl.trailer_plate,
             t.fleet->>'trailer_plate')           AS trailer_plate,
    COALESCE(d.full_name, d_auto.full_name, fl.driver_name_raw,
             t.fleet->>'driver_name_tms')         AS driver_name,
    t.fleet->>'driver_name_tms'                   AS driver_name_tms,
    COALESCE(d.tax_id, d_auto.tax_id, t.fleet->>'driver_rut_tms') AS driver_tax_id,
    COALESCE(fl.driver_phone,
             t.fleet->>'driver_phone')            AS driver_phone,
    t.origin_tms,
    COALESCE(c.business_name, c_auto.business_name) AS carrier_name,
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
    COALESCE(fl.carrier_id, c_auto.id)             AS carrier_id,
    COALESCE(fl.driver_id, d_auto.id)              AS driver_id,
    COALESCE(fl.tractor_asset_id, ta_auto.id)      AS tractor_asset_id,
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
    ins.insurance_alert
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
      WHEN COALESCE(fl.carrier_id, c_auto.id) IS NULL
           AND (t.fleet->>'tractor_plate' IS NOT NULL OR fl.tractor_plate IS NOT NULL
                OR t.fleet->>'driver_name_tms' IS NOT NULL OR fl.driver_name_raw IS NOT NULL)
        THEN 'UNMATCHED'
      WHEN da_home.carrier_id IS NOT NULL
           AND da_home.carrier_id IS DISTINCT FROM COALESCE(fl.carrier_id, c_auto.id)
        THEN 'MISMATCH'
      ELSE 'MATCHED'
    END
"""
_TRIP_SELECT = _TRIP_SELECT.format(fleet_match_case=_FLEET_MATCH_CASE)

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
    LEFT JOIN public.carriers c ON c.id = fl.carrier_id
    LEFT JOIN public.drivers d ON d.id = fl.driver_id
    LEFT JOIN public.assets ta ON ta.id = fl.tractor_asset_id
    LEFT JOIN public.assets tr ON tr.id = fl.trailer_asset_id
    -- RESOLUCIÓN EN VIVO (Fase 1, 2026-07-18): la migración 20260718060000
    -- bootstrapeó driver_id/carrier_id/tractor_asset_id vía bronze.raw_bd_ot,
    -- pero esa fuente es un bootstrap histórico de una sola vez (plataforma
    -- legacy a dar de baja, trips_context.md §5.3) — no cubre ningún viaje
    -- que llegue de acá en adelante. Sin este fallback, todo viaje nuevo
    -- quedaría sin trazabilidad hasta que alguien lo vinculara a mano.
    -- Vehículo/empresa: se resuelven solo por patente contra datos que ya
    -- vive en public.* (asset_assignments), sin depender de raw_bd_ot.
    LEFT JOIN public.assets ta_auto
        ON fl.tractor_asset_id IS NULL
       AND upper(trim(ta_auto.license_plate)) =
           upper(trim(COALESCE(NULLIF(t.fleet->>'tractor_plate', ''), t.fleet->>'trailer_plate')))
    LEFT JOIN public.asset_assignments aa_auto
        ON aa_auto.asset_id = ta_auto.id AND aa_auto.status = 'ACTIVE'
    LEFT JOIN public.carriers c_auto ON c_auto.id = aa_auto.carrier_id
    -- Conductor: no hay forma de derivarlo del payload TMS (QAnalytics/
    -- Sodimac nunca reportan RUT ni nombre) — se resuelve vía
    -- vehicle_driver_assignments (migración 20260718070000, "qué conductor
    -- maneja este vehículo hoy"), que operaciones mantiene una vez por
    -- vehículo en vez de viaje por viaje (POST /assets/{id}/driver-assignment).
    LEFT JOIN public.vehicle_driver_assignments vda_auto
        ON vda_auto.asset_id = ta_auto.id AND vda_auto.status = 'ACTIVE'
    LEFT JOIN public.drivers d_auto ON d_auto.id = vda_auto.driver_id
    -- HU-04 (Fase 0): empresa PROPIA del conductor (independiente de la
    -- empresa resuelta para el tracto) — permite detectar "MISMATCH" cuando
    -- conductor y tracto calzan cada uno por su lado pero no bajo la misma
    -- empresa (regla explícita de Pablo: ambos deben estar bajo la misma
    -- empresa de transporte). Ver _FLEET_MATCH_CASE.
    LEFT JOIN public.driver_assignments da_home
        ON da_home.driver_id = COALESCE(fl.driver_id, d_auto.id) AND da_home.status = 'ACTIVE'
    LEFT JOIN public.carriers c_home ON c_home.id = da_home.carrier_id
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
        WHERE cis.carrier_id = COALESCE(fl.carrier_id, c_auto.id)
    ) ins ON true
    -- "Vuelta N" (driver_leg_number, ver _TRIP_SELECT): orden cronológico de
    -- los viajes de un conductor en el día, basado en cuándo salió del
    -- origen — trae solo la fila ORIGIN de trip_stops (a lo sumo 1 por viaje,
    -- ver assert_trip_stops_at_most_one_origin_per_trip, Ronda 21).
    LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
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

# Allow-listed ORDER BY clauses — never build ORDER BY from raw user input.
# status_reported_at_asc: viajes con más tiempo en su estado actual primero
# (la fecha más antigua de reporte = el que lleva más tiempo sin cambiar).
_SORT_OPTIONS = {
    "default":                 "t.planning_date DESC, t.updated_at DESC",
    "status_reported_at_asc":  "t.status_reported_at ASC NULLS LAST",
    "status_reported_at_desc": "t.status_reported_at DESC NULLS LAST",
}


@router.get("")
async def list_trips(
    fecha: str = Query(""),
    view: str = Query("en_curso"),      # en_curso | historial
    q: str = Query(""),
    fecha_desde: str = Query(""),
    fecha_hasta: str = Query(""),
    status: str = Query(""),
    is_active: str = Query(""),
    is_working: str = Query(""),
    is_assigned: str = Query(""),
    second_leg_plus: str = Query(""),
    tms: str = Query(""),
    client: str = Query(""),
    origin_region: str = Query(""),
    origin_city: str = Query(""),
    fleet_match: str = Query(""),  # unmatched | mismatch — HU-04 (Fase 0)
    insurance_alert: str = Query(""),  # EXPIRED | OVERDUE_INSTALLMENTS | EXPIRING_SOON — HU-12 (Fase 2)
    sort: str = Query("default"),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
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
        "OR t.source_system_trip_id ILIKE '%'||$1||'%')"
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
        add("t.client_name ILIKE '%'||?||'%'", client)
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

    where = "WHERE " + " AND ".join(filters)
    offset = (page - 1) * limit
    order_clause = _SORT_OPTIONS.get(sort, _SORT_OPTIONS["default"])

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
    for d in data:
        d["stops"] = stops_by_trip.get(str(d["id"]), [])
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


class TripsMeta(BaseModel):
    statuses:            list[StatusMeta]
    tms_sources:         list[TmsSourceMeta]
    operational_states:  list[OperationalStateMeta]
    alert_thresholds:    list[AlertThresholdMeta]
    csv_columns:         list[CSVColumnDef]
    temperature_ranges:  list[TemperatureRangeMeta]
    unassigned_reasons:  list[UnassignedReasonMeta]
    operation_types:     list[OperationTypeMeta]
    monitor_alert_rules: Optional[MonitorAlertRulesMeta] = None


@router.get("/meta", response_model=TripsMeta)
async def get_trips_meta(pool=Depends(get_pool)):
    status_rows = await pool.fetch(
        "SELECT id, label, bg_color, text_color, group_id AS group "
        "FROM app.trip_statuses WHERE active = true ORDER BY sort_order"
    )
    op_rows = await pool.fetch(
        'SELECT id::text, label, bg_color, text_color, group_id AS "group" '
        "FROM app.operational_states WHERE active = true ORDER BY sort_order"
    )
    # Resiliente al orden de deploy: si la tabla aún no existe (migración
    # pendiente), /meta sigue funcionando y el frontend usa sus defaults
    try:
        alert_rules_row = await pool.fetchrow(
            "SELECT stale_report_hours, dwell_hours, late_arrival_grace_min, unassigned_enabled "
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
        "SELECT id, label FROM app.unassigned_reasons WHERE active = true ORDER BY sort_order"
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
        today_trips AS (
            SELECT
                fl.driver_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.tractor_plate, t.fleet->>'tractor_plate')) AS tractor_plate
            FROM app.trips t
            JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            WHERE t.planning_date = $1
              AND t.source_system != 'sodimac'
              AND fl.driver_id IS NOT NULL
            GROUP BY fl.driver_id
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
    """Mismo diseño que /available-drivers (ver comentario arriba), para
    equipos: parte de public.assets activos de una empresa transportista
    activa (asset_assignments) y cruza contra los viajes del día."""
    day = _parse_date(fecha)
    if day is None:
        raise HTTPException(422, "fecha requerida (YYYY-MM-DD)")

    rows = await pool.fetch(
        """
        WITH active_roster AS (
            SELECT a.id, a.license_plate, a.asset_type, c.business_name AS carrier_name
            FROM public.assets a
            JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
            JOIN public.carriers c ON c.id = aa.carrier_id AND c.operational_status = 'ACTIVE'
            WHERE a.operational_status = 'ACTIVE'
        ),
        today_trips AS (
            SELECT
                fl.tractor_asset_id AS asset_id,
                count(*) AS trips_total,
                count(*) FILTER (
                    WHERE t.trip_status LIKE 'CERRADO%'
                       OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')
                ) AS closed_count,
                max(t.status_reported_at) AS last_report_at,
                max(COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms')) AS driver_name
            FROM app.trips t
            JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
            WHERE t.planning_date = $1
              AND t.source_system != 'sodimac'
              AND fl.tractor_asset_id IS NOT NULL
            GROUP BY fl.tractor_asset_id
        )
        SELECT
            ar.id            AS asset_id,
            ar.license_plate AS tractor_plate,
            ar.asset_type,
            ar.carrier_name,
            COALESCE(tt.trips_total, 0) AS trips_total,
            tt.last_report_at,
            tt.driver_name
        FROM active_roster ar
        LEFT JOIN today_trips tt ON tt.asset_id = ar.id
        WHERE tt.asset_id IS NULL OR tt.trips_total = tt.closed_count
        ORDER BY tt.last_report_at DESC NULLS LAST, ar.license_plate
        """,
        day,
    )
    return [dict(r) for r in rows]


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
    "s2s", "temperature", "arrival_date", "departure_date", "departure_date_prog",
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
    _attach_origin(d)
    client_names = {d["client_name"].strip().lower()} if d.get("client_name") else set()
    op_type_buckets = await _load_operation_type_buckets(pool, client_names)
    _apply_operation_types(d, op_type_buckets)
    await _log_tms_divergence_once(pool, trip_id, user, d)
    return d


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
    """Override manual de Desc. Inicio/Fin de una parada — persiste en
    app.trip_stops.desc_inicio_manual/desc_fin_manual (columnas reales,
    Fase 2 del hardening H2.6), nunca en `stops` (se sobrescribe completo
    en cada corrida del pipeline dbt)."""
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
            desc_inicio_manual = COALESCE($3::timestamptz, desc_inicio_manual),
            desc_fin_manual    = COALESCE($4::timestamptz, desc_fin_manual),
            updated_at         = NOW()
        WHERE stop_id = $1 AND trip_id = $2
        """,
        stop_id, trip_id,
        _parse_timestamptz(patch.get("desc_inicio")), _parse_timestamptz(patch.get("desc_fin")),
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

    carrier_id = body.get("carrier_id")
    if not carrier_id:
        raise HTTPException(422, "carrier_id requerido")

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
        body.get("driver_id"),
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

    carrier_name = await pool.fetchval(
        "SELECT business_name FROM public.carriers WHERE id = $1", carrier_id
    )
    await _log_system_note(
        pool, trip_id, user,
        f"Vinculó empresa transportista: {carrier_name or carrier_id}",
    )

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
