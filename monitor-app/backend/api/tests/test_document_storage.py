import json

import pytest
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.utils.document_storage import (
    upload_document_version, log_document_replacement, get_document_history,
)


@pytest.mark.asyncio
async def test_upload_document_version_returns_new_path_no_db_write():
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/pdf"
    file.filename = "licencia.pdf"

    async def fake_read():
        return b"contenido"
    file.read = fake_read

    result = await upload_document_version(
        supabase, key_prefix="driver/abc-123/licencia", file=file,
    )

    assert result["file_name"] == "licencia.pdf"
    assert result["mime_type"] == "application/pdf"
    assert result["size_bytes"] == len(b"contenido")
    assert result["storage_path"].startswith("driver/abc-123/licencia/")
    assert "licencia.pdf" in result["storage_path"]
    supabase.storage.from_.assert_called_with("compliance-docs")


@pytest.mark.asyncio
async def test_upload_document_version_two_calls_produce_different_paths():
    """Cada reemplazo debe ir a una ruta NUEVA — nunca se sobrescribe el blob anterior."""
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/pdf"
    file.filename = "licencia.pdf"

    async def fake_read():
        return b"v1"
    file.read = fake_read

    r1 = await upload_document_version(supabase, key_prefix="driver/abc-123/licencia", file=file)

    async def fake_read2():
        return b"v2"
    file.read = fake_read2

    r2 = await upload_document_version(supabase, key_prefix="driver/abc-123/licencia", file=file)

    assert r1["storage_path"] != r2["storage_path"]


@pytest.mark.asyncio
async def test_upload_document_version_rejects_disallowed_mime():
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/zip"
    file.filename = "archivo.zip"

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await upload_document_version(supabase, key_prefix="x", file=file)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_log_document_replacement_inserts_audit_row_with_old_values():
    pool = AsyncMock()

    await log_document_replacement(
        pool, entity_type="driver", entity_id="abc-123", doc_name="licencia",
        old_status="ok", old_expiry_date=date(2026, 1, 1), old_storage_path="driver/abc-123/licencia/v1_x.pdf",
        actor="user-1",
    )

    pool.execute.assert_called_once()
    call_args = pool.execute.call_args
    assert "public.audit_log" in call_args[0][0]
    assert "document_replace" in call_args[0][0]

    actor, entity_type, entity_id, doc_name, old_value_json = call_args[0][1:]
    assert actor == "user-1"
    assert entity_type == "driver"
    assert entity_id == "abc-123"
    assert doc_name == "licencia"
    old_value = json.loads(old_value_json)
    assert old_value == {
        "status": "ok",
        "expiry_date": "2026-01-01",
        "storage_path": "driver/abc-123/licencia/v1_x.pdf",
    }


@pytest.mark.asyncio
async def test_get_document_history_returns_prior_versions_with_signed_url():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "old_value": '{"status": "ok", "expiry_date": "2026-01-01", "storage_path": "driver/abc-123/licencia/v1_x.pdf"}',
        "occurred_at": datetime(2026, 1, 5, tzinfo=timezone.utc),
        "actor": "user-1",
    }]
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example/x"}

    result = await get_document_history(
        pool, supabase, entity_type="driver", entity_id="abc-123", doc_name="licencia",
    )

    assert len(result) == 1
    assert result[0]["storage_path"] == "driver/abc-123/licencia/v1_x.pdf"
    assert result[0]["status"] == "ok"
    assert result[0]["url"] == "https://signed.example/x"
    assert result[0]["replaced_by"] == "user-1"
    assert result[0]["is_current"] is False


@pytest.mark.asyncio
async def test_get_document_history_prepends_current_version_before_replacements():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "old_value": '{"status": "ok", "expiry_date": "2026-01-01", "storage_path": "driver/abc-123/licencia/v1_x.pdf"}',
        "occurred_at": datetime(2026, 1, 5, tzinfo=timezone.utc),
        "actor": "user-1",
    }]
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example/current"}

    result = await get_document_history(
        pool, supabase, entity_type="driver", entity_id="abc-123", doc_name="licencia",
        current_storage_path="driver/abc-123/licencia/v2_y.pdf",
        current_status="ok",
        current_expiry_date=date(2026, 6, 1),
        current_updated_at=datetime(2026, 1, 10, tzinfo=timezone.utc),
        current_actor="user-2",
    )

    assert len(result) == 2
    assert result[0]["storage_path"] == "driver/abc-123/licencia/v2_y.pdf"
    assert result[0]["is_current"] is True
    assert result[0]["expiry_date"] == "2026-06-01"
    assert result[1]["storage_path"] == "driver/abc-123/licencia/v1_x.pdf"
    assert result[1]["is_current"] is False


@pytest.mark.asyncio
async def test_get_document_history_no_current_when_never_uploaded():
    pool = AsyncMock()
    pool.fetch.return_value = []
    supabase = MagicMock()

    result = await get_document_history(
        pool, supabase, entity_type="driver", entity_id="abc-123", doc_name="licencia",
    )

    assert result == []
