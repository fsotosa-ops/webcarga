from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.assets import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def test_get_asset_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 404


def test_create_asset_rejects_duplicate_plate():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "existing"
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "TRACTOCAMION"})

    assert res.status_code == 409


def test_create_asset_uppercases_plate_and_succeeds():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None, "created_at": None,
    }
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "abcd12", "asset_type": "TRACTOCAMION"})

    assert res.status_code == 201
    insert_args = conn.fetchrow.call_args.args
    assert insert_args[1] == "ABCD12"


def test_create_asset_rejects_unknown_type():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "BICICLETA"})

    assert res.status_code == 422


def test_patch_asset_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None}
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={})

    assert res.status_code == 422


def test_patch_asset_updates_manufacture_year():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None}
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
        "manufacture_year": 2019, "is_manual_override": True, "created_at": None,
        "total_requirements": 3, "last_document_update": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={"manufacture_year": 2019})

    assert res.status_code == 200
    assert res.json()["manufacture_year"] == 2019
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "manufacture_year = COALESCE($4, manufacture_year)" in update_sql


def test_create_asset_rejects_out_of_range_year():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "manufacture_year": 1800})

    assert res.status_code == 422


def test_list_asset_compliance_records():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "cr1", "requirement_id": "req1", "requirement_code": "PADRON", "name": "Padrón",
        "requirement_level": "LEGAL_MANDATORY", "requires_file": True, "status": "MISSING",
        "expiration_date": None, "file_url": None, "metadata": {}, "is_manual_override": False,
        "is_expired": False, "is_expiring_soon": False,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1/compliance-records")

    assert res.status_code == 200
    assert res.json()[0]["requirement_code"] == "PADRON"
    sql = pool.fetch.call_args.args[0]
    assert "entity_type = 'ASSET'" in sql


def test_asset_detail_carries_its_carrier():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "HKXW55", "asset_type": "TRACTO",
        "operational_status": "ACTIVE", "manufacture_year": 2020,
        "is_manual_override": False, "created_at": None,
        "fleet_service_type_id": None, "fleet_service_type_label": None,
        "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None,
        "total_requirements": 10, "last_document_update": None,
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa",
    }
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 200
    assert res.json()["carrier_name"] == "Transportes Sur Spa"
    assert "asset_assignments" in pool.fetchrow.call_args.args[0]


def test_asset_detail_without_active_assignment():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "SINASIG", "asset_type": None,
        "operational_status": "ACTIVE", "manufacture_year": None,
        "is_manual_override": False, "created_at": None,
        "fleet_service_type_id": None, "fleet_service_type_label": None,
        "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None,
        "total_requirements": 0, "last_document_update": None,
        "carrier_id": None, "carrier_name": None,
    }
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 200
    assert res.json()["carrier_id"] is None
