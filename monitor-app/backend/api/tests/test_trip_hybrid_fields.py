from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import (
    router, _load_trip_stops, _mark_active_stop, _cargo_delivered,
    _classify_temperature, _trip_temp_status, _annotate_stop_temp_status,
    _parse_timestamptz, _attach_origin,
)
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


# ── Generalización del override manual a arrival/departure (bitácora
# 2026-07-29): mismo mecanismo que desc_inicio/desc_fin, replicado a los
# campos que la hoja "campos-seguimiento-viajes" documenta como editables
# por operaciones cuando la TMS no los reporta (Sodimac, principalmente).
# gps_arrival/gps_departure NO forman parte de esta generalización desde
# 2026-07-31 — GPS Llegada/Salida son inamovibles (minuta 29/07 §4.2).

def test_patch_stop_persists_arrival_departure_fields_in_trip_stops_table():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={
        "arrival": "2026-07-29T08:00:00",
        "departure": "2026-07-29T08:30:00",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].strip().startswith("UPDATE app.trip_stops SET"))
    query = update.args[0]
    assert "arrival_date_manual" in query
    assert "departure_date_manual" in query
    assert "gps_arrival_date_manual" not in query
    assert "gps_departure_date_manual" not in query

    from zoneinfo import ZoneInfo
    chile = ZoneInfo("America/Santiago")
    # desc_inicio/desc_fin no se enviaron en este PATCH — deben ir como None
    assert update.args[3] is None
    assert update.args[4] is None
    assert update.args[5] == datetime(2026, 7, 29, 8, 0, tzinfo=chile)
    assert update.args[6] == datetime(2026, 7, 29, 8, 30, tzinfo=chile)
    assert len(update.args) == 7  # sin parámetros gps_arrival/gps_departure


def test_patch_stop_silently_ignores_gps_arrival_and_gps_departure():
    """GPS Llegada/Salida son inamovibles (minuta 29/07 §4.2, fix
    2026-07-31) — TripStopPatch ya no declara esos campos, así que Pydantic
    los descarta como extra desconocidos. Combinado con un campo válido, el
    PATCH igual persiste ese campo y el valor GPS nunca llega a escribirse."""
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={
        "arrival": "2026-07-29T08:00:00",
        "gps_arrival": "2026-07-29T07:55:00",
        "gps_departure": "2026-07-29T08:35:00",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].strip().startswith("UPDATE app.trip_stops SET"))
    assert "gps_arrival_date_manual" not in update.args[0]
    assert "gps_departure_date_manual" not in update.args[0]


def test_patch_stop_with_only_gps_fields_is_treated_as_empty_patch():
    """Sin ningún campo válido en el body, el patch queda vacío tras el
    descarte de gps_arrival/gps_departure — mismo 422 que un body {}."""
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={
        "gps_arrival": "2026-07-29T07:55:00",
        "gps_departure": "2026-07-29T08:35:00",
    })
    assert res.status_code == 422


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
        "stop_id": "s1", "trip_id": "trip-1", "stop_order": 0, "stop_type": "DESTINATION", "local": "Local 1",
        "destination_city": None, "destination_region": None, "on_time_status": None,
        "milestone_status": None, "s2s": None, "temperature": None, "planning_date": None,
        "arrival_date": None, "departure_date": None, "departure_date_prog": None,
        "gps_arrival_date": None, "gps_departure_date": None,
        "unload_start": None, "unload_end": None,
        "desc_inicio_manual": None, "desc_fin_manual": None,
        "arrival_date_manual": None, "departure_date_manual": None,
        "created_at": None, "updated_at": None,
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


def test_load_trip_stops_overrides_arrival_departure_and_marks_manual():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(
            stop_id="s1", arrival_date=None, departure_date=None,
            arrival_date_manual="2026-07-29T08:00:00",
            departure_date_manual="2026-07-29T08:30:00",
        ),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    s1 = result["trip-1"][0]
    assert s1["arrival_date"] == "2026-07-29T08:00:00"
    assert s1["departure_date"] == "2026-07-29T08:30:00"
    assert s1["arrival_manual"] is True
    assert s1["departure_manual"] is True
    for raw_col in ("arrival_date_manual", "departure_date_manual"):
        assert raw_col not in s1  # no se expone crudo en la respuesta


