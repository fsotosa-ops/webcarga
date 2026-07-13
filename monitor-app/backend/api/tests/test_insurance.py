"""Tests del módulo Seguros (app/routers/insurance.py). Mismo patrón de mocks
que tests/test_transporters_relational.py."""
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_admin, require_editor
from app.db import get_pool
from app.routers.insurance import router

USER_ID = "11111111-1111-1111-1111-111111111111"


def make_client(pool, role="admin", enforce_roles=False, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    user = {"sub": USER_ID, "email": "operador@webcarga.cl", "role": role}
    app.dependency_overrides[get_current_user] = lambda: user
    if not enforce_roles:
        app.dependency_overrides[require_editor] = lambda: user
        app.dependency_overrides[require_admin] = lambda: user
    return TestClient(app)


# ── PATCH cuota: marca manual_override ──────────────────────────────

def test_patch_installment_marks_manual_override():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"updated_at": None},  # SELECT current (optimistic lock check)
        {
            "id": "i1", "policy_id": "p1", "installment_number": 1, "total_installments": 2,
            "amount_uf": 3.5, "due_date": date(2026, 8, 1), "status": "pagada",
            "paid_at": date(2026, 7, 9), "payment_url": None, "manual_override": True,
            "updated_by": USER_ID, "updated_at": datetime.now(timezone.utc),
        },
    ]
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/installments/i1", json={
        "status": "pagada", "paid_at": "2026-07-09",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["manual_override"] is True
    assert data["status"] == "pagada"
    update_sql = pool.fetchrow.call_args_list[1].args[0]
    assert "manual_override = true" in update_sql


def test_patch_installment_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.patch("/api/v1/insurance/installments/i1", json={"status": "pagada"})
    assert res.status_code == 403
    pool.fetchrow.assert_not_called()


def test_patch_installment_stale_expected_updated_at_is_409():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc)}
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/installments/i1", json={
        "status": "pagada", "expected_updated_at": "2026-06-01T00:00:00Z",
    })
    assert res.status_code == 409


def test_patch_installment_missing_is_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/installments/i1", json={"status": "pagada"})
    assert res.status_code == 404


# ── Summary ───────────────────────────────────────────────────────

def test_insurance_summary_shape():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "rut": "12345678-9", "business_name": "Transportes Test", "transporter_id": None,
        "policies_count": 2, "next_due_date": date(2026, 8, 1), "next_due_amount_uf": 4.2,
        "overdue_count": 1, "paid_pct": 50.0, "insurance_ok": False,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/summary")
    assert res.status_code == 200
    row = res.json()["data"][0]
    assert row["next_due"] == {"date": "2026-08-01", "amount_uf": 4.2}
    assert row["overdue_count"] == 1
    assert row["insurance_ok"] is False


# ── Upload: rechaza mime no permitido ───────────────────────────────

def test_upload_policy_file_rejects_bad_mime():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"storage_path": None}  # policy exists, sin archivo previo
    client = make_client(pool)
    res = client.post(
        "/api/v1/insurance/policies/p1/file",
        files={"file": ("virus.exe", b"MZ", "application/x-msdownload")},
    )
    assert res.status_code == 422


def test_upload_policy_file_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.post(
        "/api/v1/insurance/policies/p1/file",
        files={"file": ("poliza.pdf", b"%PDF", "application/pdf")},
    )
    assert res.status_code == 404


def test_upload_policy_file_logs_replacement_when_storage_path_exists():
    # Repunte a document_storage (Task 5 extra scope): archivo previo debe
    # loguearse en audit_log antes de sobrescribir storage_path, mismo
    # patrón que upload_policy_document_file y transporters.py.
    pool = AsyncMock()
    pool.fetchrow.return_value = {"storage_path": "insurance/p1/old_x.pdf"}
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/insurance/policies/p1/file",
        files={"file": ("poliza.pdf", b"%PDF", "application/pdf")},
    )

    assert res.status_code == 200
    audit_calls = [c for c in pool.execute.call_args_list if "app.audit_log" in c.args[0]]
    assert audit_calls and "document_replace" in audit_calls[0].args[0]
    update_call = [c for c in pool.execute.call_args_list if "app.insurance_policies" in c.args[0]][0]
    assert "app.stored_files" not in update_call.args[0]


def test_list_policy_files_queries_audit_log_not_stored_files():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # policy exists
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/insurance/policies/p1/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_sql = pool.fetch.call_args.args[0]
    assert "app.audit_log" in fetch_sql
    assert "app.stored_files" not in fetch_sql
    assert pool.fetch.call_args.args[3] == "policy_file"


def test_list_policy_files_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/files")
    assert res.status_code == 404


def test_insurance_requires_auth():
    pool = AsyncMock()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    client = TestClient(app)
    res = client.get("/api/v1/insurance/summary")
    assert res.status_code in (401, 403)


