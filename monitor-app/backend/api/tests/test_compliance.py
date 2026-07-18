from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.compliance import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def test_get_record_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1")

    assert res.status_code == 404


def test_patch_record_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "expiration_date": None}
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-records/r1", json={})

    assert res.status_code == 422


def test_patch_record_approves_manually_and_sets_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "expiration_date": None}
    pool.fetchrow.return_value = {
        "id": "r1", "entity_id": "c1", "entity_type": "CARRIER", "requirement_id": "req1",
        "requirement_code": "F30_MULTAS", "name": "F30", "requirement_level": "LEGAL_MANDATORY",
        "requires_file": True, "status": "APPROVED_MANUAL", "expiration_date": None, "file_url": None,
        "metadata": {}, "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/compliance-records/r1", json={"status": "APPROVED_MANUAL"})

    assert res.status_code == 200
    assert res.json()["status"] == "APPROVED_MANUAL"
    override_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.compliance_records" in override_sql
    override_flag_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_flag_sql


def test_upload_file_404_when_record_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 404


def test_upload_file_rejects_disallowed_mime():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {},
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("virus.exe", b"MZ", "application/x-msdownload")},
    )

    assert res.status_code == 422


def test_upload_file_forces_approved_manual_and_persists_metadata():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "metadata": {},
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    body = res.json()
    assert body["status"] == "APPROVED_MANUAL"
    assert body["file_name"] == "licencia.pdf"

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "status = 'APPROVED_MANUAL'" in update_sql
    assert "metadata = $3::jsonb" in update_sql

    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql

    # sin storage_path previo -> no debe intentar loguear un reemplazo
    audit_sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert not any("document_replace" in s for s in audit_sqls)


def test_upload_file_logs_replacement_when_previous_file_existed():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "expiration_date": None, "metadata": {"storage_path": "carrier/c1/r1/old_x.pdf"},
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    # dos INSERT a audit_log: uno de record_manual_edit (document_upload) y
    # uno de log_document_replacement (document_replace, por el archivo previo)
    audit_calls = [c for c in conn.execute.call_args_list if "public.audit_log" in c.args[0]]
    assert len(audit_calls) == 2
    assert any("document_replace" in c.args[0] for c in audit_calls)


def test_delete_file_404_when_record_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 404


def test_delete_file_422_when_no_file_loaded():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING", "metadata": {},
    }
    client = make_client(pool)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 422


def test_delete_file_resets_to_missing_and_removes_from_storage():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "metadata": {"storage_path": "carrier/c1/r1/x.pdf"},
    }
    pool.fetchrow.return_value = {
        "id": "r1", "entity_id": "c1", "entity_type": "CARRIER", "requirement_id": "req1",
        "requirement_code": "F30_MULTAS", "name": "F30", "requirement_level": "LEGAL_MANDATORY",
        "requires_file": True, "status": "MISSING", "expiration_date": None, "file_url": None,
        "metadata": {}, "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/compliance-records/r1/file")

    assert res.status_code == 200
    assert res.json()["status"] == "MISSING"
    supabase.storage.from_.return_value.remove.assert_called_once_with(["carrier/c1/r1/x.pdf"])

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "status = 'MISSING'" in update_sql
    assert "file_url = NULL" in update_sql

    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql


def test_list_compliance_files_404_when_record_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 404


def test_list_compliance_files_uses_synthetic_doc_name():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER"}
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_call = pool.fetch.call_args
    assert fetch_call.args[3] == "compliance_record:r1"