def test_load_trip_stops_gps_fields_have_no_manual_override():
    """GPS Llegada/Salida son inamovibles (minuta 29/07 §4.2, fix
    2026-07-31) — _load_trip_stops ya no resuelve ningún override sobre
    gps_arrival_date/gps_departure_date ni expone flags gps_*_manual;
    quedan exactamente con lo que reportó el pipeline dbt."""
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", gps_arrival_date="2026-07-29T07:55:00", gps_departure_date=None),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    s1 = result["trip-1"][0]
    assert s1["gps_arrival_date"] == "2026-07-29T07:55:00"
    assert s1["gps_departure_date"] is None
    assert "gps_arrival_manual" not in s1
    assert "gps_departure_manual" not in s1


def test_load_trip_stops_tms_value_wins_when_no_manual_override():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", arrival_date="2026-07-29T09:00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    s1 = result["trip-1"][0]
    assert s1["arrival_date"] == "2026-07-29T09:00:00"
    assert s1["arrival_manual"] is False


def test_load_trip_stops_manual_arrival_date_affects_display_order():
    """Bug potencial: si se resuelve el override manual DESPUES de ordenar,
    una parada sin arrival_date del TMS pero con arrival_date_manual cargado
    a mano quedaría igual al final (ordenada con el None crudo). El override
    debe resolverse antes del sort para que la parada se mueva a su lugar
    cronológico real."""
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=1, local="TMS reporta 10:00", arrival_date="2026-07-29T10:00:00"),
        _stop_row(stop_id="s2", stop_order=2, local="Manual cargado 09:00", arrival_date=None,
                  arrival_date_manual="2026-07-29T09:00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Manual cargado 09:00", "TMS reporta 10:00"]


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


# ── Dedup de locales duplicados (bug reportado 2026-07-28) ───────────────────
# El pipeline dbt calcula stop_id incluyendo el nombre del local en el hash —
# cuando el TMS corrige ese nombre entre dos pasadas de scraping, queda una
# fila huérfana en vez de actualizarse. _load_trip_stops colapsa filas que
# comparten (trip_id, stop_type, stop_order) a una sola, ver plan
# docs/superpowers/plans/... (bug de locales duplicados en detalle de viaje).

