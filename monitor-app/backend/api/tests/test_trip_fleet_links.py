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
    pool.fetchval.return_value = None  # sin fleet_link_id previo / sin viaje bloqueado
    pool.fetchrow.return_value = {"id": "trip-1", "stops": "[]"}
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── El JOIN de trips ya no resuelve contra la tabla legacy ──────────────────

def test_trip_from_resolves_against_public_carriers_not_legacy_transporter_profiles():
    assert "public.carriers" in _TRIP_FROM
    assert "app.transporter_profiles" not in _TRIP_FROM
    assert "app.transporter_profiles" not in _TRIP_SELECT


# ── POST /trips/{id}/fleet-link ──────────────────────────────────────────────

def test_assign_fleet_link_inserts_transporter_and_driver_id():
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)

    res = client.post("/api/v1/trips/trip-1/fleet-link", json={
        "transporter_id": "c1", "driver_id": "d1", "tractor_plate": "ABCD12",
    })
    assert res.status_code == 200

    insert = next(c for c in pool.fetchval.call_args_list if "INSERT INTO app.trip_fleet_links" in c.args[0])
    assert "driver_id" in insert.args[0]
    assert "c1" in insert.args and "d1" in insert.args


def test_assign_fleet_link_looks_up_business_name_from_public_carriers():
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)

    res = client.post("/api/v1/trips/trip-1/fleet-link", json={"transporter_id": "c1"})
    assert res.status_code == 200

    lookup = next(c for c in pool.fetchval.call_args_list if "business_name" in c.args[0])
    assert "public.carriers" in lookup.args[0]
    assert "app.transporter_profiles" not in lookup.args[0]


def test_assign_fleet_link_requires_transporter_id():
    pool = make_pool()
    pool.fetchval.return_value = "trip-1"  # exists-check pasa, llega a la validación
    client = make_client(pool)
    res = client.post("/api/v1/trips/trip-1/fleet-link", json={})
    assert res.status_code == 422


def test_assign_fleet_link_works_without_driver_id():
    """driver_id es opcional — vincular solo la empresa sigue funcionando."""
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)
    res = client.post("/api/v1/trips/trip-1/fleet-link", json={"transporter_id": "c1"})
    assert res.status_code == 200
    insert = next(c for c in pool.fetchval.call_args_list if "INSERT INTO app.trip_fleet_links" in c.args[0])
    assert None in insert.args  # driver_id enviado como NULL


# ── GET /trips/available-drivers ─────────────────────────────────────────────

def test_available_drivers_query_resolves_against_public_carriers():
    pool = make_pool()
    pool.fetch.return_value = []
    client = make_client(pool)
    res = client.get("/api/v1/trips/available-drivers?fecha=2026-07-17")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "public.carriers" in query
    assert "app.transporter_profiles" not in query
