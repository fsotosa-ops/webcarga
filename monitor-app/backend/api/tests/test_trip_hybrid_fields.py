from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router, _load_trip_stops, _parse_timestamptz, _attach_origin
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"  # SELECT id FROM app.trips / app.trip_stops (exists check)
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None}
    pool.fetch.return_value = []  # _load_trip_stops / _load_operation_type_buckets
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── Carga Inicio/Fin (origen) — Fase 1 del hardening del Diario (2026-07-18):
# ya no se editan vía PATCH /trips/{id} (cag_inicio_at/cag_fin_at fueron
# eliminados de app.trips) — el origen es una parada más (stop_type=ORIGIN),
# se edita con el MISMO mecanismo que Desc. Inicio/Fin de cualquier destino
# (PATCH /trips/{id}/stops/{stop_id}), ya cubierto por
# test_patch_stop_persists_desc_fields_in_trip_stops_table de abajo — ese
# endpoint no distingue stop_type, así que no hace falta un test aparte.


# ── Desc. Inicio/Fin por parada vía PATCH /trips/{id}/stops/{stop_id} ────────
# Fase 2 del hardening H2.6: persisten en app.trip_stops.desc_inicio_manual/
# desc_fin_manual (columnas reales), reemplazan el parche jsonb stop_manual_fields.

def test_patch_stop_persists_desc_fields_in_trip_stops_table():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={
        "desc_inicio": "2026-07-17T10:00:00", "desc_fin": "2026-07-17T10:45:00",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].strip().startswith("UPDATE app.trip_stops SET"))
    assert "desc_inicio_manual" in update.args[0]
    assert "desc_fin_manual" in update.args[0]
    assert update.args[1] == "stop-abc"
    assert update.args[2] == "trip-1"
    # Parseado a datetime real con tzinfo de Chile explícito — asyncpg exige
    # datetime.datetime (no str) para ::timestamptz, y sin fijar la zona acá
    # tomaría el huso horario del SISTEMA OPERATIVO del proceso, no el de
    # Chile (bug real encontrado en vivo, ver _parse_timestamptz).
    from zoneinfo import ZoneInfo
    chile = ZoneInfo("America/Santiago")
    assert update.args[3] == datetime(2026, 7, 17, 10, 0, tzinfo=chile)
    assert update.args[4] == datetime(2026, 7, 17, 10, 45, tzinfo=chile)


def test_patch_stop_requires_at_least_one_field():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={})
    assert res.status_code == 422


def test_patch_stop_404_when_stop_missing():
    pool = make_pool()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/nope", json={"desc_inicio": "2026-07-17T10:00:00"})
    assert res.status_code == 404


# ── Carga de app.trip_stops en batch (_load_trip_stops) ──────────────────────

def _stop_row(**overrides):
    base = {
        "stop_id": "s1", "trip_id": "trip-1", "stop_order": 0, "local": "Local 1",
        "destination_city": None, "destination_region": None, "on_time_status": None,
        "milestone_status": None, "s2s": None, "temperature": None, "planning_date": None,
        "arrival_date": None, "departure_date": None, "departure_date_prog": None,
        "gps_arrival_date": None, "gps_departure_date": None,
        "unload_start": None, "unload_end": None,
        "desc_inicio_manual": None, "desc_fin_manual": None,
    }
    base.update(overrides)
    return base


async def _run_load_trip_stops(pool, trip_ids):
    return await _load_trip_stops(pool, trip_ids)


def test_load_trip_stops_overrides_unload_start_end_and_marks_manual():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", unload_start=None, unload_end=None,
                  desc_inicio_manual="2026-07-17T10:00:00", desc_fin_manual="2026-07-17T10:45:00"),
        _stop_row(stop_id="s2", stop_order=1, unload_start="2026-07-17T08:00:00", unload_end=None),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stops = result["trip-1"]
    s1, s2 = stops
    assert s1["unload_start"] == "2026-07-17T10:00:00"
    assert s1["unload_end"] == "2026-07-17T10:45:00"
    assert s1["desc_manual"] is True
    assert "desc_inicio_manual" not in s1  # no se expone crudo en la respuesta
    # s2 no tiene override: valor del TMS intacto, marcado explícitamente no-manual
    assert s2["unload_start"] == "2026-07-17T08:00:00"
    assert s2["desc_manual"] is False


def test_load_trip_stops_partial_override_keeps_other_field():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", unload_start="2026-07-17T08:00:00", unload_end="2026-07-17T09:00:00",
                  desc_inicio_manual="2026-07-17T10:00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    s1 = result["trip-1"][0]
    assert s1["unload_start"] == "2026-07-17T10:00:00"
    assert s1["unload_end"] == "2026-07-17T09:00:00"  # sin override, queda el valor del TMS


def test_load_trip_stops_empty_for_no_trip_ids():
    import asyncio
    pool = AsyncMock()
    result = asyncio.run(_run_load_trip_stops(pool, set()))
    assert result == {}
    pool.fetch.assert_not_called()


