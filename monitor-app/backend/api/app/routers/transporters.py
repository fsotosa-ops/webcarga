import json
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user, require_admin, require_editor
from ..db import get_pool
from ..schemas.transporter import (
    AddDriverReq,
    AddTrailerReq,
    AddVehicleReq,
    PaginatedResponse,
    TransporterPatch,
)

router = APIRouter(prefix="/transporters", tags=["transporters"])

VALID_OVERRIDE_FIELDS = {
    "business_name", "rut", "account_stage",
    "contactability", "drivers", "vehicles", "trailers",
}


# ── Helpers ───────────────────────────────────────────────────────

def _row_to_dict(row) -> dict:
    d = dict(row)
    for key in ("contactability", "drivers", "vehicles", "trailers"):
        if isinstance(d.get(key), str):
            d[key] = json.loads(d[key])
    for key in ("edited_at", "updated_at", "created_at"):
        if d.get(key) is not None:
            d[key] = d[key].isoformat()
    return d


# ── LIST ──────────────────────────────────────────────────────────

@router.get("/", response_model=PaginatedResponse)
async def list_transporters(
    q: str = Query("", description="Buscar por nombre o RUT"),
    stage: str = Query("", description="Filtrar por account_stage exacto"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    offset = (page - 1) * limit
    params: list = []
    clauses: list[str] = []

    if q:
        params.append(q)
        clauses.append(f"(business_name ILIKE '%' || ${len(params)} || '%' OR rut ILIKE '%' || ${len(params)} || '%' OR admin_id = ${len(params)})")
    if stage:
        params.append(stage)
        clauses.append(f"account_stage = ${len(params)}")

    where = ("AND " + " AND ".join(clauses)) if clauses else ""

    params_page = params + [limit, offset]
    lp, op = len(params) + 1, len(params) + 2

    rows = await pool.fetch(f"""
        SELECT
            id, admin_id, business_name, rut, account_stage,
            jsonb_array_length(COALESCE(drivers,  '[]'::jsonb)) AS driver_count,
            jsonb_array_length(COALESCE(vehicles, '[]'::jsonb)) AS vehicle_count,
            jsonb_array_length(COALESCE(trailers, '[]'::jsonb)) AS trailer_count,
            (array_length(manually_edited_fields, 1) > 0)       AS has_manual_edits
        FROM app.transporter_profiles
        WHERE TRUE {where}
        ORDER BY business_name ASC NULLS LAST
        LIMIT ${lp} OFFSET ${op}
    """, *params_page)

    count = await pool.fetchval(f"""
        SELECT COUNT(*) FROM app.transporter_profiles
        WHERE TRUE {where}
    """, *params)

    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}


# ── DETAIL ────────────────────────────────────────────────────────

@router.get("/{tid}")
async def get_transporter(tid: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        "SELECT * FROM app.transporter_profiles WHERE id = $1", tid
    )
    if not row:
        raise HTTPException(status_code=404, detail="No encontrado")
    return _row_to_dict(row)


# ── PATCH ─────────────────────────────────────────────────────────

@router.patch("/{tid}")
async def patch_transporter(
    tid: str,
    body: TransporterPatch,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    exists = await pool.fetchval(
        "SELECT id FROM app.transporter_profiles WHERE id = $1", tid
    )
    if not exists:
        raise HTTPException(status_code=404, detail="No encontrado")

    sent = body.sent_fields()
    if not sent:
        raise HTTPException(status_code=422, detail="Ningún campo enviado")

    data = body.model_dump(exclude_none=True)

    await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            business_name  = COALESCE($2,        business_name),
            rut            = COALESCE($3,        rut),
            account_stage  = COALESCE($4,        account_stage),
            contactability = COALESCE($5::jsonb, contactability),
            drivers        = COALESCE($6::jsonb, drivers),
            vehicles       = COALESCE($7::jsonb, vehicles),
            trailers       = COALESCE($8::jsonb, trailers),
            manually_edited_fields = (
                SELECT ARRAY(
                    SELECT DISTINCT unnest(
                        COALESCE(manually_edited_fields, '{}') || $9::text[]
                    )
                )
            ),
            edited_by  = $10::uuid,
            edited_at  = NOW(),
            updated_at = NOW()
        WHERE id = $1
        """,
        tid,
        data.get("business_name"),
        data.get("rut"),
        data.get("account_stage"),
        json.dumps(data["contactability"]) if "contactability" in data else None,
        json.dumps(data["drivers"])        if "drivers"        in data else None,
        json.dumps(data["vehicles"])       if "vehicles"       in data else None,
        json.dumps(data["trailers"])       if "trailers"       in data else None,
        sent,
        user["sub"],
    )
    return await get_transporter(tid, pool, user)


# ── RESET FIELD (devolver campo al pipeline) ──────────────────────

@router.delete("/{tid}/overrides/{field}")
async def reset_field(
    tid: str,
    field: str,
    pool=Depends(get_pool),
    _=Depends(require_editor),
):
    if field not in VALID_OVERRIDE_FIELDS:
        raise HTTPException(status_code=422, detail=f"Campo inválido: {field}")

    result = await pool.execute(
        """
        UPDATE app.transporter_profiles
        SET manually_edited_fields = array_remove(manually_edited_fields, $2),
            updated_at = NOW()
        WHERE id = $1
        """,
        tid, field,
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"ok": True, "field": field}


# ── DRIVERS ───────────────────────────────────────────────────────

@router.post("/{tid}/drivers")
async def add_driver(
    tid: str,
    body: AddDriverReq,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    new = {"id": str(uuid.uuid4()), "rut": body.rut, "name": body.name}
    result = await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            drivers = COALESCE(drivers, '[]'::jsonb) || $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['drivers']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps([new]), user["sub"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"data": new}


@router.delete("/{tid}/drivers/{did}")
async def remove_driver(
    tid: str,
    did: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    row = await pool.fetchrow(
        "SELECT drivers FROM app.transporter_profiles WHERE id = $1", tid
    )
    if not row:
        raise HTTPException(status_code=404, detail="No encontrado")

    filtered = [d for d in (row["drivers"] or []) if d["id"] != did]
    await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            drivers = $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['drivers']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps(filtered), user["sub"],
    )
    return {"ok": True}


# ── VEHICLES ──────────────────────────────────────────────────────

@router.post("/{tid}/vehicles")
async def add_vehicle(
    tid: str,
    body: AddVehicleReq,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    new = {"id": str(uuid.uuid4()), "type": body.type, "plate": body.plate}
    result = await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            vehicles = COALESCE(vehicles, '[]'::jsonb) || $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['vehicles']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps([new]), user["sub"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"data": new}


@router.delete("/{tid}/vehicles/{vid}")
async def remove_vehicle(
    tid: str,
    vid: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    row = await pool.fetchrow(
        "SELECT vehicles FROM app.transporter_profiles WHERE id = $1", tid
    )
    if not row:
        raise HTTPException(status_code=404, detail="No encontrado")

    filtered = [v for v in (row["vehicles"] or []) if v["id"] != vid]
    await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            vehicles = $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['vehicles']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps(filtered), user["sub"],
    )
    return {"ok": True}


# ── TRAILERS ──────────────────────────────────────────────────────

@router.post("/{tid}/trailers")
async def add_trailer(
    tid: str,
    body: AddTrailerReq,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    new = {"id": str(uuid.uuid4()), "plate": body.plate}
    result = await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            trailers = COALESCE(trailers, '[]'::jsonb) || $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['trailers']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps([new]), user["sub"],
    )
    if result == "UPDATE 0":
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"data": new}


@router.delete("/{tid}/trailers/{trid}")
async def remove_trailer(
    tid: str,
    trid: str,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    row = await pool.fetchrow(
        "SELECT trailers FROM app.transporter_profiles WHERE id = $1", tid
    )
    if not row:
        raise HTTPException(status_code=404, detail="No encontrado")

    filtered = [t for t in (row["trailers"] or []) if t["id"] != trid]
    await pool.execute(
        """
        UPDATE app.transporter_profiles SET
            trailers = $2::jsonb,
            manually_edited_fields = (
                SELECT ARRAY(SELECT DISTINCT unnest(
                    COALESCE(manually_edited_fields, '{}') || ARRAY['trailers']
                ))
            ),
            edited_by = $3::uuid, edited_at = NOW(), updated_at = NOW()
        WHERE id = $1
        """,
        tid, json.dumps(filtered), user["sub"],
    )
    return {"ok": True}


# ── DELETE (admin) ────────────────────────────────────────────────

@router.delete("/{tid}")
async def delete_transporter(
    tid: str,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    result = await pool.execute(
        "DELETE FROM app.transporter_profiles WHERE id = $1", tid
    )
    if result == "DELETE 0":
        raise HTTPException(status_code=404, detail="No encontrado")
    return {"ok": True}