# ── Documentos de póliza ─────────────────────────────────────────

def test_list_policy_documents_merges_catalog_with_existing():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # policy exists
    pool.fetch.return_value = [
        {"policy_id": "p1", "doc_name": "poliza_firmada", "status": "ok",
         "expiry_date": None, "file_url": None, "storage_path": "x",
         "notes": None, "manual_override": True, "updated_by": USER_ID,
         "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc)},
    ]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 200
    docs = res.json()
    # Catálogo estático (4 doc_code) mergeado con la única fila existente
    assert [d["doc_code"] for d in docs] == ["poliza_firmada", "certificado_vigencia", "endoso", "comprobante_pago"]
    assert docs[0]["status"] == "ok"
    assert docs[0]["label"] == "Póliza firmada"
    assert docs[0]["has_expiry"] is False
    assert docs[1]["status"] is None  # certificado_vigencia: sin fila -> merge con None
    assert docs[1]["has_expiry"] is True
    fetch_sql = pool.fetch.call_args.args[0]
    assert "app.insurance_policy_documents" in fetch_sql
    assert "app.insurance_doc_catalog" not in fetch_sql
    assert "app.insurance_documents" not in fetch_sql


def test_list_policy_documents_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 404


def test_patch_policy_document_upserts_and_requires_editor():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # solo se usa para el exists-check de la póliza
    pool.fetchrow.return_value = {
        "policy_id": "p1", "doc_name": "poliza_firmada", "status": "ok",
        "expiry_date": None, "file_url": None, "storage_path": None, "notes": None,
        "manual_override": True, "updated_by": USER_ID, "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
    }
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert res.json()["doc_code"] == "poliza_firmada"


def test_patch_policy_document_requires_editor():
    pool = AsyncMock()
    client = make_client(pool, role="viewer", enforce_roles=True)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 403


def test_patch_policy_document_invalid_doc_code_is_422():
    # El catálogo ahora es una lista estática en Python (INSURANCE_DOC_CATALOG):
    # doc_code inválido se rechaza antes de tocar la base de datos.
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/no_existe", json={"status": "ok"})
    assert res.status_code == 422
    pool.fetchval.assert_not_called()
    pool.fetchrow.assert_not_called()


def test_upload_policy_document_file_invalid_doc_code_is_422():
    # Mismo orden de validación que patch_policy_document: catálogo (422)
    # antes que existencia de la póliza (404), incluso si ambas son inválidas.
    # Catálogo estático en Python -> sin llamadas a la base de datos.
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post(
        "/api/v1/insurance/policies/p1/documents/no_existe/file",
        files={"file": ("doc.pdf", b"%PDF", "application/pdf")},
    )
    assert res.status_code == 422
    pool.fetchval.assert_not_called()
    pool.fetchrow.assert_not_called()


# ── Documentos de póliza: repunte a app.insurance_policy_documents ─
# Estos tests existen para que un futuro desfase de schema como el que
# motivó este task (helpers apuntando a app.insurance_documents /
# app.insurance_doc_catalog, dropeadas en Checkpoint A) se detecte en CI
# vía el mock, sin depender de Supabase real.

def test_upsert_insurance_document_uses_insurance_policy_documents_table():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "policy_id": "p1", "doc_name": "poliza_firmada", "status": "ok",
        "expiry_date": None, "file_url": None, "storage_path": None, "notes": None,
        "manual_override": True, "updated_by": USER_ID, "updated_at": None,
    }
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 200
    upsert_sql = pool.fetchrow.call_args.args[0]
    assert "app.insurance_policy_documents" in upsert_sql
    assert "app.insurance_documents" not in upsert_sql
    assert "app.insurance_doc_catalog" not in upsert_sql


def test_upload_policy_document_file_uses_document_storage_and_logs_replacement():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # policy exists
    pool.fetchrow.side_effect = [
        {"status": "ok", "expiry_date": None, "storage_path": "insurance/p1/poliza_firmada/old.pdf"},  # current
        {"policy_id": "p1", "doc_name": "poliza_firmada", "status": "ok", "expiry_date": None,
         "file_url": None, "storage_path": "insurance/p1/poliza_firmada/new.pdf", "notes": None,
         "manual_override": True, "updated_by": USER_ID, "updated_at": None},  # upsert RETURNING
    ]
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/insurance/policies/p1/documents/poliza_firmada/file",
        files={"file": ("poliza.pdf", b"%PDF", "application/pdf")},
    )

    assert res.status_code == 200
    current_lookup_sql = pool.fetchrow.call_args_list[0].args[0]
    upsert_sql = pool.fetchrow.call_args_list[1].args[0]
    assert "app.insurance_policy_documents" in current_lookup_sql
    assert "app.insurance_policy_documents" in upsert_sql
    audit_calls = [c for c in pool.execute.call_args_list if "app.audit_log" in c.args[0]]
    assert audit_calls and "document_replace" in audit_calls[0].args[0]


