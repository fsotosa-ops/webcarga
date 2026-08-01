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


def test_list_carriers_insurance_overview_filters_by_operational_status():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?operational_status=LEGACY_INACTIVE")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "c.operational_status = $1" in fetch_query
    assert pool.fetch.call_args.args[1] == "LEGACY_INACTIVE"


def test_list_carriers_insurance_overview_combines_search_and_operational_status():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0
    pool.fetchrow.return_value = _facets_row()
    client = make_client(pool)

    res = client.get("/api/v1/carriers/insurance-overview?q=Acme&operational_status=ACTIVE")

    assert res.status_code == 200
    fetch_query = pool.fetch.call_args.args[0]
    assert "AND" in fetch_query
    assert pool.fetch.call_args.args[1] == "Acme"
    assert pool.fetch.call_args.args[2] == "ACTIVE"


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


def test_assign_driver_transfer_never_touches_trip_fleet_links():
    """HU-07 (Fase 0, cierre documentado): transferir un conductor a otra
    empresa NO debe recalcular/tocar app.trip_fleet_links — esa tabla guarda
    carrier_id por viaje en el momento de la ingesta (snapshot de facto), así
    que los viajes históricos conservan la empresa original sin necesitar
    bitemporalidad. Confirmado en TransferModal.tsx (reusa este mismo
    endpoint) y verificado acá a nivel de SQL ejecutado."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c2/drivers", json={"driver_id": "d1", "carrier_id": "c2"})

    assert res.status_code == 201
    sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert not any("trip_fleet_links" in s for s in sqls)


def test_assign_asset_transfer_never_touches_trip_fleet_links():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    client = make_client(pool)

    res = client.post("/api/v1/carriers/c2/assets", json={"asset_id": "a1", "carrier_id": "c2"})

    assert res.status_code == 201
    sqls = [c.args[0] for c in conn.execute.call_args_list]
    assert not any("trip_fleet_links" in s for s in sqls)


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


def test_create_carrier_policy_serializes_uuid_id_in_audit_log():
    """Bug real de producción (500, confirmado en Cloud Run logs
    2026-07-22): asyncpg decodifica una columna uuid de Postgres como
    uuid.UUID de Python, no str — log_change hace json.dumps(new_value)
    antes de mandarlo a Postgres, y json.dumps no sabe serializar un UUID
    crudo. Con "id": "p1" (string) el mock nunca reproducía el bug real."""
    import uuid
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    conn.fetchrow.return_value = {
        "id": uuid.UUID("11111111-1111-1111-1111-111111111111"), "carrier_id": "c1",
        "insurance_company": "HDI", "policy_number": None,
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30,
        "status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/policies",
        json={"carrier_id": "c1", "insurance_company": "HDI"},
    )

    assert res.status_code == 201
    audit_call = conn.execute.call_args
    assert audit_call.args[7] == '"11111111-1111-1111-1111-111111111111"'


def test_create_carrier_policy_persists_has_endorsement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    conn.fetchrow.return_value = {
        "id": "p1", "carrier_id": "c1", "insurance_company": "HDI", "policy_number": None,
        "valid_from": None, "valid_to": None, "expiration_alert_days": 30, "has_endorsement": True,
        "endorsement_number": "END-1", "status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/carriers/c1/policies",
        json={"carrier_id": "c1", "insurance_company": "HDI", "has_endorsement": True, "endorsement_number": "END-1"},
    )

    assert res.status_code == 201
    assert conn.fetchrow.call_args.args[-2] is True
    assert conn.fetchrow.call_args.args[-1] == "END-1"
    insert_sql = conn.fetchrow.call_args.args[0]
    assert "has_endorsement" in insert_sql
    assert "endorsement_number" in insert_sql
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


def test_list_carrier_fleet_service_types():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"id": "t1", "label": "Tractoreo", "status": "ACTIVE", "start_date": None, "end_date": None},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/fleet-service-types")

    assert res.status_code == 200
    assert res.json()[0]["label"] == "Tractoreo"
    sql = pool.fetch.call_args.args[0]
    assert "FROM public.carrier_fleet_service_types" in sql


def test_delete_carrier_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1")

    assert res.status_code == 404


def test_delete_carrier_blocked_when_has_drivers():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, 1, None, None, None, None, None, None]  # carrier existe, tiene driver_assignments
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1")

    assert res.status_code == 409
    assert "conductores" in res.json()["detail"]


def test_delete_carrier_blocked_when_has_linked_trips():
    """Fase 1.5: trip_fleet_links.carrier_id ahora es FK real hacia
    public.carriers — sin este chequeo, borrar una empresa con viajes
    vinculados rompería con un 500 crudo de violación de FK en vez de un
    409 legible."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # carrier existe, sin conductores/equipos/pólizas/generadores, con viaje vinculado
    conn.fetchval.side_effect = [1, None, None, None, None, 1, None, None]
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1")

    assert res.status_code == 409
    assert "viajes" in res.json()["detail"]


