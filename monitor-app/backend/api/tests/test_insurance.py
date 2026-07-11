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
    pool.fetchval.return_value = "p1"  # policy exists
    client = make_client(pool)
    res = client.post(
        "/api/v1/insurance/policies/p1/file",
        files={"file": ("virus.exe", b"MZ", "application/x-msdownload")},
    )
    assert res.status_code == 422


def test_upload_policy_file_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.post(
        "/api/v1/insurance/policies/p1/file",
        files={"file": ("poliza.pdf", b"%PDF", "application/pdf")},
    )
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
        {"doc_code": "poliza_firmada", "label": "Póliza firmada", "has_expiry": False, "sort_order": 10,
         "id": "d1", "status": "ok", "expiry_date": None, "file_url": None, "storage_path": "x",
         "notes": None, "manual_override": True, "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc)},
        {"doc_code": "endoso", "label": "Endoso", "has_expiry": False, "sort_order": 30,
         "id": None, "status": None, "expiry_date": None, "file_url": None, "storage_path": None,
         "notes": None, "manual_override": None, "updated_at": None},
    ]
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 200
    docs = res.json()
    assert docs[0]["doc_code"] == "poliza_firmada"
    assert docs[0]["status"] == "ok"
    assert docs[1]["doc_code"] == "endoso"
    assert docs[1]["status"] is None


def test_list_policy_documents_missing_policy_is_404():
    pool = AsyncMock()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.get("/api/v1/insurance/policies/p1/documents")
    assert res.status_code == 404


def test_patch_policy_document_upserts_and_requires_editor():
    pool = AsyncMock()
    pool.fetchval.return_value = "poliza_firmada"  # catálogo válido
    pool.fetchrow.return_value = {
        "id": "d1", "policy_id": "p1", "doc_code": "poliza_firmada", "status": "ok",
        "expiry_date": None, "file_url": None, "storage_path": None, "notes": None,
        "manual_override": True, "updated_by": USER_ID, "updated_at": datetime(2026, 7, 1, tzinfo=timezone.utc),
    }
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 200
    assert res.json()["status"] == "ok"


def test_patch_policy_document_requires_editor():
    pool = AsyncMock()
    client = make_client(pool, role="viewer", enforce_roles=True)
    res = client.patch("/api/v1/insurance/policies/p1/documents/poliza_firmada", json={"status": "ok"})
    assert res.status_code == 403


def test_patch_policy_document_invalid_doc_code_is_422():
    pool = AsyncMock()
    pool.fetchval.return_value = None  # no existe en el catálogo
    client = make_client(pool)
    res = client.patch("/api/v1/insurance/policies/p1/documents/no_existe", json={"status": "ok"})
    assert res.status_code == 422


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
