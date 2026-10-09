# app/routers/access.py
"""Acceso: mis permisos, el catálogo, roles y asignaciones (spec RBAC §6)."""
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..authz import Permission, require
from ..authz.permissions import PERMISSION_META
from ..db import get_pool
from ..services.access_admin import AccessError, create_role, delete_role, set_user_roles, update_role

router = APIRouter(tags=["access"])


def _http(e: AccessError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("/me")
async def me(pool=Depends(get_pool), user=Depends(get_current_user)):
    perfil = await pool.fetchrow("SELECT full_name, email, active FROM public.profiles WHERE id = $1", user["sub"])
    # Los nombres de los roles, para mostrarlos (Topbar, menú): el frontend no
    # repite el catálogo de roles.
    nombres = [r["name"] for r in await pool.fetch(
        "SELECT name FROM app.roles WHERE code = ANY($1::text[]) ORDER BY grants_all DESC, is_system DESC, name",
        user["roles"])]
    return {"id": user["sub"], "email": perfil["email"], "full_name": perfil["full_name"],
            "roles": user["roles"], "role_names": nombres,
            "permissions": sorted(user["permissions"]), "aal": user["aal"]}


@router.get("/permissions")
async def list_permissions(_=Depends(require(Permission.USERS_MANAGE))):
    return [{"code": p.value, "area": m.area, "description": m.description, "privileged": m.privileged}
            for p, m in PERMISSION_META.items()]


@router.get("/roles")
async def list_roles(pool=Depends(get_pool), _=Depends(require(Permission.USERS_MANAGE))):
    filas = await pool.fetch(
        """SELECT r.id::text, r.code, r.name, r.description, r.is_system, r.grants_all,
                  COALESCE(array_agg(rp.permission_code ORDER BY rp.permission_code)
                           FILTER (WHERE rp.permission_code IS NOT NULL), '{}') AS permissions,
                  (SELECT count(*) FROM app.user_roles ur WHERE ur.role_id = r.id) AS assigned
           FROM app.roles r LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
           GROUP BY r.id ORDER BY r.is_system DESC, r.name""")
    return [dict(f) for f in filas]


class RoleIn(BaseModel):
    code: str = Field(pattern=r"^[a-z][a-z0-9_]{2,40}$")
    name: str = Field(min_length=2)
    description: str = ""
    permissions: list[str] = Field(min_length=1)


class RolePatch(BaseModel):
    name: str | None = None
    description: str | None = None
    permissions: list[str] | None = None


class UserRolesIn(BaseModel):
    roles: list[str]


@router.post("/roles", status_code=201)
async def post_role(body: RoleIn, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return await create_role(conn, actor, body.code, body.name, body.description, body.permissions)
        except AccessError as e:
            raise _http(e)


@router.patch("/roles/{role_id}")
async def patch_role(role_id: str, body: RolePatch, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return await update_role(conn, actor, role_id, body.name, body.description, body.permissions)
        except AccessError as e:
            raise _http(e)


@router.delete("/roles/{role_id}", status_code=204)
async def remove_role(role_id: str, pool=Depends(get_pool), actor=Depends(require(Permission.ROLES_MANAGE))):
    async with pool.acquire() as conn:
        try:
            await delete_role(conn, actor, role_id)
        except AccessError as e:
            raise _http(e)
    return Response(status_code=204)


@router.put("/users/{user_id}/roles")
async def put_user_roles(user_id: str, body: UserRolesIn, pool=Depends(get_pool),
                         actor=Depends(require(Permission.USERS_MANAGE))):
    async with pool.acquire() as conn:
        try:
            return {"roles": await set_user_roles(conn, actor, user_id, body.roles)}
        except AccessError as e:
            raise _http(e)
