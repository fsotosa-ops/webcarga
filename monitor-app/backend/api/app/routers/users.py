import asyncio

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from typing import Optional
from ..auth import get_supabase
from ..authz import Permission, require
from ..authz.effective import invalidate_access
from ..db import get_pool
from ..services.access_admin import AccessError, actualizar_persona, assert_can_grant, retirar_persona

router = APIRouter(prefix="/users", tags=["users"])


class UserPatch(BaseModel):
    # Los roles se cambian con PUT /users/{id}/roles (routers/access.py).
    active:    Optional[bool] = None
    full_name: Optional[str]  = None


class UserCreate(BaseModel):
    email:     str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    full_name: str = Field(min_length=1)
    roles:     list[str] = Field(min_length=1)
    # Sin contraseña: la persona entra con su Google o Microsoft del mismo
    # email (Supabase vincula la identidad a la cuenta ya creada).
    password:  Optional[str] = Field(default=None, min_length=12)


_PERFIL = """SELECT p.id, p.full_name, p.email, p.active, p.created_at,
                    COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM app.user_roles ur
                              JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id), '{}') AS roles
             FROM public.profiles p WHERE p.id = $1"""


def _http(e: AccessError) -> HTTPException:
    return HTTPException(e.status, e.message)


# ALTA Y BAJA, SOLO POR ACÁ (09/10). Vivían en una server action del frontend
# (lib/actions/users.ts) que usaba la clave de servicio sin verificar quién
# llamaba: una server action es un POST público, así que proteger la página
# /dashboard/admin no la protegía. Cualquiera podía crearse una cuenta owner.
@router.post("", status_code=201)
async def create_user(
    body: UserCreate,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    actor=Depends(require(Permission.USERS_MANAGE)),
):
    roles = sorted(set(body.roles))
    async with pool.acquire() as conn:
        try:
            # Antes de escribir la invitación: handle_new_user crea las
            # asignaciones a partir de ella al aceptarse.
            await assert_can_grant(conn, actor, roles)
        except AccessError as e:
            raise _http(e)
    email = body.email.lower()

    # La invitación primero: crear la cuenta en Auth dispara handle_new_user,
    # que toma los roles de admin_whitelist. Sin invitación, nadie entra.
    await pool.execute(
        """INSERT INTO public.admin_whitelist (email, role_codes, invited_by, invited_at)
           VALUES ($1, $2::text[], $3::uuid, now())
           ON CONFLICT (email) DO UPDATE
           SET role_codes = EXCLUDED.role_codes,
               invited_by = EXCLUDED.invited_by, invited_at = now()""",
        email, roles, actor["sub"],
    )

    # Sin contraseña: invitación por correo de Supabase (plantilla "Invite user"
    # del panel, con enlace a /auth/confirm). Si el correo falla —el correo de
    # Supabase tiene límite de envíos en el plan free— la cuenta se crea igual y
    # la pantalla ofrece el mensaje para copiar. Con contraseña no hay correo: el
    # admin le envía las credenciales (pedido de Pablo, 09/10).
    alta = {"email": email, "email_confirm": True, "user_metadata": {"full_name": body.full_name}}
    if body.password:
        alta["password"] = body.password
    invitation_sent = False
    try:
        if body.password:
            creado = await asyncio.to_thread(supabase.auth.admin.create_user, alta)
        else:
            try:
                creado = await asyncio.to_thread(
                    supabase.auth.admin.invite_user_by_email, email, {"data": {"full_name": body.full_name}})
                invitation_sent = True
            except Exception as e:
                if "already" in str(e).lower() or "registered" in str(e).lower():
                    raise
                creado = await asyncio.to_thread(supabase.auth.admin.create_user, alta)
    except Exception as e:
        await pool.execute("DELETE FROM public.admin_whitelist WHERE email = $1", email)
        if "already" in str(e).lower() or "registered" in str(e).lower():
            raise HTTPException(409, "Ya existe una cuenta con ese email")
        raise HTTPException(502, "No se pudo crear la cuenta en el servicio de acceso")

    user_id = str(creado.user.id)
    await pool.execute(
        "UPDATE public.profiles SET full_name = $2 WHERE id = $1",
        user_id, body.full_name,
    )
    row = await pool.fetchrow(_PERFIL, user_id)
    return {**dict(row), "invitation_sent": invitation_sent}


@router.delete("/{user_id}", status_code=204)
async def delete_user(
    user_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    actor=Depends(require(Permission.USERS_MANAGE)),
):
    if user_id == actor["sub"]:
        raise HTTPException(403, "No puedes eliminar tu propia cuenta")
    target = await pool.fetchrow("SELECT email FROM public.profiles WHERE id = $1", user_id)
    if not target:
        raise HTTPException(404, "Usuario no encontrado")
    async with pool.acquire() as conn:
        try:
            await retirar_persona(conn, actor, user_id)
        except AccessError as e:
            raise _http(e)

    await asyncio.to_thread(supabase.auth.admin.delete_user, user_id)
    # Sin invitación no puede volver a crearse la cuenta entrando con Google.
    await pool.execute("DELETE FROM public.admin_whitelist WHERE lower(email) = lower($1)", target["email"])
    await invalidate_access(user_id)
    return Response(status_code=204)


@router.get("")
async def list_users(
    pool=Depends(get_pool),
    _=Depends(require(Permission.USERS_MANAGE)),
):
    # Último ingreso, cómo entra y si tiene MFA (seguridad, 09/10): para que
    # WebCarga revise periódicamente quién tiene acceso. El historial completo
    # de ingresos vive en los logs de Supabase Auth, no en la base.
    rows = await pool.fetch(
        """SELECT p.id, p.full_name, p.email, p.active, p.created_at,
                  COALESCE((SELECT array_agg(r.code ORDER BY r.code) FROM app.user_roles ur
                            JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = p.id), '{}') AS roles,
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
    actor=Depends(require(Permission.USERS_MANAGE)),
):
    if user_id == actor["sub"]:
        raise HTTPException(403, "No puedes editar tu propia cuenta desde aquí")
    if not await pool.fetchval("SELECT 1 FROM public.profiles WHERE id = $1", user_id):
        raise HTTPException(404, "Usuario no encontrado")
    if body.active is None and body.full_name is None:
        raise HTTPException(422, "Ningún campo enviado")
    async with pool.acquire() as conn:
        try:
            await actualizar_persona(conn, actor, user_id, active=body.active, full_name=body.full_name)
        except AccessError as e:
            raise _http(e)
    row = await pool.fetchrow(_PERFIL, user_id)
    return dict(row)
