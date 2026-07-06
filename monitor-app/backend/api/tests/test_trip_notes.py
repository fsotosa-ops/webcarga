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

NOTE_ROW = {
    "id": "aaaaaaaa-0000-0000-0000-000000000001",
    "trip_id": "tttttttt-0000-0000-0000-000000000001",
    "author_id": USER["sub"],
    "author_name": "Operador Uno",
    "body": "Conductor confirmó por teléfono",
    "note_type": "llamada",
    "pinned": False,
    "created_at": "2026-07-05T12:00:00+00:00",
}


def make_supabase():
    sb = MagicMock()
    sb.storage.from_.return_value.upload.return_value = None
    sb.storage.from_.return_value.create_signed_url.return_value = {
        "signedURL": "https://signed.example/x"
    }
    return sb


def make_client(pool, authenticated=True, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: supabase or make_supabase()
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
    pool.fetch.return_value = []  # sin adjuntos
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "  Conductor confirmó por teléfono  ", "note_type": "llamada"},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["author_name"] == "Operador Uno"
    assert data["note_type"] == "llamada"
    assert data["attachments"] == []
    # el body se inserta trimmed y con el tipo
    insert_args = pool.fetchval.call_args_list[1].args
    assert "Conductor confirmó por teléfono" in insert_args
    assert "llamada" in insert_args


def test_add_note_empty_body_without_files_is_422():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "   "},
    )
    assert res.status_code == 422
    pool.fetchval.assert_not_called()


def test_add_note_sistema_type_is_forbidden():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "x", "note_type": "sistema"},
    )
    assert res.status_code == 403


def test_add_note_invalid_type_is_422():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "x", "note_type": "telegrama"},
    )
    assert res.status_code == 422


def test_add_note_missing_trip_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "hola"},
    )
    assert res.status_code == 404


def test_add_note_with_pdf_uploads_and_links_attachment():
    pool = AsyncMock()
    pool.fetchval.side_effect = [NOTE_ROW["trip_id"], NOTE_ROW["id"]]
    pool.fetchrow.return_value = NOTE_ROW
    pool.fetch.return_value = [{
        "id": "ff000000-0000-0000-0000-000000000001",
        "note_id": NOTE_ROW["id"],
        "storage_path": "x/y/z.pdf",
        "file_name": "guia.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 4,
    }]
    sb = make_supabase()
    client = make_client(pool, supabase=sb)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "adjunto guía"},
        files={"files": ("guia.pdf", b"%PDF", "application/pdf")},
    )
    assert res.status_code == 201
    data = res.json()
    assert data["attachments"][0]["file_name"] == "guia.pdf"
    assert data["attachments"][0]["url"] == "https://signed.example/x"
    sb.storage.from_.return_value.upload.assert_called_once()
    # se insertó la fila del adjunto
    assert any("trip_note_attachments" in str(c) for c in pool.execute.call_args_list)


def test_add_note_disallowed_mime_is_422_and_uploads_nothing():
    pool = AsyncMock()
    sb = make_supabase()
    client = make_client(pool, supabase=sb)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "x"},
        files={"files": ("virus.exe", b"MZ", "application/x-msdownload")},
    )
    assert res.status_code == 422
    sb.storage.from_.return_value.upload.assert_not_called()
    pool.fetchval.assert_not_called()


def test_note_only_attachment_without_body_is_allowed():
    pool = AsyncMock()
    pool.fetchval.side_effect = [NOTE_ROW["trip_id"], NOTE_ROW["id"]]
    pool.fetchrow.return_value = {**NOTE_ROW, "body": ""}
    pool.fetch.return_value = []
    client = make_client(pool)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        files={"files": ("foto.png", b"\x89PNG", "image/png")},
    )
    assert res.status_code == 201


def test_pin_note_toggles():
    pool = AsyncMock()
    pool.fetchval.return_value = NOTE_ROW["id"]
    client = make_client(pool)
    res = client.patch(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes/{NOTE_ROW['id']}/pin",
        json={"pinned": True},
    )
    assert res.status_code == 200
    assert res.json() == {"ok": True, "pinned": True}


def test_pin_missing_note_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.patch(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes/{NOTE_ROW['id']}/pin",
        json={"pinned": True},
    )
    assert res.status_code == 404


def test_notes_require_auth():
    pool = AsyncMock()
    client = make_client(pool, authenticated=False)
    res = client.get(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes")
    assert res.status_code in (401, 403)
    res = client.post(f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes", data={"body": "x"})
    assert res.status_code in (401, 403)


def test_attachment_storage_key_is_sanitized_but_original_name_kept():
    """Caso real: capturas de macOS traen U+202F y paréntesis — Storage
    respondía InvalidKey. La key se sanitiza; file_name en DB queda intacto."""
    import re as _re
    from app.routers.trips import _safe_storage_name

    # \u202f = espacio angosto (narrow no-break space) — el del error real
    ugly = "Captura de pantalla 2026-07-06 a la(s) 11.14.57\u202fa.m..png"
    safe = _safe_storage_name(ugly)
    assert safe == "Captura_de_pantalla_2026-07-06_a_la_s_11.14.57_a.m..png"
    # solo caracteres válidos para una key de Storage
    assert _re.fullmatch(r"[A-Za-z0-9._-]+", safe)
    assert _safe_storage_name("ñandú (final).pdf") == "nandu_final_.pdf"

    pool = AsyncMock()
    pool.fetchval.side_effect = [NOTE_ROW["trip_id"], NOTE_ROW["id"]]
    pool.fetchrow.return_value = NOTE_ROW
    pool.fetch.return_value = []
    sb = make_supabase()
    client = make_client(pool, supabase=sb)
    res = client.post(
        f"/api/v1/trips/{NOTE_ROW['trip_id']}/notes",
        data={"body": "screenshot"},
        files={"files": (ugly, b"\x89PNG", "image/png")},
    )
    assert res.status_code == 201
    upload_key = sb.storage.from_.return_value.upload.call_args.args[0]
    # key = {trip_id}/{note_id}/{hex}_{nombre_sanitizado} — todo válido para Storage
    assert _re.fullmatch(r"[A-Za-z0-9._/-]+", upload_key)
    # la fila del adjunto conserva el nombre original para la UI
    attach_insert = next(c for c in pool.execute.call_args_list if "trip_note_attachments" in c.args[0])
    assert ugly in attach_insert.args
