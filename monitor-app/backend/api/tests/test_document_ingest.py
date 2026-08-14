"""Bandeja de documentos sin clasificar (HU-01).

El archivo entra sin declarar a qué requisito pertenece y espera en staging
hasta que una persona lo clasifica. La invariante que estos tests protegen:
NADA toca public.compliance_records hasta la clasificación explícita.
"""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.document_ingest import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def _storage_ok():
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


# ── Subida a la bandeja ────────────────────────────────────────────────────

def test_upload_lands_files_in_tray_without_touching_compliance():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-1"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "IMG_4905.PNG", "mime_type": "image/png",
        "size_bytes": 9, "storage_path": "staging/batch-1/x_IMG_4905.PNG",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/c1/files",
        files=[("files", ("IMG_4905.PNG", b"contenido", "image/png"))],
    )

    assert res.status_code == 201
    body = res.json()
    assert body["batch_id"] == "batch-1"
    assert body["items"][0]["match_status"] == "UNMATCHED"
    # La invariante: el archivo entra sin tocar el motor de cumplimiento.
    all_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "compliance_records" not in all_sql


def test_upload_rejects_invalid_mime_without_dropping_the_rest():
    """Exito parcial: un archivo invalido no tumba el resto del lote."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-1"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "ok.pdf", "mime_type": "application/pdf",
        "size_bytes": 9, "storage_path": "staging/batch-1/x_ok.pdf",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/c1/files",
        files=[
            ("files", ("virus.exe", b"MZ", "application/x-msdownload")),
            ("files", ("ok.pdf", b"contenido", "application/pdf")),
        ],
    )

    assert res.status_code == 201
    body = res.json()
    assert len(body["items"]) == 1
    assert len(body["errors"]) == 1
    assert body["errors"][0]["file_name"] == "virus.exe"


def test_upload_requires_at_least_one_file():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/document-ingest/c1/files", files=[])

    assert res.status_code == 422


# ── Bandeja: listar ────────────────────────────────────────────────────────

def test_list_tray_returns_only_unclassified_with_preview_url():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "item-1", "file_name": "IMG_4905.PNG", "mime_type": "image/png",
        "size_bytes": 9, "storage_path": "staging/b1/x.png", "match_status": "UNMATCHED",
    }]
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://x/y"}
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/document-ingest/c1/items")

    assert res.status_code == 200
    assert res.json()[0]["preview_url"] == "https://x/y"
    assert "UNMATCHED" in pool.fetch.call_args.args[0]


# ── Bandeja: clasificar ────────────────────────────────────────────────────

def _item_row(match_status="UNMATCHED"):
    return {
        "storage_path": "staging/b1/x.png", "file_name": "IMG_4905.PNG",
        "mime_type": "image/png", "size_bytes": 9, "match_status": match_status,
    }


def _record_row(record_id="rec-1"):
    return {
        "id": record_id, "entity_id": "a1", "entity_type": "ASSET",
        "status": "MISSING", "expiration_date": None,
    }


def test_classify_applies_the_file_to_the_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_item_row(), _record_row()]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1",
              "requirement_id": "req-1", "expiration_date": "2027-03-31"},
    )

    assert res.status_code == 200
    assert res.json()["compliance_record_id"] == "rec-1"
    all_sql = " ".join(str(c.args[0]) for c in conn.execute.call_args_list)
    assert "compliance_records" in all_sql
    assert "COMMITTED" in all_sql


def test_same_file_can_cover_several_requirements():
    """Caso real del PDF unificado: padron + permiso + revision en un archivo.

    Pablo lo mostro en pantalla: 'puedo pedir que lo desunifiquen, o cargar
    tres veces el mismo archivo'. Se resuelve sin duplicar el blob.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # El item YA fue clasificado antes (COMMITTED), no UNMATCHED
    conn.fetchrow.side_effect = [_item_row("COMMITTED"), _record_row("rec-2")]
    conn.fetchval.return_value = False   # el requisito no exige vencimiento
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-2"},
    )

    assert res.status_code == 200
    assert res.json()["compliance_record_id"] == "rec-2"


def test_classify_409_when_item_was_discarded():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = _item_row("DISCARDED")
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 409


def test_classify_404_when_item_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/nope/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 404


def test_classify_404_when_entity_lacks_that_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_item_row(), None]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-inexistente"},
    )

    assert res.status_code == 404


def test_classify_422_when_requirement_needs_expiration_and_none_given():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [_item_row(), _record_row()]
    conn.fetchval.return_value = True   # has_expiration
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/item-1/classify",
        json={"entity_type": "ASSET", "entity_id": "a1", "requirement_id": "req-1"},
    )

    assert res.status_code == 422


# ── Bandeja: eliminar ──────────────────────────────────────────────────────

def test_delete_item_marks_discarded_and_removes_the_blob():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"storage_path": "staging/b1/x.png"}
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/document-ingest/items/item-1")

    assert res.status_code == 204
    assert "DISCARDED" in conn.execute.call_args.args[0]
    supabase.storage.from_.return_value.remove.assert_called_once_with(["staging/b1/x.png"])


def test_delete_item_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/document-ingest/items/nope")

    assert res.status_code == 404
