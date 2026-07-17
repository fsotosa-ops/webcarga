from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.drivers import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_get_driver_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/drivers/d1")

    assert res.status_code == 404


def test_create_driver_rejects_duplicate_tax_id():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "existing"
    client = make_client(pool)

    res = client.post("/api/v1/drivers", json={"tax_id": "1-9", "full_name": "Juan Perez"})

    assert res.status_code == 409


def test_create_driver_success():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "d1", "tax_id": "1-9", "country_code": "CL",
        "full_name": "Juan Perez", "operational_status": "ACTIVE", "created_at": None,
    }
    client = make_client(pool)

    res = client.post("/api/v1/drivers", json={"tax_id": "1-9", "full_name": "juan perez"})

    assert res.status_code == 201
    assert res.json()["full_name"] == "Juan Perez"


def test_patch_driver_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"full_name": "Juan", "operational_status": "ACTIVE"}
    client = make_client(pool)

    res = client.patch("/api/v1/drivers/d1", json={})

    assert res.status_code == 422


def test_patch_driver_updates_and_sets_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"full_name": "Juan", "operational_status": "ACTIVE"}
    pool.fetchrow.return_value = {
        "id": "d1", "tax_id": "1-9", "country_code": "CL", "full_name": "Juan Pablo",
        "operational_status": "ACTIVE", "is_manual_override": True, "created_at": None,
        "total_requirements": 12, "last_document_update": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/drivers/d1", json={"full_name": "juan pablo"})

    assert res.status_code == 200
    business_update_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.drivers" in business_update_sql
    override_sql = conn.execute.call_args_list[1].args[0]
    assert "UPDATE public.drivers" in override_sql
    assert "is_manual_override = true" in override_sql


def test_list_driver_compliance_records():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "cr1", "requirement_id": "req1", "requirement_code": "LIC_CONDUCIR", "name": "Licencia",
        "requirement_level": "LEGAL_MANDATORY", "requires_file": True, "status": "MISSING",
        "expiration_date": None, "file_url": None, "metadata": {}, "is_manual_override": False,
        "is_expired": False, "is_expiring_soon": False,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/drivers/d1/compliance-records")

    assert res.status_code == 200
    assert res.json()[0]["requirement_code"] == "LIC_CONDUCIR"
    sql = pool.fetch.call_args.args[0]
    assert "entity_type = 'DRIVER'" in sql
