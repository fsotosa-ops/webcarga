from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router, _apply_stop_manual_fields
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"  # SELECT id FROM app.trips (exists check)
    pool.fetchrow.return_value = {"id": "trip-1", "stops": "[]"}
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── Carga Inicio/Fin (origen) vía PATCH /trips/{id} ──────────────────────────

def test_patch_cag_inicio_at_and_fin_at_persists_as_timestamptz():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={
        "cag_inicio_at": "2026-07-17T09:00:00", "cag_fin_at": "2026-07-17T09:30:00",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "cag_inicio_at = $" in update.args[0]
    assert "cag_fin_at = $" in update.args[0]
    assert "::timestamptz" in update.args[0]
    assert "2026-07-17T09:00:00" in update.args and "2026-07-17T09:30:00" in update.args


def test_patch_cag_inicio_at_alone_does_not_touch_cag_fin_at():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"cag_inicio_at": "2026-07-17T09:00:00"})
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "cag_inicio_at = $" in update.args[0]
    assert "cag_fin_at" not in update.args[0]


# ── Desc. Inicio/Fin por parada vía PATCH /trips/{id}/stops/{stop_id} ────────

def test_patch_stop_persists_desc_fields_in_stop_manual_fields():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={
        "desc_inicio": "2026-07-17T10:00:00", "desc_fin": "2026-07-17T10:45:00",
    })
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if "stop_manual_fields = jsonb_set" in c.args[0])
    assert update.args[1] == "trip-1"
    assert update.args[2] == "stop-abc"
    assert '"desc_inicio": "2026-07-17T10:00:00"' in update.args[3]
    assert '"desc_fin": "2026-07-17T10:45:00"' in update.args[3]


def test_patch_stop_requires_at_least_one_field():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1/stops/stop-abc", json={})
    assert res.status_code == 422


def test_patch_stop_404_when_trip_missing():
    pool = make_pool()
    pool.fetchval.return_value = None
    client = make_client(pool)
    res = client.patch("/api/v1/trips/nope/stops/stop-abc", json={"desc_inicio": "2026-07-17T10:00:00"})
    assert res.status_code == 404


# ── Merge de stop_manual_fields sobre stops al leer (_apply_stop_manual_fields) ─

def test_apply_stop_manual_fields_overrides_unload_start_end_and_marks_manual():
    d = {
        "stops": [
            {"stop_id": "s1", "unload_start": None, "unload_end": None},
            {"stop_id": "s2", "unload_start": "2026-07-17T08:00:00", "unload_end": None},
        ],
        "stop_manual_fields": {
            "s1": {"desc_inicio": "2026-07-17T10:00:00", "desc_fin": "2026-07-17T10:45:00"},
        },
    }
    _apply_stop_manual_fields(d)
    assert "stop_manual_fields" not in d  # no se expone crudo en la respuesta
    s1, s2 = d["stops"]
    assert s1["unload_start"] == "2026-07-17T10:00:00"
    assert s1["unload_end"] == "2026-07-17T10:45:00"
    assert s1["desc_manual"] is True
    # s2 no tiene override: valor del TMS intacto, marcado explícitamente no-manual
    assert s2["unload_start"] == "2026-07-17T08:00:00"
    assert s2["desc_manual"] is False


def test_apply_stop_manual_fields_partial_override_keeps_other_field():
    d = {
        "stops": [{"stop_id": "s1", "unload_start": "2026-07-17T08:00:00", "unload_end": "2026-07-17T09:00:00"}],
        "stop_manual_fields": {"s1": {"desc_inicio": "2026-07-17T10:00:00"}},
    }
    _apply_stop_manual_fields(d)
    s1 = d["stops"][0]
    assert s1["unload_start"] == "2026-07-17T10:00:00"
    assert s1["unload_end"] == "2026-07-17T09:00:00"  # sin override, queda el valor del TMS


def test_apply_stop_manual_fields_noop_when_no_overrides():
    d = {"stops": [{"stop_id": "s1", "unload_start": None, "unload_end": None}], "stop_manual_fields": {}}
    _apply_stop_manual_fields(d)
    assert d["stops"][0]["unload_start"] is None
    assert "desc_manual" not in d["stops"][0]


def test_apply_stop_manual_fields_parses_json_string():
    d = {
        "stops": [{"stop_id": "s1", "unload_start": None, "unload_end": None}],
        "stop_manual_fields": '{"s1": {"desc_inicio": "2026-07-17T10:00:00"}}',
    }
    _apply_stop_manual_fields(d)
    assert d["stops"][0]["unload_start"] == "2026-07-17T10:00:00"
