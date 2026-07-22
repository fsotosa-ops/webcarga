from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.config import router as config_router
from app.routers.trips import router as trips_router
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_admin, require_editor

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}

RULES_ROW = {
    "stale_report_hours": 2.0, "dwell_hours": 2.0,
    "late_arrival_grace_min": 60, "unassigned_enabled": True,
}


def make_client(pool, router=config_router):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


# ── /config/statuses — fix del bug group_id vs group ─────────────────────────

def test_list_statuses_returns_group_key():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "RUTA", "label": "RUTA", "bg_color": "#fff", "text_color": "#000",
        "group": "en_ruta", "sort_order": 1,
    }]
    client = make_client(pool)
    res = client.get("/api/v1/config/statuses")
    assert res.status_code == 200
    assert res.json()[0]["group"] == "en_ruta"
    # la query usa el alias — no expone group_id crudo
    assert 'group_id AS "group"' in pool.fetch.call_args.args[0]


# ── /config/operational-states — group_id nuevo ──────────────────────────────

def test_create_operational_state_with_invalid_group_is_422():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post("/api/v1/config/operational-states",
                      json={"label": "En bodega", "group_id": "no-existe"})
    assert res.status_code == 422


def test_patch_operational_state_accepts_group_id():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [
        {"id": "s1"},
        {"id": "s1", "label": "En bodega", "bg_color": "#fff", "text_color": "#000",
         "sort_order": 1, "active": True, "group": "en_local"},
    ]
    client = make_client(pool)
    res = client.patch("/api/v1/config/operational-states/s1", json={"group_id": "en_local"})
    assert res.status_code == 200
    assert res.json()["group"] == "en_local"


# ── /config/monitor-alert-rules ───────────────────────────────────────────────

def test_get_monitor_alert_rules():
    pool = AsyncMock()
    pool.fetchrow.return_value = RULES_ROW
    client = make_client(pool)
    res = client.get("/api/v1/config/monitor-alert-rules")
    assert res.status_code == 200
    assert res.json()["dwell_hours"] == 2.0


def test_patch_monitor_alert_rules_validates_positive_hours():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/config/monitor-alert-rules", json={"dwell_hours": 0})
    assert res.status_code == 422


def test_patch_monitor_alert_rules_updates():
    pool = AsyncMock()
    pool.fetchrow.return_value = {**RULES_ROW, "dwell_hours": 3.5}
    client = make_client(pool)
    res = client.patch("/api/v1/config/monitor-alert-rules", json={"dwell_hours": 3.5})
    assert res.status_code == 200
    assert res.json()["dwell_hours"] == 3.5


# ── /trips/available-drivers ──────────────────────────────────────────────────

def test_available_drivers_requires_fecha():
    pool = AsyncMock()
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-drivers")
    assert res.status_code == 422


def test_available_drivers_returns_rows_and_excludes_sodimac_in_query():
    # Fase 3 del hardening del Diario (2026-07-18): la query dejó de agrupar
    # por nombre de texto libre dentro de los viajes del día — ahora parte
    # del directorio real (conductor activo de empresa activa) y recién ahí
    # cruza contra los viajes del día, para no perder a los conductores sin
    # NINGÚN viaje hoy. Ronda 26 (TripAssignDialog): suma carrier_id/
    # tractor_asset_id reales (no solo texto) y cae al vehículo estándar del
    # conductor (vehicle_driver_assignments) cuando no hay viaje hoy.
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9",
        "driver_phone": "+56911112222", "carrier_id": "c1", "carrier_name": "TransCargo",
        "tractor_asset_id": "a1", "tractor_plate": "ABCD12", "trips_total": 2,
        "last_report_at": "2026-07-06T18:00:00",
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-drivers?fecha=2026-07-06")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["driver_name"] == "Juan Pérez"
    assert data[0]["carrier_id"] == "c1"
    assert data[0]["tractor_asset_id"] == "a1"
    query = pool.fetch.call_args.args[0]
    assert "sodimac" in query                        # exclusión de la fuente sin flota
    assert "public.driver_assignments" in query       # directorio real, no texto libre
    assert "operational_status = 'ACTIVE'" in query    # solo conductores/empresas activas
    assert "public.vehicle_driver_assignments" in query  # vehículo estándar, no solo el de hoy


def test_available_drivers_today_trips_uses_shared_resolution_view():
    """Fase B (feedback post-weekly 2026-07-22, ítem 5): today_trips
    detectaba "tiene viaje hoy" mirando solo trip_fleet_links.driver_id, sin
    la cadena de resolución en vivo — un conductor con viaje ya resuelto
    (auto por patente/vehicle_driver_assignments/nombre) podía seguir
    apareciendo acá como "disponible" (confirmado contra datos reales:
    2026-07-21, 1 conductor del roster resuelto en vivo, 0 detectados).
    Ahora usa la misma vista que _TRIP_FROM/daily_closures.py."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-drivers?fecha=2026-07-06")
    query = pool.fetch.call_args.args[0]
    assert "app.v_trip_fleet_resolution" in query
    assert "vfr.resolved_driver_id" in query


# ── /trips/available-assets ─────────────────────────────────────────────────

def test_available_assets_requires_fecha():
    pool = AsyncMock()
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets")
    assert res.status_code == 422


def test_available_assets_returns_rows_from_active_roster():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "asset_id": "a1", "tractor_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "carrier_name": "TransCargo", "trips_total": 0, "last_report_at": None,
        "driver_name": None,
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    assert res.status_code == 200
    data = res.json()
    assert data[0]["tractor_plate"] == "ABCD12"
    query = pool.fetch.call_args.args[0]
    assert "public.asset_assignments" in query
    assert "sodimac" in query


def test_available_assets_today_trips_uses_shared_resolution_view():
    """Fase B (feedback post-weekly 2026-07-22, ítem 5): mismo fix que
    available-drivers, para el lado del equipo/tracto."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args.args[0]
    assert "app.v_trip_fleet_resolution" in query
    assert "vfr.resolved_tractor_asset_id" in query


# ── list_trips q amplía a cliente ─────────────────────────────────────────────

def test_list_trips_q_matches_client_name():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?q=walmart&view=historial")
    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "t.client_name ILIKE" in query


def test_list_trips_second_leg_plus_filters_against_driver_daily_trip_legs_view():
    # Ronda 26 (escalabilidad de filtros): reemplaza is_first_leg (columna
    # manual/TMS) como fuente del filtro "2ª+ vuelta" — la columna sigue
    # existiendo en la base, solo dejó de ser lo que este filtro consulta.
    # driver_leg_number es un alias de SELECT (Plan 1), no una columna real
    # de app.trips — no se puede referenciar directo en un WHERE del mismo
    # nivel, por eso la query real vuelve a resolver contra la vista.
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?second_leg_plus=true&view=historial")
    assert res.status_code == 200
    query = pool.fetch.call_args.args[0]
    assert "app.v_driver_daily_trip_legs" in query
    assert "leg_number >= 2" in query


def test_trip_select_resolves_shipper_id_live_via_client_name_match():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": "Walmart", "shipper_id": "s1", "shipper_name": "Walmart"}
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/trip-1")
    assert res.status_code == 200
    assert res.json()["shipper_id"] == "s1"
    query = pool.fetchrow.call_args.args[0]
    assert "public.shippers" in query
    assert "lower(trim(" in query
