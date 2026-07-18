from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router, _TRIP_SELECT
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


# ── Higienización 2026-07-17: activo/trabajando/asignado/primera_vuelta/
# estado_manual/observaciones/comentarios → is_active/is_working/is_assigned/
# is_first_leg/manual_status/notes/comments ──────────────────────────────────

def test_trip_select_exposes_english_column_names():
    assert "t.is_active" in _TRIP_SELECT
    assert "t.is_working" in _TRIP_SELECT
    assert "t.is_assigned" in _TRIP_SELECT
    assert "t.is_first_leg" in _TRIP_SELECT
    assert "t.manual_status" in _TRIP_SELECT
    assert "t.notes" in _TRIP_SELECT
    assert "t.comments" in _TRIP_SELECT
    assert "t.activo" not in _TRIP_SELECT
    assert "t.estado_manual" not in _TRIP_SELECT


def test_patch_trip_persists_bool_and_str_fields_with_english_names():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={
        "is_active": False, "is_working": True, "is_assigned": True, "is_first_leg": False,
        "manual_status": "EN PANA", "notes": "nota", "comments": "comentario",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    sql = update.args[0]
    for field in ("is_active", "is_working", "is_assigned", "is_first_leg",
                  "manual_status", "notes", "comments"):
        assert f"{field} = $" in sql
    assert False in update.args and True in update.args
    assert "EN PANA" in update.args and "nota" in update.args and "comentario" in update.args


def test_patch_trip_logs_system_note_on_manual_status():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"manual_status": "EN PANA"})
    assert res.status_code == 200
    note_insert = next(
        c for c in pool.execute.call_args_list
        if c.args[0].strip().startswith("INSERT INTO app.trip_notes")
    )
    assert "EN PANA" in note_insert.args[3]


def test_reset_field_accepts_english_field_names():
    pool = make_pool()
    client = make_client(pool)
    for field in ("is_active", "is_working", "is_assigned", "is_first_leg", "manual_status", "notes", "comments"):
        res = client.delete(f"/api/v1/trips/trip-1/overrides/{field}")
        assert res.status_code == 200, field


def test_reset_field_rejects_old_spanish_field_names():
    pool = make_pool()
    client = make_client(pool)
    for field in ("activo", "trabajando", "asignado", "primera_vuelta", "estado_manual"):
        res = client.delete(f"/api/v1/trips/trip-1/overrides/{field}")
        assert res.status_code == 422, field
