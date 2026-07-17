import hashlib
import json
import re
import unicodedata
from datetime import date as _date
from typing import Optional
from uuid import UUID, uuid4
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


def _apply_stop_manual_fields(d: dict) -> None:
    """Mergea el override manual de Desc. Inicio/Fin (app.trips.stop_manual_fields,
    keyed por stop_id) sobre unload_start/unload_end de cada parada — campo
    híbrido: el pipeline reporta unload_start/unload_end, pero si operaciones
    lo corrigió a mano, ese valor gana. Vive fuera de `stops` (jsonb) porque
    ese campo se sobrescribe completo en cada corrida del pipeline dbt."""
    manual = d.pop("stop_manual_fields", None)
    if isinstance(manual, str):
        manual = json.loads(manual) if manual else {}
    manual = manual or {}
    stops = d.get("stops")
    if not stops or not manual:
        return
    for stop in stops:
        override = manual.get(stop.get("stop_id"))
        if not override:
            stop["desc_manual"] = False
            continue
        if override.get("desc_inicio") is not None:
            stop["unload_start"] = override["desc_inicio"]
        if override.get("desc_fin") is not None:
            stop["unload_end"] = override["desc_fin"]
        stop["desc_manual"] = True


router = APIRouter(prefix="/trips", tags=["trips"])

# SQL fragment that maps actual DB columns to the expected API response shape.
# fleet JSONB holds tractor/driver info; trip_fleet_links holds the resolved
# transporter_profile link.
_TRIP_SELECT = """
    t.id,
    t.source_system,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    t.trip_status                                  AS current_status,
    COALESCE(fl.tractor_plate,
             t.fleet->>'tractor_plate')           AS tractor_plate,
    COALESCE(fl.trailer_plate,
             t.fleet->>'trailer_plate')           AS trailer_plate,
    COALESCE(fl.driver_name_raw,
             t.fleet->>'driver_name_tms')         AS driver_name,
    t.fleet->>'driver_rut_tms'                    AS driver_rut,
    COALESCE(fl.driver_phone,
             t.fleet->>'driver_phone')            AS driver_phone,
    t.origin_tms,
    tp.business_name                              AS transporter,
    t.fleet->>'transporter_name_tms'              AS transporter_tms,
    t.origin,
    t.origin_region,
    t.origin_city,
    t.cag_inicio,
    t.cag_fin,
    t.cargo_type,
    t.stops,
    t.stop_manual_fields,
    t.activo,
    t.trabajando,
    t.asignado,
    t.primera_vuelta,
    t.estado_manual,
    t.observaciones,
    t.comentarios,
    t.manually_edited_fields,
    t.fleet_link_id,
    fl.transporter_id                             AS transporter_profile_id,
    t.edited_at,
    t.updated_at,
    t.created_at,
    COALESCE(p.full_name, p.email)                 AS edited_by,
    t.source_system_trip_id,
    t.milestone_status,
    t.pipeline_updated_at
"""

