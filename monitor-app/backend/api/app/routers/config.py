from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator

from ..auth import require_admin
from ..db import get_pool

router = APIRouter(prefix="/config", tags=["config"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class TripStatusPatch(BaseModel):
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        allowed = {"en_ruta", "en_local", "retornando", "cerrado", "problema", "otro"}
        if v not in allowed:
            raise ValueError(f"group_id debe ser uno de {allowed}")
        return v


class OperationalStateBody(BaseModel):
    label:      str
    bg_color:   str = "#f3f4f6"
    text_color: str = "#374151"
    sort_order: int = 99

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v


class OperationalStatePatch(BaseModel):
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    sort_order: Optional[int] = None
    active:     Optional[bool] = None


class AlertThresholdPatch(BaseModel):
    warning_days: Optional[int] = None
    error_days:   Optional[int] = None

    @field_validator("warning_days")
    @classmethod
    def warning_positive(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v <= 0:
            raise ValueError("warning_days debe ser mayor a 0")
        return v

    @field_validator("error_days")
    @classmethod
    def error_non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("error_days no puede ser negativo")
        return v


# ── Trip statuses (TMS-defined IDs, only presentation editable) ──────────────

@router.get("/statuses")
async def list_statuses(pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT id, label, bg_color, text_color, group_id, sort_order "
        "FROM app.trip_statuses WHERE active = true ORDER BY sort_order"
    )
    return [dict(r) for r in rows]


@router.patch("/statuses/{status_id}")
async def patch_status(
    status_id: str,
    body: TripStatusPatch,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT id FROM app.trip_statuses WHERE id = $1", status_id
    )
    if not existing:
        raise HTTPException(404, "Estado no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [status_id]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")

    await pool.execute(
        f"UPDATE app.trip_statuses SET {', '.join(sets)} WHERE id = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT id, label, bg_color, text_color, group_id, sort_order "
        "FROM app.trip_statuses WHERE id = $1",
        status_id,
    )
    return dict(row)


# ── Operational states (full CRUD) ───────────────────────────────────────────

@router.get("/operational-states")
async def list_operational_states(pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT id::text, label, bg_color, text_color, sort_order, active "
        "FROM app.operational_states ORDER BY sort_order, created_at"
    )
    return [dict(r) for r in rows]


@router.post("/operational-states")
async def create_operational_state(
    body: OperationalStateBody,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    row = await pool.fetchrow(
        """INSERT INTO app.operational_states (label, bg_color, text_color, sort_order)
           VALUES ($1, $2, $3, $4)
           RETURNING id::text, label, bg_color, text_color, sort_order, active""",
        body.label, body.bg_color, body.text_color, body.sort_order,
    )
    return dict(row)


@router.patch("/operational-states/{state_id}")
async def patch_operational_state(
    state_id: str,
    body: OperationalStatePatch,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT id FROM app.operational_states WHERE id = $1", state_id
    )
    if not existing:
        raise HTTPException(404, "Estado operacional no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [state_id]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")
    sets.append("updated_at = NOW()")

    await pool.execute(
        f"UPDATE app.operational_states SET {', '.join(sets)} WHERE id = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT id::text, label, bg_color, text_color, sort_order, active "
        "FROM app.operational_states WHERE id = $1",
        state_id,
    )
    return dict(row)


@router.delete("/operational-states/{state_id}")
async def delete_operational_state(
    state_id: str,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    result = await pool.execute(
        "UPDATE app.operational_states SET active = false, updated_at = NOW() WHERE id = $1",
        state_id,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "Estado operacional no encontrado")
    return {"ok": True}


# ── Alert thresholds ─────────────────────────────────────────────────────────

@router.get("/alert-thresholds")
async def list_alert_thresholds(pool=Depends(get_pool)):
    rows = await pool.fetch(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds ORDER BY doc_type"
    )
    return [dict(r) for r in rows]


@router.patch("/alert-thresholds/{doc_type}")
async def patch_alert_threshold(
    doc_type: str,
    body: AlertThresholdPatch,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    existing = await pool.fetchrow(
        "SELECT doc_type FROM app.alert_thresholds WHERE doc_type = $1", doc_type
    )
    if not existing:
        raise HTTPException(404, "Tipo de documento no encontrado")

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")

    sets, vals = [], [doc_type]
    for field, value in data.items():
        vals.append(value)
        sets.append(f"{field} = ${len(vals)}")

    await pool.execute(
        f"UPDATE app.alert_thresholds SET {', '.join(sets)} WHERE doc_type = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT doc_type, label, warning_days, error_days "
        "FROM app.alert_thresholds WHERE doc_type = $1",
        doc_type,
    )
    return dict(row)
