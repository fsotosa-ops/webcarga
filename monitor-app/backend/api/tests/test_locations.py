from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.locations import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def _location_row(**overrides):
    base = {
        "id": "loc-1", "entity_type": "SHIPPER", "entity_id": "shipper-1",
        "site_number": "72", "name": "Alameda", "country_code": "CL",
        "format": "Express", "address": "Av. Alameda 123", "region_name": "RM. Metropolitana",
        "region_number": 13, "opens_at": None, "closes_at": None, "operation_type": "RM",
        "operational_status": "ACTIVE", "created_at": None, "updated_at": None,
    }
    base.update(overrides)
    return base


# ── GET /locations ────────────────────────────────────────────────────────

def test_list_locations_defaults_to_active_only():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row()]
    client = make_client(pool)

    res = client.get("/api/v1/locations")

    assert res.status_code == 200
    assert res.json()[0]["name"] == "Alameda"
    query = pool.fetch.call_args.args[0]
    assert "operational_status = 'ACTIVE'" in query


def test_list_locations_filters_by_entity_and_query():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/locations?entity_type=SHIPPER&entity_id=shipper-1&q=alameda")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    params = pool.fetch.call_args.args[1:]
    assert "entity_type = $1" in query
    assert "entity_id = $2" in query
    assert "name ILIKE" in query
    assert params == ("SHIPPER", "shipper-1", "alameda")


# ── HU-15/16 (Fase 4): ?incomplete=true — locales auto-registrados desde el
# TMS sin clasificación todavía (trg_reconcile_new_trip_stop_location).

def test_list_locations_incomplete_filters_by_null_operation_type():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row(operation_type=None)]
    client = make_client(pool)

    res = client.get("/api/v1/locations?incomplete=true")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "operation_type IS NULL" in query


def test_list_locations_ignores_incomplete_when_not_true():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/locations?incomplete=false")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "operation_type IS NULL" not in query


def _location_rate_row(**overrides):
    base = {
        "id": "r1", "location_id": "loc-1", "tarifa": "450.000 CLP",
        "valid_from": "2026-07-22", "valid_to": None, "created_at": None, "updated_at": None,
    }
    base.update(overrides)
    return base


# ── HU-17 (Fase 5, Tarifario 1.0): GET ?include_rate= ────────────────────────

def test_list_locations_include_rate_joins_current_rate():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row(
        current_rate="450.000 CLP", current_rate_valid_from="2026-07-01", current_rate_valid_to=None,
    )]
    client = make_client(pool)

    res = client.get("/api/v1/locations?include_rate=true")

    assert res.status_code == 200
    assert res.json()[0]["current_rate"] == "450.000 CLP"
    query = pool.fetch.call_args.args[0]
    assert "public.location_rates" in query
    assert "current_rate" in query


def test_list_locations_omits_rate_join_by_default():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_row()]
    client = make_client(pool)

    res = client.get("/api/v1/locations")

    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "public.location_rates" not in query


# ── GET/POST/PATCH /locations/{id}/rates ─────────────────────────────────────

def test_list_location_rates_orders_by_valid_from_desc():
    pool = AsyncMock()
    pool.fetch.return_value = [_location_rate_row()]
    client = make_client(pool)

    res = client.get("/api/v1/locations/loc-1/rates")

    assert res.status_code == 200
    assert res.json()[0]["tarifa"] == "450.000 CLP"
    query = pool.fetch.call_args.args[0]
    assert "ORDER BY valid_from DESC" in query


def test_create_location_rate_404_when_location_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.post("/api/v1/locations/loc-1/rates", json={"tarifa": "450.000 CLP"})

    assert res.status_code == 404


def test_create_location_rate_inserts_new_row():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        {"entity_type": "SHIPPER", "entity_id": "shipper-1"},
        _location_rate_row(),
    ]
    client = make_client(pool)

    res = client.post("/api/v1/locations/loc-1/rates", json={"tarifa": "450.000 CLP", "valid_from": "2026-07-22"})

    assert res.status_code == 201
    assert res.json()["tarifa"] == "450.000 CLP"
    insert_sql = conn.fetchrow.call_args_list[-1].args[0]
    assert "INSERT INTO public.location_rates" in insert_sql


def test_patch_location_rate_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={"tarifa": "500.000 CLP"})

    assert res.status_code == 404


def test_patch_location_rate_no_fields_422():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={})

    assert res.status_code == 422


def test_patch_location_rate_updates_without_creating_history():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.side_effect = [
        _location_rate_row(),
        {"entity_type": "SHIPPER", "entity_id": "shipper-1"},
    ]
    pool.fetchrow.return_value = _location_rate_row(tarifa="500.000 CLP")
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1/rates/r1", json={"tarifa": "500.000 CLP"})

    assert res.status_code == 200
    assert res.json()["tarifa"] == "500.000 CLP"
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.location_rates SET" in update_sql


# ── POST /locations ───────────────────────────────────────────────────────

def test_create_location_rejects_unknown_shipper():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None  # SELECT 1 FROM public.shippers → no existe
    client = make_client(pool)

    res = client.post("/api/v1/locations", json={
        "entity_type": "SHIPPER", "entity_id": "ghost", "name": "Local Fantasma",
    })

    assert res.status_code == 404


def test_create_location_rejects_duplicate_name_and_site_number():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = ["shipper-1", "existing-loc-id"]
    client = make_client(pool)

    res = client.post("/api/v1/locations", json={
        "entity_type": "SHIPPER", "entity_id": "shipper-1", "name": "Alameda", "site_number": "72",
    })

    assert res.status_code == 409


def test_create_location_inserts_with_country_code_default():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.side_effect = ["shipper-1", None]
    conn.fetchrow.return_value = _location_row()
    client = make_client(pool)

    res = client.post("/api/v1/locations", json={
        "entity_type": "SHIPPER", "entity_id": "shipper-1", "name": "Alameda", "site_number": "72",
    })

    assert res.status_code == 201
    insert_sql, *insert_params = conn.fetchrow.call_args.args
    assert "INSERT INTO public.locations" in insert_sql
    assert "CL" in insert_params  # country_code default


# ── PATCH /locations/{id} ─────────────────────────────────────────────────

def test_patch_location_404_when_missing():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1", json={"address": "Nueva dirección"})

    assert res.status_code == 404


def test_patch_location_no_fields_sent_422():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1", json={})

    assert res.status_code == 422


def test_patch_location_updates_address_and_logs():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = _location_row()
    pool.fetchrow.return_value = _location_row(address="Nueva dirección")
    client = make_client(pool)

    res = client.patch("/api/v1/locations/loc-1", json={"address": "Nueva dirección"})

    assert res.status_code == 200
    assert res.json()["address"] == "Nueva dirección"
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "UPDATE public.locations SET" in update_sql
    audit_sql = conn.execute.call_args_list[-1].args[0]
    assert "INSERT INTO public.audit_log" in audit_sql
