import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from typing import Optional
from ..auth import get_current_user, get_supabase, require_admin
from ..db import get_pool
from .roles import ROLE_ORDER

router = APIRouter(prefix="/users", tags=["users"])


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


class UserCreate(BaseModel):
    email:     str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=1)
    role:      str = "viewer"
    # Sin contraseña: la persona entra con su Google o Microsoft del mismo
    # email (Supabase vincula la identidad a la cuenta ya creada).
    password:  Optional[str] = Field(default=None, min_length=12)


_PERFIL = "SELECT id, full_name, email, role, active, created_at FROM public.profiles WHERE id = $1"


# ALTA Y BAJA, SOLO POR ACÁ (09/10). Vivían en una server action del frontend
# (lib/actions/users.ts) que usaba la clave de servicio sin verificar quién
# llamaba: una server action es un POST público, así que proteger la página
# /dashboard/admin no la protegía. Cualquiera podía crearse una cuenta owner.
@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    actor=Depends(require_admin),
):
    if body.role not in ROLE_ORDER:
        raise HTTPException(422, f"Rol inválido: {body.role}")
    if not _can_assign(actor["role"], body.role):
        raise HTTPException(403, "No puedes asignar un rol igual o superior al tuyo")
    email = body.email.lower()

    # La invitación primero: crear la cuenta en Auth dispara handle_new_user,
    # que toma el rol de admin_whitelist. Sin invitación, nadie entra.
    await pool.execute(
        """INSERT INTO public.admin_whitelist (email, role, invited_by, invited_at)
           VALUES ($1, $2, $3::uuid, now())
           ON CONFLICT (email) DO UPDATE
           SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, invited_at = now()""",
        email, body.role, actor["sub"],
    )
    alta = {"email": email, "email_confirm": True, "user_metadata": {"full_name": body.full_name}}
    if body.password:
        alta["password"] = body.password
    try:
        creado = await asyncio.to_thread(supabase.auth.admin.create_user, alta)
    except Exception as e:
        await pool.execute("DELETE FROM public.admin_whitelist WHERE email = $1", email)
        if "already" in str(e).lower() or "registered" in str(e).lower():
            raise HTTPException(409, "Ya existe una cuenta con ese email")
        raise HTTPException(502, "No se pudo crear la cuenta en el servicio de acceso")

    user_id = str(creado.user.id)
    await pool.execute(
        "UPDATE public.profiles SET role = $2, full_name = $3 WHERE id = $1",
        user_id, body.role, body.full_name,
    )
    row = await pool.fetchrow(_PERFIL, user_id)
    return dict(row)


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    actor=Depends(require_admin),
):
    if user_id == actor["sub"]:
        raise HTTPException(403, "No puedes eliminar tu propia cuenta")
    target = await pool.fetchrow("SELECT role, email FROM public.profiles WHERE id = $1", user_id)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    if not _can_manage(actor["role"], target["role"] or "viewer"):
        raise HTTPException(403, "Sin permisos para gestionar este usuario")

    await asyncio.to_thread(supabase.auth.admin.delete_user, user_id)
    # Sin invitación no puede volver a crearse la cuenta entrando con Google.
    await pool.execute("DELETE FROM public.admin_whitelist WHERE lower(email) = lower($1)", target["email"])
    return Response(status_code=204)


@router.get("")
async def list_users(
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    # Último ingreso, cómo entra y si tiene MFA (seguridad, 09/10): para que
    # WebCarga revise periódicamente quién tiene acceso. El historial completo
    # de ingresos vive en los logs de Supabase Auth, no en la base.
    rows = await pool.fetch(
        """SELECT p.id, p.full_name, p.email, p.role, p.active, p.created_at,
                  u.last_sign_in_at,
                  COALESCE((SELECT array_agg(DISTINCT i.provider ORDER BY i.provider)
                            FROM auth.identities i WHERE i.user_id = p.id), '{}') AS providers,
                  EXISTS (SELECT 1 FROM auth.mfa_factors f
                          WHERE f.user_id = p.id AND f.status = 'verified') AS mfa
           FROM public.profiles p
           LEFT JOIN auth.users u ON u.id = p.id
           ORDER BY p.created_at DESC"""
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
