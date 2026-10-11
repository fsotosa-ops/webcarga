"""Las rutas del resumen de entidad validan el id antes de tocar la base."""
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers import assets, carriers, drivers
from tests.conftest import usuario

USER = usuario("operations_supervisor", sub="11111111-1111-1111-1111-111111111111")


@pytest.mark.parametrize("path", ["/drivers/no-es-un-id/summary", "/assets/no-es-un-id/summary",
                                  "/carriers/no-es-un-id/summary"])
def test_malformed_id_is_422_without_querying(path):
    pool = AsyncMock()
    app = FastAPI()
    for module in (drivers, assets, carriers):
        app.include_router(module.router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    response = TestClient(app).get(f"/api/v1{path}")
    assert response.status_code == 422
    pool.fetchrow.assert_not_called()
