"""Preferencias de tabla por persona (Cierre con un solo patrón, Task 1).

Qué columnas ve cada persona y en qué orden, por tabla. Se llaman los endpoints
reales en una transacción revertida, con personas que existen en la base."""
from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.table_preferences import (
    TablePreferencesBody,
    delete_table_preferences,
    get_table_preferences,
    put_table_preferences,
    router,
)
from tests.conftest import USER, PoolDeUnaConexion

FLOTA = [{"id": "primary", "hidden": False}, {"id": "carrier", "hidden": True}]


def make_client():
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_valida_la_clave_y_las_columnas():
    client = make_client()
    assert client.put("/api/v1/me/table-preferences/Cierre Flota", json={"columns": FLOTA}).status_code == 422
    assert client.put("/api/v1/me/table-preferences/closure.fleet",
                      json={"columns": [{"id": "con espacio", "hidden": False}]}).status_code == 422
    assert client.put("/api/v1/me/table-preferences/closure.fleet",
                      json={"columns": [{"id": f"c{i}", "hidden": False} for i in range(81)]}).status_code == 422
    assert client.put("/api/v1/me/table-preferences/closure.fleet",
                      json={"columns": FLOTA, "color": "red"}).status_code == 422


async def _dos_personas(conn) -> tuple[dict, dict]:
    filas = await conn.fetch("SELECT id::text FROM public.profiles ORDER BY id LIMIT 2")
    assert len(filas) == 2, "la copia local necesita dos perfiles"
    return {"sub": filas[0]["id"]}, {"sub": filas[1]["id"]}


@pytest.mark.integracion
async def test_guarda_lee_reemplaza_y_restablece(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    ana, beto = await _dos_personas(conexion_revertida)

    with pytest.raises(HTTPException) as nada:
        await get_table_preferences("closure.fleet", pool=pool, user=ana)
    assert nada.value.status_code == 404

    await put_table_preferences("closure.fleet", TablePreferencesBody(columns=FLOTA), pool=pool, user=ana)
    assert (await get_table_preferences("closure.fleet", pool=pool, user=ana))["columns"] == FLOTA

    # La segunda escritura gana.
    otra = [{"id": "carrier", "hidden": False}, {"id": "primary", "hidden": False}]
    await put_table_preferences("closure.fleet", TablePreferencesBody(columns=otra), pool=pool, user=ana)
    assert (await get_table_preferences("closure.fleet", pool=pool, user=ana))["columns"] == otra

    # Es de cada persona.
    with pytest.raises(HTTPException) as ajena:
        await get_table_preferences("closure.fleet", pool=pool, user=beto)
    assert ajena.value.status_code == 404

    await delete_table_preferences("closure.fleet", pool=pool, user=ana)
    with pytest.raises(HTTPException) as borrada:
        await get_table_preferences("closure.fleet", pool=pool, user=ana)
    assert borrada.value.status_code == 404
