from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router, _TRIP_FROM, _TRIP_SELECT
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── HU-12 (Fase 2): insurance_alert en el Diario ────────────────────────────
# Alerta prominente cuando el transportista resuelto de un viaje tiene póliza
# vencida o cuotas críticas impagas — regla del eslabón más débil sobre
# app.carrier_insurance_status (una empresa puede tener varias pólizas).

def test_trip_select_exposes_insurance_alert():
    assert "insurance_alert" in _TRIP_SELECT


def test_trip_from_joins_carrier_insurance_status_lateral():
    assert "app.carrier_insurance_status" in _TRIP_FROM
    assert "LEFT JOIN LATERAL" in _TRIP_FROM


def test_list_trips_insurance_alert_expired_filters_by_joined_alias():
    pool = make_pool()
    client = make_client(pool)

    res = client.get("/api/v1/trips?insurance_alert=EXPIRED")

    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ins.insurance_alert = $" in query
    params = pool.fetch.call_args_list[0].args[1:]
    assert "EXPIRED" in params


def test_list_trips_insurance_alert_overdue_installments_filters():
    pool = make_pool()
    client = make_client(pool)

    res = client.get("/api/v1/trips?insurance_alert=OVERDUE_INSTALLMENTS")

    assert res.status_code == 200
    params = pool.fetch.call_args_list[0].args[1:]
    assert "OVERDUE_INSTALLMENTS" in params


def test_list_trips_ignores_invalid_insurance_alert_value():
    pool = make_pool()
    client = make_client(pool)

    res = client.get("/api/v1/trips?insurance_alert=bogus")

    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ins.insurance_alert = $" not in query