def test_get_trip_endpoint_assembles_stops_from_trip_stops_table():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": "walmart"}

    def fetch_side_effect(query, *args):
        if "FROM app.trip_stops" in query:
            return [_stop_row(stop_id="s1", local="Alameda", desc_inicio_manual="2026-07-17T10:00:00")]
        return []  # _load_operation_type_buckets: sin locations en este test
    pool.fetch.side_effect = fetch_side_effect
    client = make_client(pool)

    res = client.get("/api/v1/trips/trip-1")

    assert res.status_code == 200
    body = res.json()
    assert len(body["stops"]) == 1
    assert body["stops"][0]["local"] == "Alameda"
    assert body["stops"][0]["unload_start"] == "2026-07-17T10:00:00"
    assert body["stops"][0]["desc_manual"] is True


def test_load_trip_stops_orders_by_stop_order_within_trip():
    import asyncio
    pool = AsyncMock()
    # ORDER BY trip_id, stop_order ya lo hace la query — acá solo confirmamos
    # que el orden de las filas devueltas por la DB se preserva en la lista.
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=0, local="Primero"),
        _stop_row(stop_id="s2", stop_order=1, local="Segundo"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Primero", "Segundo"]


# ── _parse_timestamptz — asyncpg exige datetime.datetime, no str, para un
#    parámetro casteado a ::timestamptz (bug real encontrado en vivo) ────────
# Un datetime naive sin tzinfo explícito toma el huso horario del SISTEMA
# OPERATIVO donde corre asyncpg al codificarlo — verificado en vivo que en
# un contenedor con TZ=UTC (el default de Cloud Run) eso guarda la hora
# corrida 3-4 horas respecto a lo que el operador tipeó. Por eso
# _parse_timestamptz debe fijar tzinfo=America/Santiago explícitamente
# cuando el string no trae offset — estos tests verifican eso, no el
# comportamiento "por defecto" de Python.

def test_parse_timestamptz_accepts_iso_with_seconds_and_offset():
    from datetime import timezone
    assert _parse_timestamptz("2026-07-17T10:00:00+00:00") == datetime(2026, 7, 17, 10, 0, tzinfo=timezone.utc)


def test_parse_timestamptz_naive_string_gets_chile_timezone_explicitly():
    from zoneinfo import ZoneInfo
    chile = ZoneInfo("America/Santiago")
    assert _parse_timestamptz("2026-07-17T10:00") == datetime(2026, 7, 17, 10, 0, tzinfo=chile)
    assert _parse_timestamptz("2026-07-17 10:00") == datetime(2026, 7, 17, 10, 0, tzinfo=chile)


def test_parse_timestamptz_none_for_empty():
    assert _parse_timestamptz(None) is None
    assert _parse_timestamptz("") is None


def test_parse_timestamptz_422_for_invalid_format():
    from fastapi import HTTPException
    import pytest
    with pytest.raises(HTTPException) as exc_info:
        _parse_timestamptz("no es una fecha")
    assert exc_info.value.status_code == 422


# ── _attach_origin — origen derivado de la parada ORIGIN (Fase 1, cutover
#    final del origen unificado como parada 0, 2026-07-18) ───────────────────

def test_attach_origin_uses_the_origin_stop_local():
    d = {"stops": [
        {"stop_id": "o1", "stop_type": "ORIGIN", "local": "CD Tambores"},
        {"stop_id": "s1", "stop_type": "DESTINATION", "local": "CD San Bernardo"},
    ]}
    _attach_origin(d)
    assert d["origin"] == "CD Tambores"


def test_attach_origin_none_when_no_origin_stop():
    d = {"stops": [{"stop_id": "s1", "stop_type": "DESTINATION", "local": "CD San Bernardo"}]}
    _attach_origin(d)
    assert d["origin"] is None


def test_attach_origin_none_for_empty_stops():
    d = {"stops": []}
    _attach_origin(d)
    assert d["origin"] is None


# ── driver_leg_number — "vuelta N" calculada, no is_first_leg manual ────────

def test_trip_from_joins_origin_stop_for_leg_number_ordering():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "LEFT JOIN app.trip_stops ots" in query
    assert "ots.stop_type = 'ORIGIN'" in query


def test_get_trip_endpoint_returns_driver_leg_number():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None, "driver_leg_number": 2}
    client = make_client(pool)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["driver_leg_number"] == 2


def test_trip_select_looks_up_driver_leg_number_from_view():
    pool = make_pool()
    client = make_client(pool)
    client.get("/api/v1/trips/trip-1")
    query = pool.fetchrow.call_args.args[0]
    assert "driver_leg_number" in query
    assert "app.v_driver_daily_trip_legs" in query
    # Lookup de una fila (no una ventana recalculada acá) — la ventana ya
    # vive adentro de la vista.
    assert "OVER (" not in query


def test_get_trip_endpoint_derives_origin_from_stops():
    pool = make_pool()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None}

    def fetch_side_effect(query, *args):
        if "FROM app.trip_stops" in query:
            return [
                _stop_row(stop_id="o1", stop_order=0, stop_type="ORIGIN", local="CD Tambores"),
                _stop_row(stop_id="s1", stop_order=1, stop_type="DESTINATION", local="CD San Bernardo"),
            ]
        return []
    pool.fetch.side_effect = fetch_side_effect
    client = make_client(pool)

    res = client.get("/api/v1/trips/trip-1")

    assert res.status_code == 200
    body = res.json()
    assert body["origin"] == "CD Tambores"
    assert [s["stop_type"] for s in body["stops"]] == ["ORIGIN", "DESTINATION"]
