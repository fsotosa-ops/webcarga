from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.policies import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
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