def test_delete_carrier_blocked_when_has_uploaded_documents():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    # carrier existe, sin conductores/equipos/pólizas/generadores/viajes/contactos, pero con documentos cargados
    conn.fetchval.side_effect = [1, None, None, None, None, None, None, 1]
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1")

    assert res.status_code == 409
    assert "documentos cargados" in res.json()["detail"]


def test_delete_carrier_only_blocks_on_active_assignments():
    """Bug real encontrado en vivo: 'Quitar del roster' deja la fila de
    driver_assignments en INACTIVE en vez de borrarla — bloquear sobre
    cualquier fila (sin filtrar status) dejaba una empresa sin forma de
    borrarse después de deshacer un alta por error."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, None, None, None, None, None, None, None]
    client = make_client(pool)

    client.delete("/api/v1/carriers/c1")

    driver_check_sql = conn.fetchval.call_args_list[1].args[0]
    asset_check_sql = conn.fetchval.call_args_list[2].args[0]
    assert "status = 'ACTIVE'" in driver_check_sql
    assert "status = 'ACTIVE'" in asset_check_sql


def test_delete_carrier_excludes_untouched_missing_compliance_records():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, None, None, None, None, None, None, None]
    client = make_client(pool)

    client.delete("/api/v1/carriers/c1")

    compliance_check_sql = conn.fetchval.call_args_list[7].args[0]
    assert "status != 'MISSING'" in compliance_check_sql
    assert "file_url IS NOT NULL" in compliance_check_sql
    assert "expiration_date IS NOT NULL" in compliance_check_sql


def test_delete_carrier_succeeds_when_no_associated_data():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = [1, None, None, None, None, None, None, None]
    client = make_client(pool)

    res = client.delete("/api/v1/carriers/c1")

    assert res.status_code == 200
    assert res.json() == {"ok": True}
    delete_calls = [c.args[0] for c in conn.execute.call_args_list]
    assert any("DELETE FROM public.compliance_records" in s for s in delete_calls)
    assert any("DELETE FROM public.carriers" in s for s in delete_calls)


# ── GET /carriers/{id}/documents/export (HU-08, Fase 0) ─────────────────────
# Fabián pidió explícitamente en la reunión del 20/07 poder bajar toda la
# documentación de una empresa de una sola vez, en vez de ir documento por
# documento — antes no existía ningún export.

def test_export_carrier_documents_404_when_carrier_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/documents/export")

    assert res.status_code == 404


def test_export_carrier_documents_404_when_nothing_uploaded():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"business_name": "Transportes Sur Spa"}
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/carriers/c1/documents/export")

    assert res.status_code == 404


def test_export_carrier_documents_returns_zip_with_uploaded_files():
    import zipfile
    from io import BytesIO

    pool = AsyncMock()
    pool.fetchrow.return_value = {"business_name": "Transportes Sur Spa"}
    pool.fetch.return_value = [
        {"name": "Licencia de conducir", "file_url": "carrier/c1/r1/20260101_licencia.pdf"},
        {"name": "F30 Multas", "file_url": "carrier/c1/r2/20260102_f30.pdf"},
    ]
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.side_effect = [b"contenido-licencia", b"contenido-f30"]
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/carriers/c1/documents/export")

    assert res.status_code == 200
    assert res.headers["content-type"] == "application/zip"
    assert "Transportes_Sur_Spa_documentos.zip" in res.headers["content-disposition"]
    zf = zipfile.ZipFile(BytesIO(res.content))
    names = zf.namelist()
    assert len(names) == 2
    assert any("licencia.pdf" in n for n in names)
    assert any("f30.pdf" in n for n in names)


def test_export_carrier_documents_skips_records_without_file():
    import zipfile
    from io import BytesIO

    pool = AsyncMock()
    pool.fetchrow.return_value = {"business_name": "Rios Ltda"}
    # el WHERE del endpoint ya filtra file_url IS NOT NULL, pero el helper
    # de zip también debe ser defensivo si algún día se le pasa uno sin archivo
    pool.fetch.return_value = [
        {"name": "Poliza", "file_url": "carrier/c2/r1/poliza.pdf"},
    ]
    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = b"contenido"
    client = make_client(pool, supabase=supabase)

    res = client.get("/api/v1/carriers/c2/documents/export")

    assert res.status_code == 200
    zf = zipfile.ZipFile(BytesIO(res.content))
    assert len(zf.namelist()) == 1