def test_load_trip_stops_collapses_duplicate_position_keeping_latest_updated_at():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="old", stop_order=1, local="Melipilla - 451",
                  updated_at="2026-07-28T16:38:02+00:00", created_at="2026-07-28T16:09:22+00:00"),
        _stop_row(stop_id="new", stop_order=1, local="MAIPU - 61", arrival_date="2026-07-28T16:47:23+00:00",
                  updated_at="2026-07-28T20:09:01+00:00", created_at="2026-07-28T16:38:02+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stops = result["trip-1"]
    assert len(stops) == 1
    assert stops[0]["stop_id"] == "new"
    assert stops[0]["local"] == "MAIPU - 61"


def test_load_trip_stops_tiebreaks_by_created_at_when_updated_at_matches():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="older", stop_order=1, local=None,
                  updated_at="2026-07-18T22:55:35+00:00", created_at="2026-07-18T05:46:53+00:00"),
        _stop_row(stop_id="newer", stop_order=1, local="Local Centro de Distribución - 5105976",
                  updated_at="2026-07-18T22:55:35+00:00", created_at="2026-07-18T22:53:13+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stops = result["trip-1"]
    assert len(stops) == 1
    assert stops[0]["stop_id"] == "newer"


def test_load_trip_stops_tiebreaks_by_non_null_local_when_timestamps_match():
    import asyncio
    pool = AsyncMock()
    same_ts = "2026-07-18T22:55:35+00:00"
    pool.fetch.return_value = [
        _stop_row(stop_id="no-local", stop_order=1, local=None, updated_at=same_ts, created_at=same_ts),
        _stop_row(stop_id="has-local", stop_order=1, local="Local Centro de Distribución - 5105976",
                  updated_at=same_ts, created_at=same_ts),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stops = result["trip-1"]
    assert len(stops) == 1
    assert stops[0]["stop_id"] == "has-local"


def test_load_trip_stops_never_returns_more_than_one_row_per_position():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="a", stop_order=1, local="Camilo Henriquez - 802"),
        _stop_row(stop_id="b", stop_order=1, local="LAS REJAS - 140"),
        _stop_row(stop_id="c", stop_order=1, local="SAN PABLO - 137"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert len(result["trip-1"]) == 1


def test_load_trip_stops_does_not_collapse_different_stop_types_at_same_order():
    import asyncio
    pool = AsyncMock()
    # ORIGIN siempre stop_order=0, pero por las dudas: distinto stop_type
    # nunca debería colapsarse aunque coincida el stop_order.
    pool.fetch.return_value = [
        _stop_row(stop_id="origin", stop_order=1, stop_type="ORIGIN", local="CD El Peñon"),
        _stop_row(stop_id="dest", stop_order=1, stop_type="DESTINATION", local="MAIPU - 61"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert len(result["trip-1"]) == 2


def test_load_trip_stops_no_duplicates_passes_through_unchanged():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=0, stop_type="ORIGIN", local="CD El Peñon"),
        _stop_row(stop_id="s2", stop_order=1, local="MAIPU - 61"),
        _stop_row(stop_id="s3", stop_order=2, local="Melipilla - 451"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["CD El Peñon", "MAIPU - 61", "Melipilla - 451"]


def test_load_trip_stops_does_not_expose_created_at_or_updated_at():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", updated_at="2026-07-28T20:09:01+00:00", created_at="2026-07-28T16:09:22+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stop = result["trip-1"][0]
    assert "updated_at" not in stop
    assert "created_at" not in stop


# ── Orden de destinos por arrival_date ascendente (bug reportado 2026-07-28) ──
# stop_order refleja un orden inestable calculado aguas arriba (dbt ordena el
# array de paradas por hora de llegada en cada corrida — ver AGENTLOG Ronda
# 58) — la vista de detalle del viaje necesita mostrar los destinos en orden
# cronológico real, no en el stop_order crudo de la BD.

def test_load_trip_stops_orders_destinations_by_arrival_date_ascending():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=1, local="Segundo", arrival_date="2026-07-28T14:00:00+00:00"),
        _stop_row(stop_id="s2", stop_order=2, local="Primero", arrival_date="2026-07-28T10:00:00+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Primero", "Segundo"]


def test_load_trip_stops_origin_always_first_regardless_of_arrival_date():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="dest", stop_order=1, local="Destino", arrival_date="2026-07-28T05:00:00+00:00"),
        _stop_row(stop_id="orig", stop_order=0, stop_type="ORIGIN", local="Origen", arrival_date=None),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Origen", "Destino"]


def test_load_trip_stops_without_arrival_date_go_last():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=1, local="Sin llegada", arrival_date=None),
        _stop_row(stop_id="s2", stop_order=2, local="Con llegada", arrival_date="2026-07-28T10:00:00+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Con llegada", "Sin llegada"]


def test_load_trip_stops_arrival_date_tie_breaks_by_stop_order():
    import asyncio
    pool = AsyncMock()
    same_arrival = "2026-07-28T10:00:00+00:00"
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=2, local="Segundo por stop_order", arrival_date=same_arrival),
        _stop_row(stop_id="s2", stop_order=1, local="Primero por stop_order", arrival_date=same_arrival),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Primero por stop_order", "Segundo por stop_order"]


# Bug real reportado 2026-08-01 (viaje 2021621, QAnalytics): el orden usaba
# SOLO arrival_date (TR, ~8% de las paradas reales lo reportan) — con las
# 2 paradas en TR null, empataba y caía a stop_order crudo, dejando el
# destino SIN evidencia de visita ANTES del que sí tenía gps_arrival_date
# real. Como el estado done/activo/pendiente del frontend es puramente
# posicional respecto al índice de la parada activa, el destino visitado
# terminaba mostrado "pendiente" y el no visitado "completado" — al revés.

