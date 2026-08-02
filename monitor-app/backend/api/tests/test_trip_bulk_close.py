"""Selección masiva en el Diario para cerrar/finalizar varios viajes de una
(pedido explícito del usuario, 2026-08-02) — mismo mecanismo que ya usa
IndicatorSwitches por viaje individual (is_active/is_working=false,
protegido de que Mage lo pise vía manually_edited_fields), en lote."""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.trips import router

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_bulk_close_422_when_no_trip_ids():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": []})
    assert res.status_code == 422


def test_bulk_close_404_when_a_trip_is_missing():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    client = make_client(pool)
    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": ["t1", "t2"]})
    assert res.status_code == 404
    assert "t2" in res.json()["detail"]


def test_bulk_close_sets_is_active_and_is_working_false_for_all_selected():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": "t1", "manually_edited_fields": []},
        {"id": "t2", "manually_edited_fields": []},
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": ["t1", "t2"]})

    assert res.status_code == 200
    assert res.json() == {"ok": True, "closed": 2}
    update = next(c for c in pool.execute.call_args_list if c.args[0].strip().startswith("UPDATE app.trips"))
    sql = update.args[0]
    assert "is_active = false" in sql
    assert "is_working = false" in sql
    assert "manually_edited_fields" in sql
    assert update.args[1] == ["t1", "t2"]


def test_bulk_close_logs_a_system_note_per_trip():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    client = make_client(pool)

    client.patch("/api/v1/trips/bulk-close", json={"trip_ids": ["t1"]})

    note_calls = [c for c in pool.execute.call_args_list if "app.trip_notes" in c.args[0]]
    assert len(note_calls) == 1
    assert "selección masiva" in note_calls[0].args[3]


def test_bulk_close_route_does_not_collide_with_single_trip_patch():
    """Regresión: /bulk-close debe matchear como ruta literal, no como
    PATCH /{trip_id} con trip_id='bulk-close' — se declaró antes en el
    router justamente por esto."""
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    client = make_client(pool)

    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": ["t1"]})

    assert res.status_code == 200
    assert "closed" in res.json()
