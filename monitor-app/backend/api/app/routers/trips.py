import json
from datetime import date as _date
from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.trip import TripPatch


def _parse_date(s: str) -> _date | None:
    try:
        return _date.fromisoformat(s) if s else None
    except ValueError:
        return None


router = APIRouter(prefix="/trips", tags=["trips"])

CLOSED_STATUSES = (
    "CERRADO FINALIZADO",
    "CERRADO INCOMPLETO",
    "CERRADO MANUAL",
    "CERRADO SIN GPS",
    "CERRADO POR OTRO VIAJE",
    "CANCELADO",
)

# SQL fragment that maps actual DB columns to the expected API response shape.
# fleet JSONB holds tractor/driver info; trip_fleet_links holds the resolved
# transporter_profile link.
_TRIP_SELECT = """
    t.id,
    t.tms_name,
    t.client_name,
    t.planning_date,
    t.status_reported_at,
    t.current_status_tms                          AS current_status,
    t.fleet->>'tractor_plate'                     AS tractor_plate,
    t.fleet->>'trailer_plate'                     AS trailer_plate,
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
    t.source_trip_id
"""

_TRIP_FROM = """
    FROM app.trips t
    LEFT JOIN app.trip_fleet_links fl ON fl.id = t.fleet_link_id
    LEFT JOIN app.transporter_profiles tp ON tp.id = fl.transporter_id
"""


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
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    filters: list[str] = [
        "($1 = '' OR t.fleet->>'tractor_plate' ILIKE '%'||$1||'%' "
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
    if view == "en_curso":
        closed_sql = ", ".join(f"'{s}'" for s in CLOSED_STATUSES)
        filters.append(f"t.current_status_tms NOT IN ({closed_sql})")
    if d := _parse_date(fecha_desde):
        add("t.planning_date >= ?", d)
    if d := _parse_date(fecha_hasta):
        add("t.planning_date <= ?", d)
    if status:
        add("t.current_status_tms = ?", status)
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

    where = "WHERE " + " AND ".join(filters)
    offset = (page - 1) * limit

    rows = await pool.fetch(
        f"SELECT {_TRIP_SELECT} {_TRIP_FROM} {where} "
        f"ORDER BY t.planning_date DESC, t.updated_at DESC "
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
    return {"ok": True, "field": field}