def test_load_trip_stops_orders_by_gps_arrival_when_tr_is_empty():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=1, local="BA CARMEN MAIPU - 533"),  # sin TR ni GPS
        _stop_row(stop_id="s2", stop_order=2, local="MAIPU - 75", gps_arrival_date="2026-08-01T12:51:38+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["MAIPU - 75", "BA CARMEN MAIPU - 533"]


def test_load_trip_stops_prefers_gps_arrival_over_tr_arrival_for_ordering():
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="s1", stop_order=1, local="Solo TR, más tarde", arrival_date="2026-07-28T14:00:00+00:00"),
        _stop_row(stop_id="s2", stop_order=2, local="Solo GPS, más temprano", gps_arrival_date="2026-07-28T10:00:00+00:00"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    assert [s["local"] for s in result["trip-1"]] == ["Solo GPS, más temprano", "Solo TR, más tarde"]


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


# ── _mark_active_stop — "en qué parada está el camión ahora" (bug real
#    reportado 2026-08-01: quedaba pegado en el origen para siempre en
#    viajes de QAnalytics/Sodimac, que nunca reportan la salida del
#    origen) — única fuente de verdad, antes reimplementada por separado
#    (con reglas ligeramente distintas) en 2 archivos de frontend. ────────

def test_mark_active_stop_is_origin_while_truck_has_not_left_yet():
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen")
    dest = _stop_row(stop_id="d1", stop_order=1, local="Destino 1")
    stops = [origin, dest]
    _mark_active_stop(stops)
    assert origin["is_active"] is True
    assert dest["is_active"] is False


def test_mark_active_stop_does_not_get_stuck_at_origin_once_gps_shows_a_later_arrival():
    """Caso real: viaje 2021346 (QAnalytics) — origen sin arrival_date NI
    departure_date NI gps_departure_date (QAnalytics nunca reporta la
    salida del origen), pero un destino más adelante ya tiene
    gps_arrival_date real. El origen no puede seguir "activo"."""
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD EL PEÑON")
    skipped = _stop_row(stop_id="d1", stop_order=1, local="SB Casablanca - 746")
    reached = _stop_row(stop_id="d2", stop_order=2, local="VIÑA DEL MAR - 58",
                         gps_arrival_date="2026-08-01 09:55:56")
    stops = [origin, skipped, reached]
    _mark_active_stop(stops)
    assert origin["is_active"] is False
    assert reached["is_active"] is True
    assert skipped["is_active"] is False


def test_mark_active_stop_treats_origin_as_departed_via_gps_departure_date():
    """Wingsuite sí reporta la salida del origen (Ronda 61) — ese caso ya
    funcionaba antes del fix y debe seguir funcionando."""
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen",
                        gps_departure_date="2026-08-01 08:00:00")
    dest = _stop_row(stop_id="d1", stop_order=1, local="Destino 1")
    stops = [origin, dest]
    _mark_active_stop(stops)
    assert origin["is_active"] is False
    assert dest["is_active"] is True


def test_mark_active_stop_prefers_gps_arrival_over_tr_arrival():
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen",
                        departure_date="2026-08-01 08:00:00")
    in_progress = _stop_row(stop_id="d1", stop_order=1, local="Con GPS sin TR",
                             gps_arrival_date="2026-08-01 10:00:00")
    stops = [origin, in_progress]
    _mark_active_stop(stops)
    assert in_progress["is_active"] is True


def test_mark_active_stop_none_active_when_trip_fully_completed():
    """FIX 2026-08-02 (bug real, viajes 2021621/30159639): si TODAS las
    paradas ya llegaron y salieron, no debe quedar ninguna parada "activa"
    — antes se caía a la última visitada, mostrándola "en curso" (pulsing)
    aunque ya tuviera salida real registrada."""
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen",
                        departure_date="2026-08-01 08:00:00")
    done = _stop_row(stop_id="d1", stop_order=1, local="Destino 1",
                      arrival_date="2026-08-01 09:00:00", departure_date="2026-08-01 09:30:00")
    stops = [origin, done]
    _mark_active_stop(stops)
    assert origin["is_active"] is False
    assert done["is_active"] is False


