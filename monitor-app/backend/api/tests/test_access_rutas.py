# tests/test_access_rutas.py
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.access import router
from tests.conftest import usuario


def _cliente(user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    pool = MagicMock()
    pool.fetchrow = AsyncMock(return_value={"full_name": "Ana", "email": "ana@webcarga.com", "active": True})
    pool.fetch = AsyncMock(return_value=[{"name": "Operador de Operaciones"}])
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def test_me_devuelve_permisos():
    res = _cliente(usuario("operations_operator", aal="aal1")).get("/api/v1/me")
    assert res.status_code == 200
    assert "closures.sign" in res.json()["permissions"] and res.json()["roles"] == ["operations_operator"]
    assert res.json()["role_names"] == ["Operador de Operaciones"]


def test_catalogo_exige_gestionar_personas():
    assert _cliente(usuario("reader")).get("/api/v1/permissions").status_code == 403
    assert _cliente(usuario("admin")).get("/api/v1/permissions").status_code == 200


def test_crear_rol_exige_aal2():
    res = _cliente(usuario("admin", aal="aal1")).post("/api/v1/roles", json={
        "code": "custom_x", "name": "X", "permissions": ["operations.read"]})
    assert res.status_code == 403 and "dos pasos" in res.json()["detail"]
