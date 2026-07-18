from datetime import date
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.policies import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def test_get_policy_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/policies/p1")

    assert res.status_code == 404


def test_get_policy_assembles_coverages_assets_installments():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": "87974",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": False, "endorsement_document_url": None,
        "external_portal_url": None, "status": "ACTIVE", "is_manual_override": False,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [
        [{"coverage_type_id": "ct1", "code": "VEHICULOS_MOTORIZADOS", "name": "Vehículos Motorizados"}],
        [{"asset_id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION"}],
        [{"id": "i1", "installment_number": 1, "total_installments": 2, "amount_uf": 1.04,
          "due_date": None, "payment_status": "PENDING", "paid_at": None}],
    ]
    client = make_client(pool)

    res = client.get("/api/v1/policies/p1")

    assert res.status_code == 200
    body = res.json()
    assert body["coverages"][0]["code"] == "VEHICULOS_MOTORIZADOS"
    assert body["assets"][0]["license_plate"] == "ABCD12"
    assert body["installments"][0]["payment_status"] == "PENDING"


def test_patch_policy_optimistic_lock_conflict():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "updated_at": "2026-07-16T10:00:00", "carrier_id": "c1", "insurance_company": "HDI",
        "policy_number": "1", "valid_from": None, "valid_to": None, "status": "ACTIVE",
        "expiration_alert_days": 30, "external_portal_url": None,
    }
    client = make_client(pool)

    res = client.patch(
        "/api/v1/policies/p1",
        json={"insurance_company": "Chubb", "expected_updated_at": "2026-01-01T00:00:00"},
    )

    assert res.status_code == 409


def test_patch_policy_sets_manual_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "updated_at": None, "carrier_id": "c1", "insurance_company": "HDI",
        "policy_number": "1", "valid_from": None, "valid_to": None, "status": "ACTIVE",
        "expiration_alert_days": 30, "external_portal_url": None,
    }
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "Chubb", "policy_number": "1",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": False, "endorsement_document_url": None,
        "external_portal_url": None, "status": "ACTIVE", "is_manual_override": True,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [[], [], []]
    client = make_client(pool)

    res = client.patch("/api/v1/policies/p1", json={"insurance_company": "Chubb"})

    assert res.status_code == 200
    override_sql = conn.execute.call_args_list[1].args[0]
    assert "UPDATE public.insurance_policies" in override_sql
    assert "is_manual_override = true" in override_sql


def test_link_coverage_404_when_coverage_type_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, None]  # policy exists, coverage type does not
    client = make_client(pool)

    res = client.post("/api/v1/policies/p1/coverages", json={"coverage_type_id": "ct1"})

    assert res.status_code == 404


def test_link_coverage_success():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, 1]
    client = make_client(pool)

    res = client.post("/api/v1/policies/p1/coverages", json={"coverage_type_id": "ct1"})

    assert res.status_code == 201
    insert_sql = conn.execute.call_args_list[0].args[0]
    assert "INSERT INTO public.policy_coverages" in insert_sql


def test_unlink_coverage_404_when_not_linked():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "DELETE 0"
    client = make_client(pool)

    res = client.delete("/api/v1/policies/p1/coverages/ct1")

    assert res.status_code == 404


def test_patch_installment_updates_payment_status():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"policy_id": "p1", "payment_status": "PENDING", "paid_at": None}
    pool.fetchrow.return_value = {
        "id": "i1", "installment_number": 1, "total_installments": 2, "amount_uf": 1.04,
        "due_date": None, "payment_status": "PAID", "paid_at": "2026-07-16T00:00:00",
    }
    client = make_client(pool)

    res = client.patch("/api/v1/policies/installments/i1", json={"payment_status": "PAID"})

    assert res.status_code == 200
    assert res.json()["payment_status"] == "PAID"


def test_patch_installment_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"policy_id": "p1", "payment_status": "PENDING", "paid_at": None}
    client = make_client(pool)

    res = client.patch("/api/v1/policies/installments/i1", json={})

    assert res.status_code == 422


def test_patch_policy_updates_has_endorsement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "updated_at": None, "carrier_id": "c1", "insurance_company": "HDI",
        "policy_number": "1", "valid_from": None, "valid_to": None, "status": "ACTIVE",
        "expiration_alert_days": 30, "has_endorsement": False, "external_portal_url": None,
    }
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": "1",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": True, "endorsement_document_url": None,
        "external_portal_url": None, "status": "ACTIVE", "is_manual_override": True,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [[], [], []]
    client = make_client(pool)

    res = client.patch("/api/v1/policies/p1", json={"has_endorsement": True})

    assert res.status_code == 200
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "has_endorsement = COALESCE($8, has_endorsement)" in update_sql
    assert conn.execute.call_args_list[0].args[8] is True


def test_patch_policy_updates_endorsement_number():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "updated_at": None, "carrier_id": "c1", "insurance_company": "HDI",
        "policy_number": "1", "valid_from": None, "valid_to": None, "status": "ACTIVE",
        "expiration_alert_days": 30, "has_endorsement": True, "endorsement_number": None,
        "external_portal_url": None,
    }
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": "1",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": True, "endorsement_number": "END-99",
        "endorsement_document_url": None,
        "external_portal_url": None, "status": "ACTIVE", "is_manual_override": True,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [[], [], []]
    client = make_client(pool)

    res = client.patch("/api/v1/policies/p1", json={"endorsement_number": "END-99"})

    assert res.status_code == 200
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "endorsement_number = COALESCE($9, endorsement_number)" in update_sql
    assert conn.execute.call_args_list[0].args[9] == "END-99"


