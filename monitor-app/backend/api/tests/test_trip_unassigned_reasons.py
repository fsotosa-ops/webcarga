from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"  # SELECT id FROM app.trips (exists check)
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


def test_meta_exposes_active_unassigned_reasons_ordered_by_sort_order():
    pool = make_pool()
    pool.fetch.side_effect = [
        [], [], [], [],
        [{"id": "pana", "label": "Pana"}, {"id": "sin_conductor", "label": "Sin conductor"}],
    ]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/trips/meta")

    assert res.status_code == 200
    body = res.json()
    assert body["unassigned_reasons"] == [
        {"id": "pana", "label": "Pana"}, {"id": "sin_conductor", "label": "Sin conductor"},
    ]
    reasons_call = pool.fetch.call_args_list[-1]
    assert "app.unassigned_reasons" in reasons_call.args[0]
    assert "active = true" in reasons_call.args[0]


def test_patch_trip_persists_unassigned_reason_id():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"unassigned_reason_id": "pana"})
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "unassigned_reason_id = $" in update.args[0]
    assert "pana" in update.args


def test_patch_trip_clears_unassigned_reason_id_with_empty_string():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"unassigned_reason_id": ""})
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "unassigned_reason_id = $" in update.args[0]
    assert None in update.args
