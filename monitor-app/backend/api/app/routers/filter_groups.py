from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from typing import Optional
from ..auth import get_current_user
from ..db import get_pool

router = APIRouter(prefix="/filter-groups", tags=["filter-groups"])

VALID_COLORS = {"blue", "green", "orange", "purple", "red", "teal", "amber", "pink", "slate"}


class FilterGroupBody(BaseModel):
    name:     str
    statuses: list[str]
    color:    str = "blue"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name cannot be empty")
        if len(v) > 50:
            raise ValueError("name too long (max 50)")
        return v

    @field_validator("color")
    @classmethod
    def color_valid(cls, v: str) -> str:
        if v not in VALID_COLORS:
            raise ValueError(f"color must be one of {VALID_COLORS}")
        return v


class FilterGroupPatch(BaseModel):
    name:     Optional[str]       = None
    statuses: Optional[list[str]] = None
    color:    Optional[str]       = None


@router.get("")
async def list_filter_groups(
    pool=Depends(get_pool),
    user=Depends(get_current_user),
):
    rows = await pool.fetch(
        """SELECT id, name, statuses, color, created_at, updated_at
           FROM app.filter_groups
           WHERE user_id = $1
           ORDER BY created_at""",
        user["sub"],
    )
    return [dict(r) for r in rows]


@router.post("")
async def create_filter_group(
    body: FilterGroupBody,
    pool=Depends(get_pool),
    user=Depends(get_current_user),
):
    row = await pool.fetchrow(
        """INSERT INTO app.filter_groups (user_id, name, statuses, color)
           VALUES ($1, $2, $3, $4)
           RETURNING id, name, statuses, color, created_at, updated_at""",
        user["sub"], body.name, body.statuses, body.color,
    )
    return dict(row)


@router.patch("/{group_id}")
async def update_filter_group(
    group_id: str,
    body: FilterGroupPatch,
    pool=Depends(get_pool),
    user=Depends(get_current_user),
):
    existing = await pool.fetchrow(
        "SELECT id FROM app.filter_groups WHERE id = $1 AND user_id = $2",
        group_id, user["sub"],
    )
    if not existing:
        raise HTTPException(404, "Grupo no encontrado")

    sets: list[str] = []
    vals: list      = [group_id]

    if body.name is not None:
        name = body.name.strip()
        if not name or len(name) > 50:
            raise HTTPException(422, "Nombre inválido")
        vals.append(name); sets.append(f"name = ${len(vals)}")
    if body.statuses is not None:
        vals.append(body.statuses); sets.append(f"statuses = ${len(vals)}")
    if body.color is not None:
        if body.color not in VALID_COLORS:
            raise HTTPException(422, "Color inválido")
        vals.append(body.color); sets.append(f"color = ${len(vals)}")

    if not sets:
        raise HTTPException(422, "Ningún campo enviado")

    sets.append("updated_at = NOW()")
    await pool.execute(
        f"UPDATE app.filter_groups SET {', '.join(sets)} WHERE id = $1", *vals
    )
    row = await pool.fetchrow(
        "SELECT id, name, statuses, color, created_at, updated_at FROM app.filter_groups WHERE id = $1",
        group_id,
    )
    return dict(row)


@router.delete("/{group_id}")
async def delete_filter_group(
    group_id: str,
    pool=Depends(get_pool),
    user=Depends(get_current_user),
):
    result = await pool.execute(
        "DELETE FROM app.filter_groups WHERE id = $1 AND user_id = $2",
        group_id, user["sub"],
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Grupo no encontrado")
    return {"ok": True}