def test_generate_installment_schedule_creates_monthly_rows():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = ["c1", 0]
    conn.fetchrow.side_effect = [
        {"id": "i1", "installment_number": 1, "total_installments": 3, "amount_uf": 2.5,
         "due_date": "2026-01-15", "payment_status": "PENDING", "paid_at": None},
        {"id": "i2", "installment_number": 2, "total_installments": 3, "amount_uf": 2.5,
         "due_date": "2026-02-15", "payment_status": "PENDING", "paid_at": None},
        {"id": "i3", "installment_number": 3, "total_installments": 3, "amount_uf": 2.5,
         "due_date": "2026-03-15", "payment_status": "PENDING", "paid_at": None},
    ]
    client = make_client(pool)

    res = client.post(
        "/api/v1/policies/p1/installments/generate",
        json={"total_installments": 3, "amount_uf": 2.5, "first_due_date": "2026-01-15"},
    )

    assert res.status_code == 201
    body = res.json()
    assert len(body) == 3
    assert [r["due_date"] for r in body] == ["2026-01-15", "2026-02-15", "2026-03-15"]
    insert_calls = [c for c in conn.fetchrow.call_args_list]
    assert len(insert_calls) == 3
    assert insert_calls[1].args[1:] == ("p1", 2, 3, 2.5, date(2026, 2, 15))


def test_generate_installment_schedule_404_when_policy_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/policies/p1/installments/generate",
        json={"total_installments": 3, "amount_uf": 2.5, "first_due_date": "2026-01-15"},
    )

    assert res.status_code == 404


def test_generate_installment_schedule_rejects_when_already_has_installments():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = ["c1", 2]
    client = make_client(pool)

    res = client.post(
        "/api/v1/policies/p1/installments/generate",
        json={"total_installments": 3, "amount_uf": 2.5, "first_due_date": "2026-01-15"},
    )

    assert res.status_code == 422


def test_upload_policy_file_404_when_policy_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/policies/p1/file",
        files={"file": ("poliza.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 404


def test_upload_policy_file_rejects_bad_kind():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"carrier_id": "c1", "current_path": None}
    client = make_client(pool)

    res = client.post(
        "/api/v1/policies/p1/file?kind=invalid",
        files={"file": ("poliza.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 422


def test_upload_policy_file_sets_policy_document_url_by_default():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {"carrier_id": "c1", "current_path": None}
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/policies/p1/file",
        files={"file": ("poliza.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    assert res.json()["kind"] == "document"
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "policy_document_url = $2" in update_sql


def test_upload_policy_file_sets_endorsement_document_url_when_kind_endorsement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {"carrier_id": "c1", "current_path": None}
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        "/api/v1/policies/p1/file?kind=endorsement",
        files={"file": ("endoso.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 201
    assert res.json()["kind"] == "endorsement"
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "endorsement_document_url = $2" in update_sql


def test_upload_policy_file_logs_replacement_when_previous_file_existed():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = {"carrier_id": "c1", "current_path": "policy/p1/document/old.pdf"}
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    client.post(
        "/api/v1/policies/p1/file",
        files={"file": ("poliza.pdf", b"contenido", "application/pdf")},
    )

    audit_sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert any("document_replace" in s for s in audit_sqls)


def test_delete_policy_file_404_when_policy_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/policies/p1/file")

    assert res.status_code == 404


def test_delete_policy_file_rejects_bad_kind():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.delete("/api/v1/policies/p1/file?kind=invalid")

    assert res.status_code == 422


def test_delete_policy_file_422_when_no_file_loaded():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"carrier_id": "c1", "current_path": None}
    client = make_client(pool)

    res = client.delete("/api/v1/policies/p1/file")

    assert res.status_code == 422


def test_delete_policy_file_clears_column_and_removes_from_storage():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"carrier_id": "c1", "current_path": "policy/p1/document/old.pdf"}
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "SURA", "policy_number": "1",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": False, "endorsement_number": None,
        "endorsement_document_url": None, "external_portal_url": None, "status": "ACTIVE",
        "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    pool.fetch.return_value = []
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/policies/p1/file")

    assert res.status_code == 200
    assert res.json()["policy_document_url"] is None
    supabase.storage.from_.return_value.remove.assert_called_once_with(["policy/p1/document/old.pdf"])

    update_sql = conn.execute.call_args_list[0].args[0]
    assert "policy_document_url = NULL" in update_sql

    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql


def test_delete_policy_file_endorsement_kind_clears_endorsement_column():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"carrier_id": "c1", "current_path": "policy/p1/endorsement/old.pdf"}
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "SURA", "policy_number": "1",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": None, "has_endorsement": True, "endorsement_number": "END-1",
        "endorsement_document_url": None, "external_portal_url": None, "status": "ACTIVE",
        "is_manual_override": True, "created_at": None, "updated_at": None,
    }
    pool.fetch.return_value = []
    supabase = MagicMock()
    client = make_client(pool, supabase=supabase)

    res = client.delete("/api/v1/policies/p1/file?kind=endorsement")

    assert res.status_code == 200
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "endorsement_document_url = NULL" in update_sql


def test_get_policy_resolves_signed_urls():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": "87974",
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "policy_document_url": "policy/p1/document/x.pdf", "has_endorsement": False,
        "endorsement_document_url": None,
        "external_portal_url": None, "status": "ACTIVE", "is_manual_override": False,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [[], [], []]
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example.com/x.pdf"}
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/policies/p1")

    assert res.status_code == 200
    assert res.json()["policy_document_url"] == "https://signed.example.com/x.pdf"
