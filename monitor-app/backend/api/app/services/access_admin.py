# app/services/access_admin.py
"""Reglas de administración de acceso (spec RBAC §5). Sin HTTP: las rutas
traducen AccessError a su status. Cada operación corre en una transacción."""
from __future__ import annotations

from dataclasses import dataclass

from ..authz.effective import invalidate_access
from .audit import log_change


@dataclass
class AccessError(Exception):
    status: int
    message: str


def _es_propietario(actor: dict) -> bool:
    return "owner" in actor["roles"]


async def _permisos_de_roles(conn, codes: list[str]) -> tuple[set[str], bool, list[str]]:
    filas = await conn.fetch(
        """SELECT r.code, r.grants_all, rp.permission_code
           FROM app.roles r LEFT JOIN app.role_permissions rp ON rp.role_id = r.id
           WHERE r.code = ANY($1::text[])""", codes)
    encontrados = {f["code"] for f in filas}
    faltan = sorted(set(codes) - encontrados)
    return {f["permission_code"] for f in filas if f["permission_code"]}, any(f["grants_all"] for f in filas), faltan


# Todo lo que puede dejar a la organización sin Propietarios (quitar el rol,
# desactivar, borrar) toma este candado DENTRO de su transacción: dos
# Propietarios que se desactivan uno al otro a la vez se serializan, y el
# segundo ve al primero ya inactivo. Un FOR UPDATE sobre las filas no alcanza:
# desactivar cambia profiles, no user_roles (revisión final RBAC, hallazgo 2).
LLAVE_PROPIETARIOS = 8_202_611  # vecina de la de sync_catalog (8_202_610)


async def _bloquear_propietarios(conn) -> None:
    if not conn.is_in_transaction():
        raise RuntimeError("La regla del último Propietario exige una transacción: "
                           "el chequeo y la escritura van juntos")
    await conn.execute("SELECT pg_advisory_xact_lock($1)", LLAVE_PROPIETARIOS)


async def _propietarios_activos(conn) -> list[str]:
    return [str(r["user_id"]) for r in await conn.fetch(
        """SELECT ur.user_id FROM app.user_roles ur
           JOIN app.roles r ON r.id = ur.role_id JOIN public.profiles p ON p.id = ur.user_id
           WHERE r.code = 'owner' AND p.active IS NOT FALSE
           FOR UPDATE OF ur""")]


async def assert_can_grant(conn, actor: dict, role_codes: list[str]) -> None:
    """Los roles existen y el actor no da permisos que no tiene (escalada).
    Solo un Propietario da el rol Propietario. Se usa al invitar (antes de
    escribir la invitación) y al cambiar roles."""
    perms, todo, faltan = await _permisos_de_roles(conn, sorted(set(role_codes)))
    if faltan:
        raise AccessError(422, f"Roles inexistentes: {', '.join(faltan)}")
    if _es_propietario(actor):
        return
    if "owner" in role_codes:
        raise AccessError(403, "Solo un Propietario puede dar o quitar el rol Propietario")
    if todo or not perms <= set(actor["permissions"]):
        raise AccessError(403, "No puedes dar permisos que no tienes")


async def _roles_de(conn, user_id: str) -> list[str]:
    return sorted(r["code"] for r in await conn.fetch(
        "SELECT r.code FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
        user_id))


async def assert_can_manage_user(conn, actor: dict, user_id: str, *, deactivating: bool) -> None:
    """Desactivar, borrar o editar a una persona: un no-Propietario no toca a
    un Propietario, y nunca se queda la organización sin Propietarios activos.
    Va dentro de la transacción que escribe el cambio (ver LLAVE_PROPIETARIOS)."""
    await _bloquear_propietarios(conn)
    roles = await _roles_de(conn, user_id)
    if "owner" in roles and not _es_propietario(actor):
        raise AccessError(403, "No puedes modificar a un Propietario")
    if "owner" in roles and deactivating:
        if [u for u in await _propietarios_activos(conn) if u != user_id] == []:
            raise AccessError(409, "Debe quedar al menos un Propietario")


async def actualizar_persona(conn, actor: dict, user_id: str, *, active: bool | None,
                             full_name: str | None) -> None:
    """Activar/desactivar o renombrar a una persona: el chequeo y el UPDATE en
    la misma transacción, bajo el candado de Propietarios."""
    async with conn.transaction():
        await assert_can_manage_user(conn, actor, user_id, deactivating=active is False)
        await conn.execute(
            "UPDATE public.profiles SET active = COALESCE($2, active), full_name = COALESCE($3, full_name) WHERE id = $1",
            user_id, active, full_name)
    await invalidate_access(user_id)


async def retirar_persona(conn, actor: dict, user_id: str) -> None:
    """Primer paso de borrar a alguien: se desactiva en la misma transacción
    que el chequeo, así un borrado concurrente ya lo ve inactivo. Borrar la
    cuenta en Supabase Auth va después, fuera de la base."""
    async with conn.transaction():
        await assert_can_manage_user(conn, actor, user_id, deactivating=True)
        await conn.execute("UPDATE public.profiles SET active = false WHERE id = $1", user_id)
    await invalidate_access(user_id)


