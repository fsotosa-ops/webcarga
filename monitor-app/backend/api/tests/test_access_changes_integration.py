"""Personas y Roles en el registro de cambios (spec 2026-10-22-configuracion-orden-visual
§5, decisión del usuario: el registro incluye accesos). Roles y roles de una persona ya
se auditaban (ROLE, USER_ROLE); se agregan activar/desactivar y el antes de los
permisos de un rol, y la pantalla los lee por /config/changes. Transacción revertida."""
from __future__ import annotations

import json

import pytest

from app.authz.sync import sync_catalog
from app.services.access_admin import actualizar_persona, create_role, set_user_roles, update_role
from tests.conftest import PoolDeUnaConexion, usuario

pytestmark = pytest.mark.integracion


async def _dos_perfiles(conn):
    return [str(r["id"]) for r in await conn.fetch("SELECT id FROM public.profiles ORDER BY created_at LIMIT 2")]


async def test_cambiar_roles_de_una_persona_queda_registrado(conexion_revertida):
    from app.routers.config import list_config_changes
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _dos_perfiles(conn)
    duenio = usuario("owner", sub=a)

    await set_user_roles(conn, duenio, b, ["reader"])
    cambios = await list_config_changes(area="people", section="users", pool=PoolDeUnaConexion(conn),
                                        usuario=usuario("admin", sub=a))

    assert b in {c["element_id"] for c in cambios}


async def test_editar_permisos_de_un_rol_queda_registrado(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    (a, _) = await _dos_perfiles(conn)
    duenio = usuario("owner", sub=a)
    rol = await create_role(conn, duenio, "zz_test_rol", "ZZ Rol", "", ["operations.read"])

    await update_role(conn, duenio, rol["id"], None, None, ["operations.read", "directory.read"])

    fila = await conn.fetchrow(
        "SELECT old_value, new_value FROM public.audit_log WHERE entity_type = 'ROLE' AND entity_id = $1::uuid "
        "AND action = 'update' ORDER BY id DESC LIMIT 1", rol["id"])
    assert sorted(json.loads(fila["old_value"])["permissions"]) == ["operations.read"]
    assert sorted(json.loads(fila["new_value"])["permissions"]) == ["directory.read", "operations.read"]


async def test_desactivar_una_persona_queda_registrado(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _dos_perfiles(conn)
    await conn.execute("UPDATE public.profiles SET active = true WHERE id = $1", b)
    await set_user_roles(conn, usuario("owner", sub=a), b, ["reader"])

    await actualizar_persona(conn, usuario("owner", sub=a), b, active=False, full_name=None)

    fila = await conn.fetchrow(
        "SELECT old_value, new_value FROM public.audit_log WHERE entity_type = 'PERSON' AND entity_id = $1::uuid "
        "ORDER BY id DESC LIMIT 1", b)
    assert json.loads(fila["old_value"]) == {"active": True}
    assert json.loads(fila["new_value"]) == {"active": False}
