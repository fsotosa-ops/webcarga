from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.carriers import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_list_carriers_reads_from_compliance_view():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "c1", "tax_id": "1-9", "country_code": "CL",
                                 "business_name": "Acme", "operational_status": "ACTIVE",
                                 "total_requirements": 12, "last_document_update": None}]
    pool.fetchval.return_value = 1
    client = make_client(pool)

    res = client.get("/api/v1/carriers")

    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["data"][0]["business_name"] == "Acme"
    assert "FROM app.carrier_compliance_status" in pool.fetch.call_args.args[0]


def test_get_carrier_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/carriers/does-not-exist")

    assert res.status_code == 404


def test_get_carrier_assembles_nested_contacts_and_compliance():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "c1", "tax_id": "1-9", "country_code": "CL", "business_name": "Acme",
        "operational_status": "ACTIVE", "legacy_admin_id": None, "erp_id": None,
        "is_manual_override": False, "overridden_by": None, "overridden_at": None,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [
        [{"id": "ct1", "contact_role": "LEGAL_REP", "first_name": "Ana", "last_name": None,
          "job_title": None, "email": None, "phone": None, "is_primary": True, "is_active": True}],
        [{"id": "cr1", "requirement_id": "req1", "requirement_code": "F30_MULTAS", "name": "F30",
          "requirement_level": "LEGAL_MANDATORY", "requires_file": True, "status": "MISSING",
          "expiration_date": None, "file_url": None, "metadata": {}, "is_manual_override": False,
          "is_expired": False, "is_expiring_soon": False}],
    ]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1")

    assert res.status_code == 200
    body = res.json()
    assert body["contacts"][0]["contact_role"] == "LEGAL_REP"
    assert body["compliance_records"][0]["requirement_code"] == "F30_MULTAS"


def test_create_carrier_rejects_duplicate_tax_id():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "existing-id"
    client = make_client(pool)

    res = client.post("/api/v1/carriers", json={"tax_id": "1-9", "business_name": "Acme"})

    assert res.status_code == 409


def test_create_carrier_inserts_and_logs():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "c1", "tax_id": "1-9", "country_code": "CL",
        "business_name": "Transportes Acme Spa", "operational_status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post("/api/v1/carriers", json={"tax_id": "1-9", "business_name": "transportes acme spa"})

    assert res.status_code == 201
    assert res.json()["business_name"] == "Transportes Acme Spa"
    insert_sql = conn.fetchrow.call_args.args[0]
    assert "INSERT INTO public.carriers" in insert_sql
    audit_sql = conn.execute.call_args.args[0]
    assert "INSERT INTO public.audit_log" in audit_sql


def test_patch_carrier_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/carriers/c1", json={"business_name": "Nuevo"})

    assert res.status_code == 404


def test_patch_carrier_optimistic_lock_conflict():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"updated_at": "2026-07-16T10:00:00", "business_name": "A", "operational_status": "ACTIVE"}
    client = make_client(pool)

    res = client.patch(
        "/api/v1/carriers/c1",
        json={"business_name": "Nuevo", "expected_updated_at": "2026-01-01T00:00:00"},
    )

    assert res.status_code == 409


def test_patch_carrier_no_fields_sent_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"updated_at": None, "business_name": "A", "operational_status": "ACTIVE"}
    client = make_client(pool)

    res = client.patch("/api/v1/carriers/c1", json={})

    assert res.status_code == 422


def test_patch_carrier_sets_manual_override_and_returns_detail():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"updated_at": None, "business_name": "Viejo", "operational_status": "ACTIVE"}
    pool.fetchrow.return_value = {
        "id": "c1", "tax_id": "1-9", "country_code": "CL", "business_name": "Nuevo Nombre",
        "operational_status": "ACTIVE", "legacy_admin_id": None, "erp_id": None,
        "is_manual_override": True, "overridden_by": USER["sub"], "overridden_at": None,
        "created_at": None, "updated_at": None,
    }
    pool.fetch.side_effect = [[], []]
    client = make_client(pool)

    res = client.patch("/api/v1/carriers/c1", json={"business_name": "nuevo nombre"})

    assert res.status_code == 200
    override_sql = conn.execute.call_args_list[1].args[0]
    assert "is_manual_override = true" in override_sql


def test_assign_driver_deactivates_previous_and_activates_new():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1  # carrier exists, driver exists
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c1/drivers", json={"driver_id": "d1", "carrier_id": "c1"})

    assert res.status_code == 201
    sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert any("SET status = 'INACTIVE'" in s and "carrier_id <> $2" in s for s in sqls)
    assert any("INSERT INTO public.driver_assignments" in s for s in sqls)


def test_assign_driver_404_when_driver_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, None]  # carrier exists, driver does not
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c1/drivers", json={"driver_id": "d1", "carrier_id": "c1"})

    assert res.status_code == 404


def test_unassign_driver_404_when_no_active_assignment():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 0"
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1/drivers/d1")

    assert res.status_code == 404


def test_unassign_driver_success():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 1"
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1/drivers/d1")

    assert res.status_code == 200
    assert res.json() == {"ok": True}


def test_create_carrier_contact_rejects_mismatched_entity():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/contacts",
        json={"entity_id": "OTHER", "entity_type": "CARRIER", "contact_role": "LEGAL_REP"},
    )

    assert res.status_code == 422


def test_list_carrier_policies_reads_from_insurance_status_view():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "p1", "insurance_company": "HDI", "policy_number": "87974",
        "coverage_names": "Vehículos Motorizados", "total_assets_covered": 1,
        "policy_expiration_date": None, "policy_health": "VALID",
        "total_installments": 2, "paid_installments": 1, "overdue_installments": 0,
        "next_payment_date": None,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/policies")

    assert res.status_code == 200
    assert res.json()[0]["insurance_company"] == "HDI"
    assert "FROM app.carrier_insurance_status" in pool.fetch.call_args.args[0]


def test_create_carrier_policy_rejects_mismatched_carrier_id():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/policies",
        json={"carrier_id": "OTHER", "insurance_company": "HDI"},
    )

    assert res.status_code == 422


def test_create_carrier_policy_success():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    conn.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": None,
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/policies",
        json={"carrier_id": "c1", "insurance_company": "HDI"},
    )

    assert res.status_code == 201
    assert res.json()["insurance_company"] == "HDI"