def test_mark_active_stop_none_active_with_multiple_completed_destinations():
    """Caso real: viaje 2021621 (QAnalytics) — 2 destinos, ambos con GPS
    llegada Y salida ya registradas, origen sin datos de salida (nunca
    reportada). Antes se marcaba la ÚLTIMA parada como activa aunque ya
    hubiera salido — debía mostrarse completada (check verde), no en
    curso (pulsing)."""
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD EL PEÑON")
    d1 = _stop_row(stop_id="d1", stop_order=1, local="MAIPU - 75",
                    gps_arrival_date="2026-08-01 12:51:38", gps_departure_date="2026-08-01 15:34:55")
    d2 = _stop_row(stop_id="d2", stop_order=2, local="BA CARMEN MAIPU - 533",
                    gps_arrival_date="2026-08-01 16:11:44", gps_departure_date="2026-08-01 18:08:23")
    stops = [origin, d1, d2]
    _mark_active_stop(stops)
    assert origin["is_active"] is False
    assert d1["is_active"] is False
    assert d2["is_active"] is False


# ── _cargo_delivered — "¿ya no hay carga fría a bordo?" (reportado
#    2026-08-01: temperatura de cumplimiento se seguía evaluando después de
#    que el camión entregó TODA la carga — QAnalytics reporta 'T°' como la
#    lectura EN VIVO del vehículo, no una foto histórica por parada
#    (confirmado con datos reales: 62 paradas nunca visitadas ya traían
#    temperatura poblada, y el primer scrape de un viaje ya mostraba la
#    misma T° en las 6 paradas antes de llegar a ninguna). Una vez que el
#    camión sale de su última parada, sigue reportando "la T° actual" pero
#    ya no es carga refrigerada — no debe seguir contando como posible
#    incumplimiento. ─────────────────────────────────────────────────────

def test_cargo_delivered_false_while_a_destination_is_still_pending():
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen")
    done = _stop_row(stop_id="d1", stop_order=1, local="Destino 1",
                      departure_date="2026-08-01 09:30:00")
    pending = _stop_row(stop_id="d2", stop_order=2, local="Destino 2")
    assert _cargo_delivered([origin, done, pending]) is False


def test_cargo_delivered_true_when_all_destinations_have_departed():
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen")
    d1 = _stop_row(stop_id="d1", stop_order=1, local="Destino 1",
                    departure_date="2026-08-01 09:30:00")
    d2 = _stop_row(stop_id="d2", stop_order=2, local="Destino 2",
                    departure_date="2026-08-01 11:00:00")
    assert _cargo_delivered([origin, d1, d2]) is True


def test_cargo_delivered_true_via_gps_departure_only():
    """Wingsuite reporta salida real solo por GPS (Ronda 61) — debe contar igual."""
    d1 = _stop_row(stop_id="d1", stop_order=1, local="Destino 1",
                    gps_departure_date="2026-08-01 09:30:00")
    assert _cargo_delivered([d1]) is True


def test_cargo_delivered_ignores_origin_departure():
    """El origen nunca transporta carga fría "entregada" — solo importan los destinos."""
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen")
    pending = _stop_row(stop_id="d1", stop_order=1, local="Destino 1")
    assert _cargo_delivered([origin, pending]) is False


def test_cargo_delivered_false_when_trip_has_no_destinations():
    origin = _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD Origen",
                        departure_date="2026-08-01 08:00:00")
    assert _cargo_delivered([origin]) is False


# ── _trip_temp_status — clasificación de cumplimiento de cadena de frío
#    (movida del frontend al backend 2026-08-01, feedback directo del
#    usuario: "de nuevo metiste reglas de negocio en el frontend" — misma
#    categoría que _mark_active_stop, no una decisión de presentación.
#    ─────────────────────────────────────────────────────────────────────

_RANGES = {"Congelado": (-25.0, -15.0)}


def test_classify_temperature_out_of_range():
    assert _classify_temperature(-5, "Congelado", _RANGES) == "out_of_range"


def test_classify_temperature_ok():
    assert _classify_temperature(-20, "Congelado", _RANGES) == "ok"


def test_classify_temperature_null_when_no_range_for_cargo_type():
    assert _classify_temperature(-5, "Seco", _RANGES) is None


def test_classify_temperature_null_when_temp_is_none():
    assert _classify_temperature(None, "Congelado", _RANGES) is None


def test_trip_temp_status_classifies_normally_while_cargo_pending():
    stop = _stop_row(stop_id="d1", arrival_date="2026-08-01 10:00:00", temperature=-5, is_active=True)
    assert _trip_temp_status([stop], "Congelado", cargo_delivered=False, ranges=_RANGES) == "out_of_range"