def test_list_policy_document_files_queries_audit_log():
    pool = AsyncMock()
    pool.fetchval.return_value = "p1"  # policy exists
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/insurance/policies/p1/documents/poliza_firmada/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_sql = pool.fetch.call_args.args[0]
    assert "app.audit_log" in fetch_sql
    assert "app.insurance_documents" not in fetch_sql
    assert pool.fetch.call_args.args[3] == "poliza_firmada"


# ── Cuotas planas (Cobranza) ─────────────────────────────────────

def test_list_installments_flat_shape():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "installment_id": "i1", "policy_id": "p1", "transporter_id": "t1", "rut": "12345678-9",
        "business_name": "Transportes Test", "company": "HDI", "policy_number": "4821-A",
        "client_group": "Walmart", "installment_number": 2, "amount_uf": 4.2,
        "due_date": date(2026, 7, 3), "status": "vencida", "is_overdue": True,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/installments")
    assert res.status_code == 200
    row = res.json()[0]
    assert row["business_name"] == "Transportes Test"
    assert row["is_overdue"] is True
    assert row["amount_uf"] == 4.2


# ── KPIs de Pólizas ───────────────────────────────────────────────

def test_insurance_kpis_shape():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "expiring_30d": 3, "without_policies": 7, "incomplete_docs": 5,
    }
    client = make_client(pool)
    res = client.get("/api/v1/insurance/kpis")
    assert res.status_code == 200
    body = res.json()
    assert body == {"expiring_30d": 3, "without_policies": 7, "incomplete_docs": 5}


def test_insurance_kpis_incomplete_cte_uses_static_catalog_not_dropped_table():
    # La CTE `incomplete` ya no hace CROSS JOIN app.insurance_doc_catalog
    # (dropeada por Checkpoint A): ahora usa unnest() sobre el catálogo
    # estático INSURANCE_DOC_CATALOG, pasado como parámetro $1.
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "expiring_30d": 0, "without_policies": 0, "incomplete_docs": 0,
    }
    client = make_client(pool)
    res = client.get("/api/v1/insurance/kpis")
    assert res.status_code == 200
    call = pool.fetchrow.call_args
    kpi_sql = call.args[0]
    assert "app.insurance_doc_catalog" not in kpi_sql
    assert "app.insurance_documents" not in kpi_sql
    assert "app.insurance_policy_documents" in kpi_sql
    assert "unnest" in kpi_sql
    doc_codes_param = call.args[1]
    assert set(doc_codes_param) == {"poliza_firmada", "certificado_vigencia", "endoso", "comprobante_pago"}


# ── Revertir cuota pagada ────────────────────────────────────────────

def test_revert_installment_marks_pendiente_when_due_date_in_future():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"status": "pagada", "due_date": date(2026, 12, 1), "updated_at": None},
        {
            "id": "i1", "policy_id": "p1", "installment_number": 1, "total_installments": 2,
            "amount_uf": 3.5, "due_date": date(2026, 12, 1), "status": "pendiente",
            "paid_at": None, "payment_url": None, "manual_override": True,
            "updated_by": USER_ID, "updated_at": datetime.now(timezone.utc),
        },
    ]
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "pendiente"
    assert data["paid_at"] is None
    update_sql = pool.fetchrow.call_args_list[1].args[0]
    assert "paid_at         = NULL" in update_sql


def test_revert_installment_marks_vencida_when_due_date_past():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"status": "pagada", "due_date": date(2020, 1, 1), "updated_at": None},
        {
            "id": "i1", "policy_id": "p1", "installment_number": 1, "total_installments": 2,
            "amount_uf": 3.5, "due_date": date(2020, 1, 1), "status": "vencida",
            "paid_at": None, "payment_url": None, "manual_override": True,
            "updated_by": USER_ID, "updated_at": datetime.now(timezone.utc),
        },
    ]
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 200
    assert res.json()["status"] == "vencida"


def test_revert_installment_requires_status_pagada():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "pendiente", "due_date": date(2026, 12, 1), "updated_at": None}
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 422


def test_revert_installment_missing_is_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 404


def test_revert_installment_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={})
    assert res.status_code == 403
    pool.fetchrow.assert_not_called()


def test_revert_installment_stale_expected_updated_at_is_409():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "status": "pagada", "due_date": date(2026, 12, 1),
        "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
    }
    client = make_client(pool)
    res = client.post("/api/v1/insurance/installments/i1/revert", json={
        "expected_updated_at": "2026-06-01T00:00:00Z",
    })
    assert res.status_code == 409
