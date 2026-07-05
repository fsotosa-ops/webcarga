import json
from datetime import date as _date
from typing import Optional
from uuid import uuid4
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.trip import TripPatch


def _parse_date(s: str) -> _date | None:
    try:
        return _date.fromisoformat(s) if s else None
    except ValueError:
        return None


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
    fl.driver_phone                               AS driver_phone,
    tp.business_name                              AS transporter,
    t.fleet->>'transporter_name_tms'              AS transporter_tms,
    t.origin,
    t.cargo_type,
    t.stops,
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
        "OR t.fleet->>'transporter_name_tms' ILIKE '%'||$1||'%')"
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
    {"field": "source_system_trip_id", "csv_key": "id_origen",     "label": "ID origen",           "required": False, "type": "text",       "example": "VJE-001"},
    {"field": "source_system",   "csv_key": "fuente",              "label": "Fuente",              "required": False, "type": "tms_source", "example": "manual"},
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
    statuses:           list[StatusMeta]
    tms_sources:        list[TmsSourceMeta]
    operational_states: list[OperationalStateMeta]
    alert_thresholds:   list[AlertThresholdMeta]
    csv_columns:        list[CSVColumnDef]
    temperature_ranges: list[TemperatureRangeMeta]


@router.get("/meta", response_model=TripsMeta)
async def get_trips_meta(pool=Depends(get_pool)):
    status_rows = await pool.fetch(
        "SELECT id, label, bg_color, text_color, group_id AS group "
        "FROM app.trip_statuses WHERE active = true ORDER BY sort_order"
    )
    op_rows = await pool.fetch(
        "SELECT id::text, label, bg_color, text_color "
        "FROM app.operational_states WHERE active = true ORDER BY sort_order"
    )
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
    )


# ── Trip creation (manual entry + bulk) ──────────────────────────────────────

class TripCreateBody(BaseModel):
    planning_date:          _date
    source_system_trip_id:  Optional[str] = None
    source_system:          str           = 'manual'
    client_name:            Optional[str] = None
    origin:                 Optional[str] = None
    cargo_type:             Optional[str] = None
    current_status:         Optional[str] = None
    tractor_plate:          Optional[str] = None
    trailer_plate:          Optional[str] = None
    driver_name:            Optional[str] = None
    driver_rut:             Optional[str] = None
    driver_phone:           Optional[str] = None
    transporter_name:       Optional[str] = None
    transporter_profile_id: Optional[str] = None  # si se selecciona desde Empresas


async def _insert_trip(conn, body: TripCreateBody) -> str:
    fleet = {k: v for k, v in {
        "driver_name_tms":      body.driver_name,
        "driver_rut_tms":       body.driver_rut,
        "transporter_name_tms": body.transporter_name,
        "tractor_plate":        body.tractor_plate,
        "trailer_plate":        body.trailer_plate,
    }.items() if v}
    row = await conn.fetchrow(
        """
        INSERT INTO app.trips (
            source_system, source_system_trip_id, client_name, planning_date,
            origin, cargo_type, trip_status,
            fleet, stops,
            status_reported_at, pipeline_updated_at,
            manually_edited_fields
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'[]'::jsonb,NOW(),NOW(),$9)
        RETURNING id::text
        """,
        body.source_system,
        body.source_system_trip_id,
        body.client_name,
        body.planning_date,
        body.origin,
        body.cargo_type,
        body.current_status,
        json.dumps(fleet),
        ['tractor_plate', 'trailer_plate', 'driver_name',
         'origin', 'cargo_type', 'trip_status'],
    )
    trip_id = row["id"]

    # Si se seleccionó una empresa del módulo de Empresas, crear fleet_link
    if body.transporter_profile_id:
        link_id = await conn.fetchval(
            """
            INSERT INTO app.trip_fleet_links
              (trip_id, transporter_id, tractor_plate, trailer_plate,
               driver_name_raw, driver_phone, link_source, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'manual',NULL)
            RETURNING id
            """,
            trip_id,
            body.transporter_profile_id,
            body.tractor_plate,
            body.trailer_plate,
            body.driver_name,
            body.driver_phone,
        )
        await conn.execute(
            "UPDATE app.trips SET fleet_link_id = $1 WHERE id = $2",
            link_id, trip_id,
        )

    return trip_id


@router.post("")
async def create_trip(
    body: TripCreateBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    trip_id = await _insert_trip(pool, body)
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

    ids: list[str] = []
    async with pool.acquire() as conn:
        async with conn.transaction():
            for trip in body:
                trip_id = await _insert_trip(conn, trip)
                ids.append(trip_id)
    return {"created": len(ids), "ids": ids}


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
    str_fields  = ("estado_manual", "observaciones", "comentarios")
    trip_fields = {k: v for k, v in data.items() if k in (*bool_fields, *str_fields)}

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

    if "estado_manual" in data:
        await _log_system_note(
            pool, trip_id, user,
            f"Estableció estado operativo manual: {data['estado_manual']}",
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
    return {"ok": True, "field": field}


# ── Bitácora: feed cronológico inmutable de notas por viaje ──────────────────

# 'sistema' es exclusivo de eventos generados por la API (ver _log_system_note)
CLIENT_NOTE_TYPES = {"observacion", "llamada", "whatsapp", "incidente"}

ATTACHMENT_BUCKET = "trip-attachments"
ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
ALLOWED_ATTACHMENT_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
}
SIGNED_URL_TTL_SECONDS = 3600

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
        storage_path = f"{trip_id}/{note_id}/{uuid4().hex}_{file_name}"
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
