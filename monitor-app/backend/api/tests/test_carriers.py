from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.carriers import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def _carrier_facets_row(**overrides):
    base = {"pending": 0, "ok": 0, "total": 0}
    base.update(overrides)
    return base


def test_list_carriers_aggregates_pending_mandatory_docs():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "c1", "tax_id": "1-9", "country_code": "CL",
                                 "business_name": "Acme", "operational_status": "ACTIVE",
                                 "total_requirements": 12, "last_document_update": None,
                                 "pending_mandatory": 2, "compliance_health": "PENDING"}]
    pool.fetchval.return_value = 1
    pool.fetchrow.return_value = _carrier_facets_row(pending=1, total=1)
    client = make_client(pool)

    res = client.get("/api/v1/carriers")

    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["data"][0]["business_name"] == "Acme"
    assert body["data"][0]["compliance_health"] == "PENDING"
    assert body["facets"] == {"pending": 1, "ok": 0, "total": 1}
    fetch_query = pool.fetch.call_args.args[0]
    assert "FROM public.carriers c" in fetch_query
    assert "LEFT JOIN public.compliance_records cr" in fetch_query


def test_list_carriers_filters_by_health():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _carrier_facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers?health=PENDING")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "WHERE compliance_health = $1" in fetch_query
    assert pool.fetch.call_args.args[1] == "PENDING"


def test_list_carriers_rejects_invalid_health():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/carriers?health=BOGUS")

    assert res.status_code == 422


def _facets_row(**overrides):
    base = {"expired": 0, "expiring_soon": 0, "valid": 0, "cancelled": 0, "no_policy": 0, "total": 0}
    base.update(overrides)
    return base


def test_list_carriers_insurance_overview_aggregates_by_carrier():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "carrier_id": "c1", "business_name": "Acme", "tax_id": "1-9", "operational_status": "ACTIVE",
        "total_policies": 2, "total_overdue_installments": 3, "next_payment_date": None,
        "worst_policy_health": "EXPIRED",
    }]
    pool.fetchval.return_value = 1
    pool.fetchrow.return_value = _facets_row(expired=1, total=1)
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview")

    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 1
    assert body["data"][0]["worst_policy_health"] == "EXPIRED"
    assert body["data"][0]["total_overdue_installments"] == 3
    assert body["facets"] == {"expired": 1, "expiring_soon": 0, "valid": 0, "cancelled": 0, "no_policy": 0, "total": 1}
    fetch_query = pool.fetch.call_args.args[0]
    assert "FROM public.carriers c" in fetch_query
    assert "LEFT JOIN app.carrier_insurance_status p ON p.carrier_id = c.id" in fetch_query
    count_query = pool.fetchval.call_args.args[0]
    assert "count(*)" in count_query


def test_list_carriers_insurance_overview_filters_by_search():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?q=Acme")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "ILIKE" in fetch_query
    assert pool.fetch.call_args.args[1] == "Acme"


def test_list_carriers_insurance_overview_filters_by_health():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?health=EXPIRED")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "WHERE worst_policy_health = $1" in fetch_query
    assert pool.fetch.call_args.args[1] == "EXPIRED"
    # el filtro `health` no debe alterar los facets (permite ver los otros conteos) —
    # sin q, la llamada a fetchrow no debe llevar el param "EXPIRED"
    assert pool.fetchrow.call_args.args == (pool.fetchrow.call_args.args[0],)


def test_list_carriers_insurance_overview_filters_by_no_policy():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?health=NONE")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "WHERE worst_policy_health IS NULL" in fetch_query


def test_list_carriers_insurance_overview_rejects_invalid_health():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?health=BOGUS")

    assert res.status_code == 422


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


def test_list_carrier_drivers_includes_pending_mandatory():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "d1", "tax_id": "1-9", "full_name": "Juan Pérez", "operational_status": "ACTIVE",
        "total_requirements": 5, "last_document_update": None,
        "pending_mandatory": 2, "compliance_health": "PENDING",
    }]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/drivers")

    assert res.status_code == 200
    body = res.json()
    assert body[0]["compliance_health"] == "PENDING"
    assert body[0]["pending_mandatory"] == 2
    fetch_query = pool.fetch.call_args.args[0]
    assert "FROM app.carrier_driver_roster r" in fetch_query
    assert "cr.entity_type = 'DRIVER'" in fetch_query


def test_list_carrier_assets_includes_pending_mandatory():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
        "total_requirements": 3, "last_document_update": None,
        "pending_mandatory": 0, "compliance_health": "OK",
    }]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/assets")

    assert res.status_code == 200
    body = res.json()
    assert body[0]["compliance_health"] == "OK"
    fetch_query = pool.fetch.call_args.args[0]
    assert "FROM app.carrier_asset_roster r" in fetch_query
    assert "cr.entity_type = 'ASSET'" in fetch_query


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


def test_create_carrier_policy_persists_has_endorsement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    conn.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": None,
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30, "has_endorsement": True,
        "status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/policies",
        json={"carrier_id": "c1", "insurance_company": "HDI", "has_endorsement": True},
    )

    assert res.status_code == 201
    assert conn.fetchrow.call_args.args[-1] is True
    insert_sql = conn.fetchrow.call_args.args[0]
    assert "has_endorsement" in insert_sql
    assert res.json()["insurance_company"] == "HDI"


def test_list_carrier_shippers():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": "s1", "name": "Walmart", "status": "ACTIVE", "start_date": None, "end_date": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/shippers")

    assert res.status_code == 200
    assert res.json()[0]["name"] == "Walmart"
    sql = pool.fetch.call_args.args[0]
    assert "FROM public.carrier_shippers" in sql