async def set_user_roles(conn, actor: dict, user_id: str, role_codes: list[str]) -> list[str]:
    async with conn.transaction():
        await _bloquear_propietarios(conn)
        nuevos = sorted(set(role_codes))
        perms, todo, faltan = await _permisos_de_roles(conn, nuevos)
        if faltan:
            raise AccessError(422, f"Roles inexistentes: {', '.join(faltan)}")
        actuales = sorted(r["code"] for r in await conn.fetch(
            "SELECT r.code FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = $1",
            user_id))
        propietario = _es_propietario(actor)
        if ("owner" in actuales) != ("owner" in nuevos) and not propietario:
            raise AccessError(403, "Solo un Propietario puede dar o quitar el rol Propietario")
        if "owner" in actuales and not propietario:
            raise AccessError(403, "No puedes modificar a un Propietario")
        if not propietario and (todo or not perms <= set(actor["permissions"])):
            raise AccessError(403, "No puedes dar permisos que no tienes")
        if "owner" in actuales and "owner" not in nuevos:
            if [u for u in await _propietarios_activos(conn) if u != user_id] == []:
                raise AccessError(409, "Debe quedar al menos un Propietario")
        await conn.execute("DELETE FROM app.user_roles WHERE user_id = $1", user_id)
        await conn.execute(
            """INSERT INTO app.user_roles (user_id, role_id, granted_by)
               SELECT $1, id, $3::uuid FROM app.roles WHERE code = ANY($2::text[])""",
            user_id, nuevos, actor["sub"])
        await log_change(conn, actor=actor["sub"], entity_type="USER_ROLE", entity_id=user_id,
                         action="set_roles", field="roles", old_value=actuales, new_value=nuevos)
    await invalidate_access(user_id)
    return nuevos


async def _validar_permisos(conn, actor: dict, permissions: list[str]) -> list[str]:
    pedidos = sorted(set(permissions))
    existentes = {r["code"] for r in await conn.fetch(
        "SELECT code FROM app.permissions WHERE code = ANY($1::text[])", pedidos)}
    if faltan := sorted(set(pedidos) - existentes):
        raise AccessError(422, f"Permisos inexistentes: {', '.join(faltan)}")
    if not _es_propietario(actor) and not set(pedidos) <= set(actor["permissions"]):
        raise AccessError(403, "No puedes dar permisos que no tienes")
    return pedidos


async def create_role(conn, actor: dict, code: str, name: str, description: str, permissions: list[str]) -> dict:
    async with conn.transaction():
        pedidos = await _validar_permisos(conn, actor, permissions)
        if await conn.fetchval("SELECT 1 FROM app.roles WHERE code = $1", code):
            raise AccessError(409, "Ya existe un rol con ese código")
        rid = await conn.fetchval(
            "INSERT INTO app.roles (code, name, description, created_by) VALUES ($1,$2,$3,$4::uuid) RETURNING id::text",
            code, name, description, actor["sub"])
        await conn.executemany("INSERT INTO app.role_permissions VALUES ($1::uuid, $2)", [(rid, p) for p in pedidos])
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=rid, action="create",
                         new_value={"code": code, "permissions": pedidos})
    return {"id": rid, "code": code, "name": name, "description": description, "permissions": pedidos}


async def update_role(conn, actor: dict, role_id: str, name: str | None, description: str | None,
                      permissions: list[str] | None) -> dict:
    async with conn.transaction():
        rol = await conn.fetchrow("SELECT code, name, description, is_system FROM app.roles WHERE id = $1::uuid FOR UPDATE", role_id)
        if rol is None:
            raise AccessError(404, "Rol no encontrado")
        if rol["is_system"]:
            raise AccessError(409, "Los roles de sistema no se editan")
        if permissions is not None:
            pedidos = await _validar_permisos(conn, actor, permissions)
            await conn.execute("DELETE FROM app.role_permissions WHERE role_id = $1::uuid", role_id)
            await conn.executemany("INSERT INTO app.role_permissions VALUES ($1::uuid, $2)", [(role_id, p) for p in pedidos])
        await conn.execute(
            "UPDATE app.roles SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1::uuid",
            role_id, name, description)
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=role_id, action="update",
                         new_value={"name": name, "description": description, "permissions": permissions})
        afectados = [str(r["user_id"]) for r in await conn.fetch("SELECT user_id FROM app.user_roles WHERE role_id = $1::uuid", role_id)]
    for uid in afectados:
        await invalidate_access(uid)
    fila = await conn.fetchrow("SELECT id::text, code, name, description FROM app.roles WHERE id = $1::uuid", role_id)
    perms = [r["permission_code"] for r in await conn.fetch(
        "SELECT permission_code FROM app.role_permissions WHERE role_id = $1::uuid ORDER BY 1", role_id)]
    return {**dict(fila), "permissions": perms}


async def delete_role(conn, actor: dict, role_id: str) -> None:
    async with conn.transaction():
        rol = await conn.fetchrow("SELECT is_system FROM app.roles WHERE id = $1::uuid FOR UPDATE", role_id)
        if rol is None:
            raise AccessError(404, "Rol no encontrado")
        if rol["is_system"]:
            raise AccessError(409, "Los roles de sistema no se borran")
        if n := await conn.fetchval("SELECT count(*) FROM app.user_roles WHERE role_id = $1::uuid", role_id):
            raise AccessError(409, f"El rol está asignado a {n} persona(s): reasígnalas primero")
        await conn.execute("DELETE FROM app.roles WHERE id = $1::uuid", role_id)
        await log_change(conn, actor=actor["sub"], entity_type="ROLE", entity_id=role_id, action="delete")
