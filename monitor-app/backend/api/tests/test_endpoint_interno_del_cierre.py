"""POST /api/v1/internal/closures/recompute solo para Cloud Scheduler."""
from __future__ import annotations

import time
from unittest.mock import AsyncMock

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.authz import servicio_interno
from app.config import Settings, get_settings
from app.db import get_pool
from app.main import app

AUD = "https://api.test/api/v1/internal/closures/recompute"
CUENTA = "cierre-scheduler@webcarga-dev-493220.iam.gserviceaccount.com"
LLAVE = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _token(**claims) -> str:
    base = {"iss": "https://accounts.google.com", "aud": AUD, "email": CUENTA, "email_verified": True,
            "iat": int(time.time()), "exp": int(time.time()) + 300}
    base.update(claims)
    return jwt.encode(base, LLAVE, algorithm="RS256", headers={"kid": "k1"})


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setattr(servicio_interno, "_llave_de_google", lambda token: LLAVE.public_key())
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="x", supabase_url="https://s", supabase_service_role_key="x",
        scheduler_service_account=CUENTA, scheduler_audience=AUD)
    pool = AsyncMock()
    app.dependency_overrides[get_pool] = lambda: pool
    monkeypatch.setattr("app.routers.internal.procesar_cola",
                        AsyncMock(return_value={"recalculados": [], "cerrados": [], "ocupados": [],
                                                "fallidos": [], "pendientes": 0}))
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_sin_token_es_401(cliente):
    assert cliente.post("/api/v1/internal/closures/recompute").status_code == 401


def test_otra_cuenta_es_403(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute",
                     headers={"Authorization": f"Bearer {_token(email='otro@x.iam.gserviceaccount.com')}"})
    assert r.status_code == 403


def test_otra_audiencia_es_401(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute",
                     headers={"Authorization": f"Bearer {_token(aud='https://otra')}"})
    assert r.status_code == 401


def test_el_token_del_scheduler_procesa_la_cola(cliente):
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 200 and r.json()["fallidos"] == []


def test_si_un_dia_falla_responde_500(cliente, monkeypatch):
    monkeypatch.setattr("app.routers.internal.procesar_cola", AsyncMock(return_value={
        "recalculados": [], "cerrados": [], "ocupados": [], "pendientes": 0,
        "fallidos": [{"fecha": "2026-10-10", "error": "boom"}]}))
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 500


def test_sin_configuracion_nadie_entra(cliente):
    app.dependency_overrides[get_settings] = lambda: Settings(
        database_url="x", supabase_url="https://s", supabase_service_role_key="x")
    r = cliente.post("/api/v1/internal/closures/recompute", headers={"Authorization": f"Bearer {_token()}"})
    assert r.status_code == 403