def test_trip_temp_status_none_once_cargo_delivered_even_if_reading_out_of_range():
    """El bug real reportado: la lectura EN VIVO (vehículo ya vacío) sigue
    subiendo después de la última entrega, pero ya no es un incumplimiento."""
    stop = _stop_row(stop_id="d1", arrival_date="2026-08-01 10:00:00",
                      departure_date="2026-08-01 10:30:00", temperature=18, is_active=True)
    assert _trip_temp_status([stop], "Congelado", cargo_delivered=True, ranges=_RANGES) is None


def test_trip_temp_status_none_when_no_stop_has_a_reading():
    stop = _stop_row(stop_id="d1", arrival_date="2026-08-01 10:00:00", temperature=None, is_active=True)
    assert _trip_temp_status([stop], "Congelado", cargo_delivered=False, ranges=_RANGES) is None


# ── _annotate_stop_temp_status — clasificación de cumplimiento POR PARADA
#    (2026-08-01, pedido explícito del usuario: "¿los destinos van a
#    freezear su temperatura para saber si cumplieron? tiene sentido hacer
#    esto último?" — a diferencia de _trip_temp_status, NO se apaga con
#    cargo_delivered: un valor ya congelado (ver trip_stops.sql) es
#    exactamente lo que se quiere auditar por entrega, incluso después de
#    que el viaje completo. Solo se clasifican paradas YA visitadas — una
#    parada pendiente todavía espeja la lectura en vivo del vehículo, no
#    representa esa parada todavía. ─────────────────────────────────────

def test_annotate_stop_temp_status_classifies_visited_stop():
    stop = _stop_row(stop_id="d1", arrival_date="2026-08-01 10:00:00",
                      departure_date="2026-08-01 10:30:00", temperature=-5)
    stops = [stop]
    _annotate_stop_temp_status(stops, "Congelado", _RANGES)
    assert stop["temp_status"] == "out_of_range"


def test_annotate_stop_temp_status_null_for_unvisited_stop():
    """Una parada sin llegada aún espeja la lectura EN VIVO del vehículo
    (no es su propio dato todavía) — no se clasifica, aunque tenga un
    valor numérico poblado."""
    stop = _stop_row(stop_id="d1", temperature=-5)
    stops = [stop]
    _annotate_stop_temp_status(stops, "Congelado", _RANGES)
    assert stop["temp_status"] is None


def test_annotate_stop_temp_status_does_not_gate_on_cargo_delivered():
    """A diferencia de _trip_temp_status: una parada YA congelada (salió)
    se sigue clasificando aunque el viaje completo ya haya entregado todo
    — es justo el dato histórico que se quiere auditar."""
    delivered_stop = _stop_row(stop_id="d1", arrival_date="2026-08-01 10:00:00",
                                departure_date="2026-08-01 10:30:00", temperature=-20)
    stops = [delivered_stop]
    _annotate_stop_temp_status(stops, "Congelado", _RANGES)
    assert delivered_stop["temp_status"] == "ok"


def test_annotate_stop_temp_status_null_for_origin():
    origin = _stop_row(stop_id="origin", stop_type="ORIGIN", temperature=None)
    stops = [origin]
    _annotate_stop_temp_status(stops, "Congelado", _RANGES)
    assert origin["temp_status"] is None


def test_load_trip_stops_exposes_is_active_and_does_not_get_stuck_at_origin():
    """Mismo caso real de arriba, pero pasando por _load_trip_stops
    completo (dedup + override resolution + sort + _mark_active_stop) para
    confirmar que is_active sobrevive el pipeline de lectura real."""
    import asyncio
    pool = AsyncMock()
    pool.fetch.return_value = [
        _stop_row(stop_id="origin", stop_order=0, stop_type="ORIGIN", local="CD EL PEÑON"),
        _stop_row(stop_id="d1", stop_order=1, local="SB Casablanca - 746"),
        _stop_row(stop_id="d2", stop_order=2, local="VIÑA DEL MAR - 58",
                  gps_arrival_date="2026-08-01 09:55:56"),
    ]
    result = asyncio.run(_run_load_trip_stops(pool, {"trip-1"}))
    stops = result["trip-1"]
    active = [s for s in stops if s["is_active"]]
    assert len(active) == 1
    assert active[0]["local"] == "VIÑA DEL MAR - 58"
