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


def test_pending_summary_aggregates_by_carrier():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "operational_status": "ACTIVE",
         "pending_count": 12, "pending_mandatory": 5},
        {"carrier_id": "c2", "carrier_name": "Rios Ltda", "operational_status": "ACTIVE",
         "pending_count": 3, "pending_mandatory": 0},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending-summary")

    assert res.status_code == 200
    body = res.json()
    assert body["total_pending"] == 15
    assert body["total_pending_mandatory"] == 5
    assert len(body["carriers"]) == 2
    query = pool.fetch.call_args.args[0]
    assert "status IN ('MISSING', 'EXPIRED')" in query


def test_pending_summary_empty_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending-summary")

    assert res.status_code == 200
    assert res.json() == {"total_pending": 0, "total_pending_mandatory": 0, "carriers": []}


def test_pending_summary_route_does_not_collide_with_record_id_path():
    """La ruta fija /pending-summary debe declararse antes de /{record_id} —
    si no, FastAPI la matchearía como record_id='pending-summary' y llamaría
    a get_compliance_record en su lugar."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending-summary")

    assert res.status_code == 200
    assert "carriers" in res.json()
    pool.fetchrow.assert_not_called()


def _pending_row(**overrides):
    base = {
        "id": "r1", "entity_type": "DRIVER", "entity_id": "d1", "subject_name": "Juan Perez",
        "requirement_code": "LICENCIA_CONDUCIR", "document_name": "Licencia conducir",
        "requirement_level": "LEGAL_MANDATORY", "status": "MISSING", "expiration_date": None,
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "carrier_tax_id": "76.111.111-1",
        "carrier_operation_types": ["Tractoreo"], "total_count": 1,
    }
    base.update(overrides)
    return base


def test_pending_rows_route_does_not_collide_with_record_id_path():
    """Mismo cuidado que /pending-summary: /pending debe declararse antes de
    /{record_id}."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200
    assert "rows" in res.json()
    pool.fetchrow.assert_not_called()


def test_pending_rows_empty_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.status_code == 200
    assert res.json() == {"total": 0, "rows": []}


def test_pending_rows_maps_categories_and_certification_type():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _pending_row(id="r1", entity_type="CARRIER", subject_name=None, requirement_level="LEGAL_MANDATORY"),
        _pending_row(id="r2", entity_type="DRIVER", subject_name="Juan Perez", requirement_level="SHIPPER_REQUIRED"),
        _pending_row(id="r3", entity_type="ASSET", subject_name="ABCD12", requirement_level="CONDITIONAL_OPTIONAL"),
    ]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    rows = res.json()["rows"]
    assert rows[0]["category"] == "EMPRESA" and rows[0]["certification_type"] == "BASICA"
    assert rows[1]["category"] == "CHOFER" and rows[1]["certification_type"] == "ADICIONAL"
    assert rows[2]["category"] == "EQUIPO" and rows[2]["certification_type"] == "ADICIONAL"


def test_pending_rows_includes_carrier_operation_types():
    pool = AsyncMock()
    pool.fetch.return_value = [_pending_row(carrier_operation_types=["Tractoreo", "Equipo Completo"])]
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/pending")

    assert res.json()["rows"][0]["carrier_operation_types"] == ["Tractoreo", "Equipo Completo"]


def test_pending_rows_passes_filters_to_query():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get(
        "/api/v1/compliance-records/pending"
        "?carrier_id=c1&category=DRIVER&requirement_code=LICENCIA_CONDUCIR"
        "&q=juan&operation_type=Tractoreo&limit=10&offset=5"
    )

    args = pool.fetch.call_args.args
    assert args[1] == "c1"
    assert args[2] == "DRIVER"
    assert args[3] == "LICENCIA_CONDUCIR"
    assert args[4] == "juan"
    assert args[5] == "Tractoreo"
    assert args[6] == 10
    assert args[7] == 5


def test_bulk_upload_422_when_files_and_record_ids_length_mismatch():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r2"]},
        files=[("files", ("a.pdf", b"x", "application/pdf"))],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_empty():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1"},
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_over_max_files():
    pool = AsyncMock()
    client = make_client(pool)
    n = 31
    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": [f"r{i}" for i in range(n)]},
        files=[("files", (f"a{i}.pdf", b"x", "application/pdf")) for i in range(n)],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_duplicate_record_ids():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r1"]},
        files=[
            ("files", ("a.pdf", b"x", "application/pdf")),
            ("files", ("b.pdf", b"y", "application/pdf")),
        ],
    )

    assert res.status_code == 422


def test_bulk_upload_422_when_record_belongs_to_different_carrier():
    pool = AsyncMock()
    pool.fetch.return_value = [{"record_id": "r1", "resolved_carrier_id": "c2"}]
    client = make_client(pool)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1"]},
        files=[("files", ("a.pdf", b"x", "application/pdf"))],
    )

    assert res.status_code == 422
    assert "r1" in res.json()["detail"]


def test_bulk_upload_partial_failure_rejects_only_bad_file():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [
        {"record_id": "r1", "resolved_carrier_id": "c1"},
        {"record_id": "r2", "resolved_carrier_id": "c1"},
    ]
    pool.fetchrow.return_value = {
        "entity_id": "d1", "entity_type": "DRIVER", "status": "MISSING",
        "expiration_date": None, "metadata": {},
    }
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/compliance-records/bulk-file",
        data={"carrier_id": "c1", "record_ids": ["r1", "r2"]},
        files=[
            ("files", ("licencia.pdf", b"contenido", "application/pdf")),
            ("files", ("virus.exe", b"MZ", "application/x-msdownload")),
        ],
    )

    assert res.status_code == 200
    body = res.json()
    assert len(body["uploaded"]) == 1
    assert body["uploaded"][0]["record_id"] == "r1"
    assert len(body["errors"]) == 1
    assert body["errors"][0]["record_id"] == "r2"


def test_list_compliance_files_404_when_record_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 404


def test_list_compliance_files_uses_synthetic_doc_name():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
        "expiration_date": None, "file_url": None, "updated_at": None, "overridden_by": None,
    }
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_call = pool.fetch.call_args
    assert fetch_call.args[3] == "compliance_record:r1"


def test_list_compliance_files_includes_current_version_never_replaced():
    """Bug real corregido 2026-07-21 (detectado en vivo por Fabián el 20/07):
    un documento subido una sola vez, nunca reemplazado, no aparecía en su
    propio historial pese a tener un archivo real cargado."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "status": "APPROVED_MANUAL",
        "expiration_date": None, "file_url": "carrier/c1/r1/x.pdf",
        "updated_at": None, "overridden_by": "user-1",
    }
    pool.fetch.return_value = []  # sin reemplazos en audit_log
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example/current"}
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/compliance-records/r1/files")

    assert res.status_code == 200
    body = res.json()
    assert len(body) == 1
    assert body[0]["storage_path"] == "carrier/c1/r1/x.pdf"
    assert body[0]["is_current"] is True
    assert body[0]["url"] == "https://signed.example/current"
