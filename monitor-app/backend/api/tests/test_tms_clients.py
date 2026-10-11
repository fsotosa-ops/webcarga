"""Configuración › Clientes del TMS (spec 2026-10-11 §4)."""
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.tms_clients import _SQL_LISTA, router
from tests.conftest import USER, usuario, wire_transactional_conn


def _cliente(pool, usuario=USER):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: usuario
    return TestClient(app)


def test_la_lista_pone_primero_los_sin_vincular():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"source_client_id": "k9", "source_system": "wingsuite", "source_client": "lider", "trips": 4,
         "shipper_id": None, "shipper_name": None},
    ]
    res = _cliente(pool).get("/api/v1/tms-clients")
    assert res.status_code == 200
    assert res.json()[0]["shipper_id"] is None
    assert "ORDER BY (m.shipper_id IS NULL) DESC" in _SQL_LISTA


SOURCE = "00000000-0000-0000-0000-000000000001"
SHIPPER = "00000000-0000-0000-0000-000000000002"


def test_un_id_mal_formado_es_422_y_no_500():
    """Revisión final, menor 1: antes llegaba a `$1::uuid` y reventaba con 500."""
    pool = AsyncMock()
    assert _cliente(pool).put("/api/v1/tms-clients/no-es-un-id", json={"shipper_id": SHIPPER}).status_code == 422
    assert _cliente(pool).put(f"/api/v1/tms-clients/{SOURCE}", json={"shipper_id": "walmart"}).status_code == 422


def test_sin_commercial_edit_no_se_vincula():
    pool = AsyncMock()
    res = _cliente(pool, usuario("operations_supervisor")).put(
        f"/api/v1/tms-clients/{SOURCE}", json={"shipper_id": SHIPPER})
    assert res.status_code == 403


def test_un_cliente_del_tms_sin_viajes_es_404():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [{"id": SHIPPER}, {"source_system": None, "source_client": None}]
    conn.fetchval.return_value = None
    wire_transactional_conn(pool, conn)
    res = _cliente(pool).put(f"/api/v1/tms-clients/{SOURCE}", json={"shipper_id": SHIPPER})
    assert res.status_code == 404


def test_el_texto_del_tms_se_guarda_como_en_la_migracion():
    """Revisión final, menor 8: la migración guardó lower(btrim(...)); el PUT
    guardaba el texto crudo. Es el texto que entra al id canónico del viaje."""
    import inspect

    import app.routers.tms_clients as modulo
    assert "min(lower(btrim(client_name))) AS source_client" in inspect.getsource(modulo.vincular)


def test_vincular_exige_un_cliente_del_directorio():
    pool = AsyncMock()
    conn = AsyncMock()
    conn.fetchrow.side_effect = [None]  # el cliente no existe en el directorio
    wire_transactional_conn(pool, conn)
    res = _cliente(pool).put(f"/api/v1/tms-clients/{SOURCE}", json={"shipper_id": SHIPPER})
    assert res.status_code == 422
