from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.coverage_types import router
from tests.conftest import USER


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_list_coverage_types_returns_active_only():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": "ct1", "code": "VEHICULOS_MOTORIZADOS", "name": "Vehículos Motorizados", "description": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/coverage-types")

    assert res.status_code == 200
    assert res.json()[0]["code"] == "VEHICULOS_MOTORIZADOS"
    assert "is_active = true" in pool.fetch.call_args.args[0]
