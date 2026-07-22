from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router, _TRIP_FROM, _TRIP_SELECT, _FLEET_MATCH_CASE
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

def test_assign_fleet_link_inserts_carrier_and_driver_id():
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)

    res = client.post("/api/v1/trips/trip-1/fleet-link", json={
        "carrier_id": "c1", "driver_id": "d1", "tractor_plate": "ABCD12",
    })
    assert res.status_code == 200

    insert = next(c for c in pool.fetchval.call_args_list if "INSERT INTO app.trip_fleet_links" in c.args[0])
    assert "driver_id" in insert.args[0]
    assert "c1" in insert.args and "d1" in insert.args


def test_assign_fleet_link_accepts_tractor_and_trailer_asset_id():
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)

    res = client.post("/api/v1/trips/trip-1/fleet-link", json={
        "carrier_id": "c1", "tractor_asset_id": "a1", "trailer_asset_id": "a2",
    })
    assert res.status_code == 200

    insert = next(c for c in pool.fetchval.call_args_list if "INSERT INTO app.trip_fleet_links" in c.args[0])
    assert "tractor_asset_id" in insert.args[0]
    assert "trailer_asset_id" in insert.args[0]
    assert "a1" in insert.args and "a2" in insert.args


def test_assign_fleet_link_looks_up_business_name_from_public_carriers():
    pool = make_pool()
    pool.fetchval.side_effect = ["trip-1", None, "link-1", "Transportes Sur Spa"]
    client = make_client(pool)

    res = client.post("/api/v1/trips/trip-1/fleet-link", json={"carrier_id": "c1"})
    assert res.status_code == 200

    lookup = next(c for c in pool.fetchval.call_args_list if "business_name" in c.args[0])
    assert "public.carriers" in lookup.args[0]
    assert "app.transporter_profiles" not in lookup.args[0]


def test_assign_fleet_link_requires_carrier_id():
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
    res = client.post("/api/v1/trips/trip-1/fleet-link", json={"carrier_id": "c1"})
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


# ── HU-04 (Fase 0): fleet_match_status / filtro ?fleet_match= ───────────────
# Antes, cuando un viaje no lograba cruzar con empresa/conductor, el caso se
# perdía en silencio (_auto_resolve_fleet_link retornaba None sin dejar
# rastro). Ahora fleet_match_status distingue MATCHED/UNMATCHED/MISMATCH y
# es filtrable — ver _FLEET_MATCH_CASE.

def test_trip_select_exposes_fleet_match_status():
    assert "fleet_match_status" in _TRIP_SELECT
    assert "UNMATCHED" in _TRIP_SELECT
    assert "MISMATCH" in _TRIP_SELECT


def test_trip_from_joins_driver_home_carrier_for_mismatch_detection():
    """Fase B (feedback post-weekly 2026-07-22): la empresa propia del
    conductor (para detectar MISMATCH) ahora viene resuelta directo de
    app.v_trip_fleet_resolution (resolved_driver_home_carrier_id) — no de
    un JOIN inline contra public.driver_assignments acá."""
    assert "app.v_trip_fleet_resolution" in _TRIP_FROM
    assert "vfr.resolved_driver_home_carrier_id" in _TRIP_FROM


def test_list_trips_fleet_match_unmatched_filters_by_case_expression():
    pool = make_pool()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    client = make_client(pool)

    res = client.get("/api/v1/trips?fleet_match=unmatched")

    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert _FLEET_MATCH_CASE in query
    params = pool.fetch.call_args_list[0].args[1:]
    assert "UNMATCHED" in params


def test_list_trips_fleet_match_mismatch_filters_by_case_expression():
    pool = make_pool()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    client = make_client(pool)

    res = client.get("/api/v1/trips?fleet_match=mismatch")

    assert res.status_code == 200
    params = pool.fetch.call_args_list[0].args[1:]
    assert "MISMATCH" in params


def test_list_trips_ignores_invalid_fleet_match_value():
    """_FLEET_MATCH_CASE siempre aparece una vez (fleet_match_status en el
    SELECT) — un valor inválido no debe agregar una segunda ocurrencia en el
    WHERE."""
    pool = make_pool()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    client = make_client(pool)

    res = client.get("/api/v1/trips?fleet_match=bogus")

    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert query.count(_FLEET_MATCH_CASE) == 1
