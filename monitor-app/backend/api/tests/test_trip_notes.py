from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router
from app.db import get_pool
from app.auth import get_current_user, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}

NOTE_ROW = {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "trip_id": "tttttttt-0000-0000-0000-000000000001",
    "author_id": USER["sub"],
    "author_name": "Operador Uno",
    "body": "Conductor confirmó por teléfono",
    "created_at": "2026-07-05T12:00:00+00:00",
}


def make_client(pool, authenticated=True):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    if authenticated:
        app.dependency_overrides[get_current_user] = lambda: USER
        app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_list_notes_empty():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)
    res = client.get(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes")
    assert res.status_code == 200
    assert res.json() == []


def test_add_note_returns_created_note_with_author():
    pool = AsyncMock()
    # 1ra llamada: viaje existe; 2da: RETURNING id del insert
    pool.fetchval.side_effect = [NOTE_ROW["trip_id"], NOTE_ROW["id"]]
    pool.fetchrow.return_value = NOTE_ROW
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        json={"body": "  Conductor confirmó por teléfono  "},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["author_name"] == "Operador Uno"
    assert data["body"] == NOTE_ROW["body"]
    # el body se inserta trimmed
    insert_args = pool.fetchval.call_args_list[1].args
    assert insert_args[-1] == "Conductor confirmó por teléfono"


def test_add_note_empty_body_is_422():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        json={"body": "   "},
    )
    assert res.status_code == 422
    pool.fetchval.assert_not_called()


def test_add_note_missing_trip_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        json={"body": "hola"},
    )
    assert res.status_code == 404


def test_notes_require_auth():
    pool = AsyncMock()
    client = make_client(pool, authenticated=False)
    res = client.get(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes")
    assert res.status_code in (401, 403)
    res = client.post(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes", json={"body": "x"})
    assert res.status_code in (401, 403)
