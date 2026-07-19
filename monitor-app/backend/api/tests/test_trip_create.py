import hashlib
import json
from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import (
    router, _manual_trip_id, _build_manual_stops, TripCreateBody, TripStopCreate,
)
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}

STATUS_ROWS = [{"id": "ASIGNADO"}, {"id": "EN RUTA"}]


def make_pool(trip_exists=False):
    pool = AsyncMock()

    # fetch se usa para: _valid_status_ids, y (dentro de get_trip al final del
    # create) _load_trip_stops/_load_operation_type_buckets — vacío para esas
    # dos, no hay datos reales que simular en estos tests de creación.
    def fetch_side_effect(query, *args):
        if "FROM app.trip_statuses" in query:
            return STATUS_ROWS
        return []
    pool.fetch.side_effect = fetch_side_effect

    # fetchval se usa para: SELECT source_system (dedup check) y RETURNING id (fleet link)
    def fetchval_side_effect(query, *args):
        if "SELECT source_system FROM app.trips" in query:
            return "qanalytics" if trip_exists else None
        return "ffffffff-0000-0000-0000-000000000001"
    pool.fetchval.side_effect = fetchval_side_effect

    # get_trip al final del create
    pool.fetchrow.return_value = {"id": "x"}
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── Derivación del id ─────────────────────────────────────────────────────────

def test_canonical_id_matches_pipeline_formula():
    body = TripCreateBody(
        planning_date="2026-07-06", origin_tms="qanalytics",
        source_system_trip_id="1994062", client_name="Walmart",
    )
    # Misma fórmula que stg_*_trips: md5(tms|cliente_lower|trip_id) como uuid
    expected = str(UUID(hashlib.md5(b"qanalytics|walmart|1994062").hexdigest()))
    assert _manual_trip_id(body) == expected
    # Verificado contra la base real: md5('qanalytics|walmart|1994062')::uuid
    assert expected == "0007b972-a631-fb0b-8481-21f8fb9d200d"


def test_random_id_when_no_mapped_tms():
    a = TripCreateBody(planning_date="2026-07-06", origin_tms="tms-desconocido",
                       source_system_trip_id="123", client_name="Acme")
    b = TripCreateBody(planning_date="2026-07-06")  # sin TMS
    assert _manual_trip_id(a) != _manual_trip_id(a)  # aleatorio
    assert _manual_trip_id(b) != _manual_trip_id(b)


def test_stops_payload_builds_pipeline_shape():
    stops = [TripStopCreate(local="Local Maipú", planning_date="2026-07-06 09:00"),
             TripStopCreate(local="Local Puente Alto")]
    parsed = json.loads(_build_manual_stops(stops, "trip-1"))
    assert len(parsed) == 2
    assert parsed[0]["local"] == "Local Maipú"
    assert parsed[0]["planning_date"] == "2026-07-06 09:00"
    assert parsed[1]["planning_date"] is None
    # shape completo del TripStop del pipeline
    for key in ("arrival_date", "departure_date", "departure_date_prog", "on_time_status",
                "temperature", "gps_arrival_date", "stop_id"):
        assert key in parsed[0]
    assert parsed[0]["stop_id"] != parsed[1]["stop_id"]


def test_stops_payload_ignores_origin_type_entries():
    # _build_manual_stops sigue armando SOLO el jsonb legacy de destinos
    # (app.trips.stops) — el origen unificado vive en app.trip_stops (tabla),
    # insertado por _insert_trip_stops, no en este jsonb.
    stops = [
        TripStopCreate(local="CD Origen", stop_type="ORIGIN"),
        TripStopCreate(local="Local Maipú", stop_type="DESTINATION"),
    ]
    destinations = [s for s in stops if s.stop_type != "ORIGIN"]
    parsed = json.loads(_build_manual_stops(destinations, "trip-1"))
    assert len(parsed) == 1
    assert parsed[0]["local"] == "Local Maipú"


def test_trip_create_body_has_no_origin_field():
    body = TripCreateBody(
        planning_date="2026-07-06",
        stops=[{"local": "CD Origen", "stop_type": "ORIGIN"}, {"local": "Destino 1"}],
    )
    assert not hasattr(body, "origin")
    assert body.stops[0].stop_type == "ORIGIN"
    assert body.stops[1].stop_type == "DESTINATION"  # default


def test_validate_create_body_rejects_more_than_one_origin():
    from app.routers.trips import _validate_create_body
    body = TripCreateBody(
        planning_date="2026-07-06",
        stops=[
            {"local": "Origen 1", "stop_type": "ORIGIN"},
            {"local": "Origen 2", "stop_type": "ORIGIN"},
        ],
    )
    try:
        _validate_create_body(body, set())
        assert False, "debía levantar HTTPException"
    except Exception as e:
        assert e.status_code == 422


# ── POST /trips ───────────────────────────────────────────────────────────────

def test_create_forces_source_system_manual():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={
        "planning_date": "2026-07-06", "source_system": "qanalytics",
    })
    assert res.status_code == 200
    inserts = [c.args[0] for c in pool.execute.call_args_list if "INSERT INTO app.trips " in c.args[0]]
    assert inserts and "'manual'" in inserts[0]


def test_create_writes_both_tables_with_same_id():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={"planning_date": "2026-07-06"})
    assert res.status_code == 200
    manual_call = next(c for c in pool.execute.call_args_list if "app.trips_manual" in c.args[0])
    trips_call  = next(c for c in pool.execute.call_args_list if "INSERT INTO app.trips " in c.args[0])
    assert manual_call.args[1] == trips_call.args[1]  # mismo id


