from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.drivers import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
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


def test_list_driver_contacts():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "ct1", "contact_role": "OPERATIONS", "first_name": "Juan", "last_name": "Perez",
        "job_title": None, "email": "juan@example.com", "phone": "+56911111111",
        "is_primary": True, "is_active": True,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/drivers/d1/contacts")

    assert res.status_code == 200
    assert res.json()[0]["email"] == "juan@example.com"
    sql = pool.fetch.call_args.args[0]
    assert "entity_type = 'DRIVER'" in sql


def test_create_driver_contact_rejects_mismatched_entity():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post(
        "/api/v1/drivers/d1/contacts",
        json={"entity_id": "OTHER", "entity_type": "DRIVER", "contact_role": "OPERATIONS"},
    )

    assert res.status_code == 422


def test_create_driver_contact_404_when_driver_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    client = make_client(pool)

    res = client.post(
        "/api/v1/drivers/d1/contacts",
        json={"entity_id": "d1", "entity_type": "DRIVER", "contact_role": "OPERATIONS"},
    )

    assert res.status_code == 404


def test_create_driver_contact_persists_multiple_phones_and_emails():
    """El usuario pidió poder registrar más de un teléfono/email por
    conductor — se logra con múltiples filas de contacto (mismo patrón que
    carriers), no con arrays en una sola fila."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = 1
    conn.fetchrow.return_value = {
        "id": "ct1", "contact_role": "OPERATIONS", "first_name": "Juan", "last_name": None,
        "job_title": None, "email": "juan@example.com", "phone": "+56911111111",
        "is_primary": False, "is_active": True,
    }
    client = make_client(pool)

    res = client.post(
        "/api/v1/drivers/d1/contacts",
        json={
            "entity_id": "d1", "entity_type": "DRIVER", "contact_role": "OPERATIONS",
            "first_name": "Juan", "email": "juan@example.com", "phone": "+56911111111",
        },
    )

    assert res.status_code == 201
    insert_sql = conn.fetchrow.call_args.args[0]
    assert "'DRIVER'" in insert_sql
    assert res.json()["email"] == "juan@example.com"


# ── GET /drivers — búsqueda por nombre/RUT (TripAssignDialog, Ronda 26) ──────

def test_list_drivers_requires_min_query_length():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/drivers?q=a")
    assert res.status_code == 200
    assert res.json() == []
    pool.fetch.assert_not_called()


def test_list_drivers_searches_active_roster_with_resolved_carrier_and_vehicle():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9",
        "driver_phone": "+56911112222", "carrier_id": "c1", "carrier_name": "TransCargo",
        "tractor_asset_id": "a1", "tractor_plate": "ABCD12",
    }]
    client = make_client(pool)
    res = client.get("/api/v1/drivers?q=Juan")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["driver_name"] == "Juan Pérez"
    assert data[0]["carrier_id"] == "c1"
    query = pool.fetch.call_args.args[0]
    assert "operational_status = 'ACTIVE'" in query
    assert "public.vehicle_driver_assignments" in query
    assert "d.full_name ILIKE" in query
    assert "d.tax_id ILIKE" in query
