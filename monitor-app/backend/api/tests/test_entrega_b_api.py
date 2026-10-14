"""Entrega B, criterios P4 y D5 (sin base): los permisos de los pedidos y quitar el tipo de operación."""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.db import get_pool
from app.routers.assets import router as assets_router
from app.routers.certification_requests import router as requests_router
from tests.conftest import usuario, wire_transactional_conn


def _client(router, user, pool=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool or AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    # La lectura final (get_asset) no está mockeada: lo que se prueba es el UPDATE.
    return TestClient(app, raise_server_exceptions=False)


def test_p4_only_operations_can_ask_and_only_review_can_resolve():
    body = {"entity_type": "DRIVER", "entity_id": "d1"}
    cert_operator = _client(requests_router, usuario("certification_operator"))
    assert cert_operator.post("/api/v1/certification-requests", json=body).status_code == 403
    ops = _client(requests_router, usuario("operations_operator"))
    assert ops.post("/api/v1/certification-requests/r1/resolve", json={}).status_code == 403


def test_d5_null_clears_the_operation_type_and_absent_leaves_it():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
                                  "manufacture_year": None, "fleet_service_type_id": None,
                                  "webcarga_operation_type_id": "t1"}
    client = _client(assets_router, usuario("operations_supervisor"), pool)

    client.patch("/api/v1/assets/a1", json={"webcarga_operation_type_id": None})
    clears = conn.execute.call_args_list[0].args
    assert clears[-1] is True

    conn.execute.reset_mock()
    client.patch("/api/v1/assets/a1", json={"manufacture_year": 2020})
    keeps = conn.execute.call_args_list[0].args
    assert keeps[-1] is False