def test_create_invalid_status_is_422_with_valid_list():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={
        "planning_date": "2026-07-06", "current_status": "VOLANDO",
    })
    assert res.status_code == 422
    assert "VOLANDO" in res.json()["detail"]
    assert "ASIGNADO" in res.json()["detail"]


def test_create_conflict_when_canonical_id_already_ingested():
    pool = make_pool(trip_exists=True)
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={
        "planning_date": "2026-07-06", "origin_tms": "qanalytics",
        "source_system_trip_id": "1994062", "client_name": "walmart",
    })
    assert res.status_code == 409
    assert "qanalytics" in res.json()["detail"]


def test_create_puts_phone_in_fleet_when_no_company():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={
        "planning_date": "2026-07-06", "driver_phone": "+56911112222",
    })
    assert res.status_code == 200
    manual_call = next(c for c in pool.execute.call_args_list if "app.trips_manual" in c.args[0])
    fleet_arg = next(a for a in manual_call.args if isinstance(a, str) and "driver_phone" in a)
    assert json.loads(fleet_arg)["driver_phone"] == "+56911112222"


# ── POST /trips/bulk ─────────────────────────────────────────────────────────

def test_bulk_reports_row_errors_before_inserting():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips/bulk", json=[
        {"planning_date": "2026-07-06", "current_status": "ASIGNADO"},
        {"planning_date": "2026-07-06", "current_status": "NO-EXISTE"},
    ])
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert errors[0]["row"] == 2
    # ninguna fila insertada
    assert not any("INSERT" in str(c) for c in pool.execute.call_args_list)


def test_bulk_detects_in_file_duplicates():
    pool = make_pool()
    client = make_client(pool)
    row = {"planning_date": "2026-07-06", "origin_tms": "qanalytics",
           "source_system_trip_id": "111", "client_name": "walmart"}
    res = client.post("/api/v1/trips/bulk", json=[row, row])
    assert res.status_code == 422
    assert "Duplicado dentro del archivo" in res.json()["detail"]["errors"][0]["error"]


def test_bulk_success_returns_ids_and_empty_errors():
    pool = make_pool()
    conn = AsyncMock()
    conn.fetch.return_value = STATUS_ROWS

    def conn_fetchval(query, *args):
        if "SELECT source_system FROM app.trips" in query:
            return None
        return "ffffffff-0000-0000-0000-000000000001"
    conn.fetchval.side_effect = conn_fetchval

    acquire_ctx = MagicMock()
    acquire_ctx.__aenter__ = AsyncMock(return_value=conn)
    acquire_ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=acquire_ctx)
    tx_ctx = MagicMock()
    tx_ctx.__aenter__ = AsyncMock(return_value=None)
    tx_ctx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx_ctx)

    client = make_client(pool)
    res = client.post("/api/v1/trips/bulk", json=[
        {"planning_date": "2026-07-06", "client_name": "Acme"},
        {"planning_date": "2026-07-07", "client_name": "Acme"},
    ])
    assert res.status_code == 200
    data = res.json()
    assert data["created"] == 2
    assert data["errors"] == []
    assert len(data["ids"]) == 2


# ── Ubicación complementaria (región/ciudad) ─────────────────────────────────

def test_create_persists_origin_location_and_stop_destination():
    pool = make_pool()
    client = make_client(pool)
    res = client.post("/api/v1/trips", json={
        "planning_date": "2026-07-06",
        "origin_region": "Región Metropolitana de Santiago",
        "origin_city": "Pudahuel",
        "stops": [{"local": "CD El Peñón",
                   "destination_region": "Región Metropolitana de Santiago",
                   "destination_city": "San Bernardo"}],
    })
    assert res.status_code == 200
    manual_call = next(c for c in pool.execute.call_args_list if "app.trips_manual" in c.args[0])
    trips_call  = next(c for c in pool.execute.call_args_list if "INSERT INTO app.trips " in c.args[0])
    for call in (manual_call, trips_call):
        assert "Región Metropolitana de Santiago" in call.args
        assert "Pudahuel" in call.args
        stops_arg = next(a for a in call.args if isinstance(a, str) and a.startswith("["))
        stops = json.loads(stops_arg)
        assert stops[0]["destination_city"] == "San Bernardo"
        assert stops[0]["destination_region"] == "Región Metropolitana de Santiago"

    # Fase 2 del hardening H2.6: la parada también se espeja en app.trip_stops
    # (los viajes manuales nunca pasan por el pipeline dbt que puebla esa tabla).
    trip_stops_call = next(c for c in pool.execute.call_args_list if "INSERT INTO app.trip_stops" in c.args[0])
    assert "San Bernardo" in trip_stops_call.args
    assert "Región Metropolitana de Santiago" in trip_stops_call.args
    assert "CD El Peñón" in trip_stops_call.args


def test_patch_origin_location_updates_and_marks_manual_edit():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={
        "origin_region": "Biobío", "origin_city": "Concepción",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "origin_region" in update.args[0]
    assert "origin_city" in update.args[0]
    assert "manually_edited_fields" in update.args[0]
    assert "Biobío" in update.args and "Concepción" in update.args
    # el mirror a trips_manual conserva la asignación tras un rebuild de dbt
    mirror = [c for c in pool.execute.call_args_list if "UPDATE app.trips_manual m SET" in c.args[0]]
    assert mirror and "origin_region" in mirror[0].args[0]