_TRIP_FROM = """
    FROM app.trips t
    LEFT JOIN app.trip_fleet_links fl ON fl.id = t.fleet_link_id
    LEFT JOIN app.transporter_profiles tp ON tp.id = fl.transporter_id
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
    activo: str = Query(""),
    trabajando: str = Query(""),
    asignado: str = Query(""),
    primera_vuelta: str = Query(""),
    tms: str = Query(""),
    client: str = Query(""),
    origin_region: str = Query(""),
    origin_city: str = Query(""),
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
        "OR tp.business_name ILIKE '%'||$1||'%' "
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
    if activo == "true":
        filters.append("t.activo = true")
    elif activo == "false":
        filters.append("t.activo = false")
    if trabajando == "true":
        filters.append("t.trabajando = true")
    elif trabajando == "false":
        filters.append("t.trabajando = false")
    if asignado == "true":
        filters.append("t.asignado = true")
    elif asignado == "false":
        filters.append("t.asignado = false")
    if primera_vuelta == "true":
        filters.append("t.primera_vuelta = true")
    elif primera_vuelta == "false":
        filters.append("t.primera_vuelta = false")
    if tms:
        tms_list = [t.strip() for t in tms.split(',') if t.strip()]
        add("t.source_system = ANY(?)", tms_list)
    if client:
        add("t.client_name ILIKE '%'||?||'%'", client)
    if origin_region:
        add("t.origin_region = ?", origin_region)
    if origin_city:
        add("t.origin_city = ?", origin_city)

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
    for r in rows:
        d = dict(r)
        if d.get("stops") and isinstance(d["stops"], str):
            d["stops"] = json.loads(d["stops"])
        _apply_stop_manual_fields(d)
        data.append(d)
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
    # override manual (estado_manual) bucketee a su columna en vez de caer a "Otro"
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


class TripsMeta(BaseModel):
    statuses:            list[StatusMeta]
    tms_sources:         list[TmsSourceMeta]
    operational_states:  list[OperationalStateMeta]
    alert_thresholds:    list[AlertThresholdMeta]
    csv_columns:         list[CSVColumnDef]
    temperature_ranges:  list[TemperatureRangeMeta]
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
    return TripsMeta(
        statuses=[StatusMeta(**dict(r)) for r in status_rows],
        tms_sources=[TmsSourceMeta(**t) for t in _TMS_META],
        operational_states=[OperationalStateMeta(**dict(r)) for r in op_rows],
        alert_thresholds=[AlertThresholdMeta(**dict(r)) for r in thresh_rows],
        csv_columns=[CSVColumnDef(**c) for c in _CSV_COLUMNS],
        temperature_ranges=[TemperatureRangeMeta(**dict(r)) for r in temp_range_rows],
        monitor_alert_rules=MonitorAlertRulesMeta(**dict(alert_rules_row)) if alert_rules_row else None,
    )


# ── Conductores liberados: terminaron sus viajes del día, reasignables ────────
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
        WITH day_trips AS (
            SELECT
                COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms') AS driver_name,
                t.fleet->>'driver_rut_tms'                                AS driver_rut,
                COALESCE(fl.driver_phone, t.fleet->>'driver_phone')       AS driver_phone,
                COALESCE(fl.tractor_plate, t.fleet->>'tractor_plate')     AS tractor_plate,
                tp.business_name                                          AS transporter,
                t.status_reported_at,
                -- mismo criterio de "terminal" que la derivación de activo en dbt
                (t.trip_status LIKE 'CERRADO%'
                 OR t.trip_status IN ('CANCELADO', 'Declinada', 'Removida')) AS closed
            FROM app.trips t
            LEFT JOIN app.trip_fleet_links fl ON fl.id = t.fleet_link_id
            LEFT JOIN app.transporter_profiles tp ON tp.id = fl.transporter_id
            WHERE t.planning_date = $1
              AND t.source_system != 'sodimac'
        )
        SELECT
            driver_name,
            max(driver_rut)          AS driver_rut,
            max(driver_phone)        AS driver_phone,
            max(tractor_plate)       AS tractor_plate,
            max(transporter)         AS transporter,
            count(*)                 AS trips_total,
            max(status_reported_at)  AS last_report_at
        FROM day_trips
        WHERE driver_name IS NOT NULL AND driver_name != ''
        GROUP BY driver_name
        HAVING count(*) = count(*) FILTER (WHERE closed)
        ORDER BY max(status_reported_at) DESC NULLS LAST
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
    origin:                 Optional[str] = None
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
    transporter_profile_id: Optional[str] = None  # si se selecciona desde Empresas


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
    stops_json = _build_manual_stops(body.stops, trip_id)

    try:
        await conn.execute(
            """
            INSERT INTO app.trips_manual (
                id, origin_tms, source_system_trip_id, client_name, planning_date,
                origin, origin_region, origin_city, cargo_type, trip_status,
                fleet, stops, created_by
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::uuid)
            """,
            trip_id, body.origin_tms, body.source_system_trip_id, body.client_name,
            body.planning_date, body.origin, body.origin_region, body.origin_city,
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
            planning_date, origin, origin_region, origin_city, cargo_type,
            trip_status, fleet, stops,
            activo, trabajando, asignado, primera_vuelta,
            status_reported_at, pipeline_updated_at, created_at, updated_at,
            manually_edited_fields
        ) VALUES ($1,'manual',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
                  true,false,false,false,NOW(),NOW(),NOW(),NOW(),'{}')
        """,
        trip_id, body.origin_tms, body.source_system_trip_id, body.client_name,
        body.planning_date, body.origin, body.origin_region, body.origin_city,
        body.cargo_type, body.current_status,
        fleet_json, stops_json,
    )

    # Si se seleccionó una empresa del módulo de Empresas, crear fleet_link
    if body.transporter_profile_id:
        link_id = await conn.fetchval(
            """
            INSERT INTO app.trip_fleet_links
              (trip_id, transporter_id, tractor_plate, trailer_plate,
               driver_name_raw, driver_phone, link_source, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'manual',$7::uuid)
            RETURNING id
            """,
            trip_id,
            body.transporter_profile_id,
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
                estado_manual          = t.estado_manual,
                origin_region          = t.origin_region,
                origin_city            = t.origin_city,
                activo                 = COALESCE(t.activo, m.activo),
                trabajando             = COALESCE(t.trabajando, m.trabajando),
                asignado               = COALESCE(t.asignado, m.asignado),
                primera_vuelta         = COALESCE(t.primera_vuelta, m.primera_vuelta),
                observaciones          = t.observaciones,
                comentarios            = t.comentarios,
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


@router.get("/{trip_id}")
async def get_trip(
    trip_id: str,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    row = await pool.fetchrow(
        f"SELECT {_TRIP_SELECT} {_TRIP_FROM} WHERE t.id = $1",
        trip_id,
    )
    if not row:
        raise HTTPException(404, "Viaje no encontrado")
    d = dict(row)
    if d.get("stops") and isinstance(d["stops"], str):
        d["stops"] = json.loads(d["stops"])
    _apply_stop_manual_fields(d)
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
        link_id = await pool.fetchval("SELECT fleet_link_id FROM app.trips WHERE id = $1", trip_id)
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
        link_id = await pool.fetchval("SELECT fleet_link_id FROM app.trips WHERE id = $1", trip_id)
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
        link_id = await pool.fetchval("SELECT fleet_link_id FROM app.trips WHERE id = $1", trip_id)
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
    bool_fields = ("activo", "trabajando", "asignado", "primera_vuelta")
    str_fields  = ("estado_manual", "observaciones", "comentarios",
                   "origin_region", "origin_city")
    # cag_inicio/cag_fin (Carga Inicio/Fin, origen): campos híbridos sin
    # equivalente TMS — no compiten con el pipeline, no necesitan pasar por
    # manually_edited_fields/protect_manual_overrides (eso protege campos que
    # el TMS SÍ puede seguir reportando).
    datetime_fields = ("cag_inicio", "cag_fin")
    trip_fields = {k: v for k, v in data.items() if k in (*bool_fields, *str_fields, *datetime_fields)}
    # Ubicación: string vacío = limpiar (NULL) — evita mezclar '' y NULL en los
    # filtros exactos de region/ciudad
    for k in ("origin_region", "origin_city"):
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

        for field in datetime_fields:
            if field in trip_fields:
                vals.append(trip_fields[field] or None)
                sets.append(f"{field} = ${len(vals)}::timestamptz")

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

    if "estado_manual" in data:
        await _log_system_note(
            pool, trip_id, user,
            f"Estableció estado operativo manual: {data['estado_manual']}",
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
    app.trips.stop_manual_fields (keyed por stop_id), nunca en el jsonb
    `stops` del pipeline (se sobrescribe completo en cada corrida)."""
    exists = await pool.fetchval("SELECT id FROM app.trips WHERE id = $1", trip_id)
    if not exists:
        raise HTTPException(404, "Viaje no encontrado")

    patch = body.model_dump(exclude_none=True)
    if not patch:
        raise HTTPException(422, "Ningún campo enviado")

    await pool.execute(
        """
        UPDATE app.trips
        SET stop_manual_fields = jsonb_set(
                COALESCE(stop_manual_fields, '{}'::jsonb),
                ARRAY[$2],
                COALESCE(stop_manual_fields->$2, '{}'::jsonb) || $3::jsonb,
                true
            ),
            updated_at = NOW()
        WHERE id = $1
        """,
        trip_id, stop_id, json.dumps(patch),
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

    transporter_id = body.get("transporter_id")
    if not transporter_id:
        raise HTTPException(422, "transporter_id requerido")

    old_link_id = await pool.fetchval(
        "SELECT fleet_link_id FROM app.trips WHERE id = $1", trip_id
    )
    if old_link_id:
        await pool.execute("DELETE FROM app.trip_fleet_links WHERE id = $1", old_link_id)

    link_id = await pool.fetchval(
        """
        INSERT INTO app.trip_fleet_links
          (trip_id, transporter_id, tractor_plate, trailer_plate,
           driver_name_raw, link_source, created_by)
        VALUES ($1, $2, $3, $4, $5, 'manual', $6)
        RETURNING id
        """,
        trip_id,
        transporter_id,
        body.get("tractor_plate"),
        body.get("trailer_plate"),
        body.get("driver_name"),
        user["sub"],
    )

    await pool.execute(
        "UPDATE app.trips SET fleet_link_id = $1, updated_at = NOW() WHERE id = $2",
        link_id, trip_id,
    )

    transporter_name = await pool.fetchval(
        "SELECT business_name FROM app.transporter_profiles WHERE id = $1", transporter_id
    )
    await _log_system_note(
        pool, trip_id, user,
        f"Vinculó empresa transportista: {transporter_name or transporter_id}",
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
    link_id = await pool.fetchval(
        "SELECT fleet_link_id FROM app.trips WHERE id = $1", trip_id
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
    VALID = {"estado_manual", "observaciones", "comentarios",
             "activo", "trabajando", "asignado", "primera_vuelta"}
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
    if field == "estado_manual":
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
    n.body, n.note_type, n.pinned, n.created_at
    FROM app.trip_notes n
    LEFT JOIN public.profiles p ON p.id = n.author_id
"""


class TripNotePin(BaseModel):
    pinned: bool


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
