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
