from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..auth import get_current_user, require_admin
from ..db import get_pool

router = APIRouter(prefix="/users", tags=["users"])

ROLE_ORDER = ["viewer", "writer", "editor", "admin", "owner"]


def _can_manage(actor_role: str, target_role: str) -> bool:
    """actor must be strictly higher in hierarchy than target."""
    ai = ROLE_ORDER.index(actor_role) if actor_role in ROLE_ORDER else -1
    ti = ROLE_ORDER.index(target_role) if target_role in ROLE_ORDER else -1
    return ai > ti


def _can_assign(actor_role: str, new_role: str) -> bool:
    """Actor can only assign roles strictly below their own."""
    ai = ROLE_ORDER.index(actor_role) if actor_role in ROLE_ORDER else -1
    ri = ROLE_ORDER.index(new_role)   if new_role   in ROLE_ORDER else -1
    return ai > ri


class UserPatch(BaseModel):
    role:      Optional[str]  = None
    active:    Optional[bool] = None
    full_name: Optional[str]  = None


@router.get("")
async def list_users(
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    rows = await pool.fetch(
        """SELECT id, full_name, email, role, active, created_at
           FROM public.profiles
           ORDER BY created_at DESC"""
    )
    return [dict(r) for r in rows]


@router.patch("/{user_id}")
async def patch_user(
    user_id: str,
    body: UserPatch,
    pool=Depends(get_pool),
    actor=Depends(require_admin),
):
    if user_id == actor["sub"]:
        raise HTTPException(403, "No puedes editar tu propia cuenta desde aquí")

    target = await pool.fetchrow(
        "SELECT role, active FROM public.profiles WHERE id = $1", user_id
    )
    if not target:
        raise HTTPException(404, "Usuario no encontrado")

    target_role = target["role"] or "viewer"
    if not _can_manage(actor["role"], target_role):
        raise HTTPException(403, "Sin permisos para gestionar este usuario")

    if body.role is not None:
        if body.role not in ROLE_ORDER:
            raise HTTPException(422, f"Rol inválido: {body.role}")
        if not _can_assign(actor["role"], body.role):
            raise HTTPException(403, "No puedes asignar un rol igual o superior al tuyo")

    sets: list[str] = []
    vals: list      = [user_id]

    for field, value in (("role", body.role), ("active", body.active), ("full_name", body.full_name)):
        if value is not None:
            vals.append(value)
            sets.append(f"{field} = ${len(vals)}")

    if not sets:
        raise HTTPException(422, "Ningún campo enviado")

    await pool.execute(
        f"UPDATE public.profiles SET {', '.join(sets)} WHERE id = $1",
        *vals,
    )
    row = await pool.fetchrow(
        "SELECT id, full_name, email, role, active, created_at FROM public.profiles WHERE id = $1",
        user_id,
    )
    return dict(row)
