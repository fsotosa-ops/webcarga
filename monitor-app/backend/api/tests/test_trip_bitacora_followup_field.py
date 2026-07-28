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
    pool.fetchval.return_value = "trip-1"
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "last_human_note_at": "2026-07-28T10:00:00+00:00"}
    pool.fetch.return_value = []  # _load_trip_stops / _load_operation_type_buckets
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_trip_select_queries_last_human_note_at():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "last_human_note_at" in query
    assert "note_type != 'sistema'" in query


def test_get_trip_endpoint_returns_last_human_note_at():
    pool = make_pool()
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["last_human_note_at"] == "2026-07-28T10:00:00+00:00"


def test_get_trip_endpoint_returns_null_when_no_human_notes():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "last_human_note_at": None}
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.json()["last_human_note_at"] is None
