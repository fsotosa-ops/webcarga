# tests/test_authz_efectivos_integracion.py
import uuid

import pytest
from unittest.mock import AsyncMock, patch

from app.authz.effective import load_access
from app.authz.sync import sync_catalog

pytestmark = pytest.mark.integracion


async def _persona(conn, *codigos):
    uid = await conn.fetchval("SELECT id FROM public.profiles ORDER BY created_at LIMIT 1")
    await conn.execute("DELETE FROM app.user_roles WHERE user_id = $1", uid)
    for c in codigos:
        await conn.execute(
            "INSERT INTO app.user_roles (user_id, role_id) SELECT $1, id FROM app.roles WHERE code = $2", uid, c)
    return str(uid)


@pytest.fixture
def sin_cache():
    with patch("app.authz.effective.cache_get", AsyncMock(return_value=None)), \
         patch("app.authz.effective.cache_set", AsyncMock()):
        yield


async def test_union_de_roles(conexion_revertida, sin_cache):
    await sync_catalog(conexion_revertida)
    uid = await _persona(conexion_revertida, "operations_operator", "insurance_operator")
    acceso = await load_access(conexion_revertida, uid)
    assert {"closures.sign", "policies.edit", "operations.read"} <= set(acceso["permissions"])
    assert "trips.edit_sensitive" not in acceso["permissions"]


async def test_propietario_tiene_todo_el_catalogo(conexion_revertida, sin_cache):
    await sync_catalog(conexion_revertida)
    uid = await _persona(conexion_revertida, "owner")
    acceso = await load_access(conexion_revertida, uid)
    todos = {r["code"] for r in await conexion_revertida.fetch("SELECT code FROM app.permissions")}
    assert set(acceso["permissions"]) == todos


async def test_sin_roles_no_tiene_acceso(conexion_revertida, sin_cache):
    uid = await _persona(conexion_revertida)
    acceso = await load_access(conexion_revertida, uid)
    assert acceso["roles"] == [] and acceso["permissions"] == []
