import json
from fastapi import APIRouter, Depends, HTTPException, Query
from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.trip import TripPatch

router = APIRouter(prefix="/trips", tags=["trips"])

CLOSED_STATUSES = (
    "CERRADO FINALIZADO",
    "CERRADO INCOMPLETO",
    "CERRADO MANUAL",
    "CERRADO SIN GPS",
    "CERRADO POR OTRO VIAJE",
    "CANCELADO",
)


@router.get("/")
async def list_trips(
    fecha: str = Query(""),
    view: str = Query("en_curso"),      # en_curso | historial
    q: str = Query(""),
    fecha_desde: str = Query(""),
    fecha_hasta: str = Query(""),
    status: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(100, ge=1, le=500),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    filters: list[str] = [
        "($1 = '' OR tractor_plate ILIKE '%'||$1||'%' OR driver_name ILIKE '%'||$1||'%' OR driver_rut ILIKE '%'||$1||'%' OR transporter ILIKE '%'||$1||'%')"
    ]
    params: list = [q]

    def add(clause: str, value) -> None:
        params.append(value)
        filters.append(clause.replace("?", f"${len(params)}"))

    if fecha:
        add("planning_date = ?::date", fecha)
    if view == "en_curso":
        closed_sql = ", ".join(f"'{s}'" for s in CLOSED_STATUSES)
        filters.append(f"current_status NOT IN ({closed_sql})")
    if fecha_desde:
        add("planning_date >= ?::date", fecha_desde)
    if fecha_hasta:
        add("planning_date <= ?::date", fecha_hasta)
    if status:
        add("current_status = ?", status)

    where = "WHERE " + " AND ".join(filters)
    offset = (page - 1) * limit

    rows = await pool.fetch(
        f"SELECT id, tms_name, client_name, planning_date, current_status, "
        f"tractor_plate, trailer_plate, driver_name, driver_rut, transporter, origin, "
        f"activo, trabajando, asignado, primera_vuelta, estado_manual, locales, "
        f"observaciones, comentarios, manually_edited_fields, edited_at, updated_at "
        f"FROM app.trips {where} "
        f"ORDER BY planning_date DESC, updated_at DESC "
        f"LIMIT {limit} OFFSET {offset}",
        *params,
    )
    count = await pool.fetchval(f"SELECT COUNT(*) FROM app.trips {where}", *params)
    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}


@router.get("/{trip_id}")
async def get_trip(trip_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow("SELECT * FROM app.trips WHERE id = $1", trip_id)
    if not row:
        raise HTTPException(404, "Viaje no encontrado")
    return dict(row)


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

    sent = body.sent_fields()
    if not sent:
        raise HTTPException(422, "Ningún campo enviado")

    data = body.model_dump(exclude_none=True)

    await pool.execute(
        """
        UPDATE app.trips SET
          activo          = CASE WHEN $2::boolean IS NOT NULL THEN $2 ELSE activo         END,
          trabajando      = CASE WHEN $3::boolean IS NOT NULL THEN $3 ELSE trabajando     END,
          asignado        = CASE WHEN $4::boolean IS NOT NULL THEN $4 ELSE asignado       END,
          primera_vuelta  = CASE WHEN $5::boolean IS NOT NULL THEN $5 ELSE primera_vuelta END,
          estado_manual   = COALESCE($6, estado_manual),
          locales         = COALESCE($7, locales),
          observaciones   = COALESCE($8, observaciones),
          comentarios     = COALESCE($9, comentarios),
          manually_edited_fields = ARRAY(
            SELECT DISTINCT unnest(COALESCE(manually_edited_fields,'{}') || $10::text[])
          ),
          edited_by  = $11::uuid,
          edited_at  = NOW(),
          updated_at = NOW()
        WHERE id = $1
        """,
        trip_id,
        data.get("activo"),
        data.get("trabajando"),
        data.get("asignado"),
        data.get("primera_vuelta"),
        data.get("estado_manual"),
        data.get("locales"),
        data.get("observaciones"),
        data.get("comentarios"),
        sent,
        user["sub"],
    )
    return await get_trip(trip_id, pool, _)


@router.delete("/{trip_id}/overrides/{field}")
async def reset_field(
    trip_id: str,
    field: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    VALID = {"tractor_plate", "trailer_plate", "driver_name", "driver_rut", "current_status", "transporter"}
    if field not in VALID:
        raise HTTPException(422, f"Campo no restaurable: {field}")
    await pool.execute(
        """
        UPDATE app.trips
        SET manually_edited_fields = array_remove(manually_edited_fields, $2),
            updated_at = NOW()
        WHERE id = $1
        """,
        trip_id,
        field,
    )
    return {"ok": True, "field": field}
