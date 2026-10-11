"""Configuración › Clientes del TMS (spec 2026-10-11 §4)."""
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.tms_clients import _SQL_LISTA, router
from tests.conftest import USER, wire_transactional_conn


def _cliente(pool, usuario=USER):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: usuario
    return TestClient(app)


def test_la_lista_sale_de_los_viajes_y_pone_primero_los_sin_vincular():
    assert "FROM app.trips t" in _SQL_LISTA
    assert "LEFT JOIN app.tms_client_shippers" in _SQL_LISTA
    assert "ORDER BY (m.shipper_id IS NULL) DESC" in _SQL_LISTA


def test_vincular_exige_un_cliente_del_directorio():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [None]  # el cliente no existe en el directorio
    wire_transactional_conn(pool, conn)
    res = _cliente(pool).put("/api/v1/tms-clients/00000000-0000-0000-0000-000000000001",
                             json={"shipper_id": "00000000-0000-0000-0000-000000000002"})
    assert res.status_code == 422
