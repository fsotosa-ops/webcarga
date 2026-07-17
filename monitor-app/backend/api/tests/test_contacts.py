from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.contacts import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_patch_contact_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/contacts/ct1", json={"first_name": "Ana"})

    assert res.status_code == 404


def test_patch_contact_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "contact_role": "LEGAL_REP",
        "first_name": None, "last_name": None, "job_title": None, "email": None,
        "phone": None, "is_primary": False, "is_active": True,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/contacts/ct1", json={})

    assert res.status_code == 422


def test_patch_contact_updates_and_sets_override():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "entity_id": "c1", "entity_type": "CARRIER", "contact_role": "LEGAL_REP",
        "first_name": "Ana", "last_name": None, "job_title": None, "email": None,
        "phone": None, "is_primary": False, "is_active": True,
    }
    pool.fetchrow.return_value = {
        "id": "ct1", "contact_role": "LEGAL_REP", "first_name": "Ana Maria",
        "last_name": None, "job_title": None, "email": None, "phone": None,
        "is_primary": False, "is_active": True,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/contacts/ct1", json={"first_name": "Ana Maria"})

    assert res.status_code == 200
    override_sql = conn.execute.call_args_list[1].args[0]
    assert "UPDATE public.contacts" in override_sql
    assert "is_manual_override = true" in override_sql


def test_delete_contact_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.delete("/api/v1/contacts/ct1")

    assert res.status_code == 404


def test_delete_contact_success_logs_change():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "c1", "entity_type": "CARRIER", "contact_role": "LEGAL_REP"}
    client = make_client(pool)

    res = client.delete("/api/v1/contacts/ct1")

    assert res.status_code == 200
    delete_sql = conn.execute.call_args_list[0].args[0]
    assert "DELETE FROM public.contacts" in delete_sql
    audit_sql = conn.execute.call_args_list[1].args[0]
    assert "INSERT INTO public.audit_log" in audit_sql
