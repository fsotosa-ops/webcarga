# tests/test_authz_sync_integracion.py
"""La API alinea app.permissions y los roles de sistema con el catálogo al arrancar."""
import pytest

from app.authz.permissions import PERMISSION_META, SYSTEM_ROLES
from app.authz.sync import sync_catalog

pytestmark = pytest.mark.integracion


async def test_sincroniza_permisos_y_composicion(conexion_revertida):
    conn = conexion_revertida
    huerfanos = await sync_catalog(conn)
    assert huerfanos == []
    codigos = {r["code"] for r in await conn.fetch("SELECT code FROM app.permissions")}
    assert codigos == {p.value for p in PERMISSION_META}
    for rol in SYSTEM_ROLES:
        fila = await conn.fetchrow(
            "SELECT id, name, is_system, grants_all FROM app.roles WHERE code = $1", rol.code)
        assert fila["is_system"] and fila["name"] == rol.name and fila["grants_all"] == rol.grants_all
        tiene = {r["permission_code"] for r in await conn.fetch(
            "SELECT permission_code FROM app.role_permissions WHERE role_id = $1", fila["id"])}
        assert tiene == {p.value for p in rol.permissions}, rol.code


async def test_es_idempotente(conexion_revertida):
    await sync_catalog(conexion_revertida)
    antes = await conexion_revertida.fetchval("SELECT count(*) FROM app.role_permissions")
    await sync_catalog(conexion_revertida)
    assert await conexion_revertida.fetchval("SELECT count(*) FROM app.role_permissions") == antes


async def test_un_permiso_retirado_del_codigo_se_informa_y_no_rompe(conexion_revertida):
    """Review Focus 3: un rol personalizado con un permiso que ya no existe."""
    conn = conexion_revertida
    await sync_catalog(conn)
    await conn.execute("INSERT INTO app.permissions (code, area, description) VALUES ('legacy.gone', 'operations', 'x')")
    rid = await conn.fetchval("INSERT INTO app.roles (code, name) VALUES ('custom_x', 'X') RETURNING id")
    await conn.execute("INSERT INTO app.role_permissions VALUES ($1, 'legacy.gone')", rid)
    assert await sync_catalog(conn) == ["legacy.gone"]
