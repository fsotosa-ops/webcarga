from unittest.mock import AsyncMock, MagicMock, patch

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
    "dwell_yellow_min": 60, "dwell_orange_min": 90, "dwell_red_min": 120,
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


# ── /config/temperature-ranges ────────────────────────────────────────────────
# Auditoría 2026-07-27: GET /trips/meta queda cacheado 5 min (CacheMiddleware)
# — sin invalidar acá, un admin que configura un rango de temperatura no lo ve
# reflejado en el Diario hasta que expire el TTL. Confirmado en vivo contra
# producción antes de agregar el fix (el pill de temperatura seguía "ok"
# varios minutos después de crear el rango).

def test_create_temperature_range_invalidates_meta_cache():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [None, {"cargo_type": "FRIO", "label": "Frío", "min_c": 2, "max_c": 5}]
    client = make_client(pool)
    with patch("app.routers.config.invalidate_trips_meta_cache", new_callable=AsyncMock) as inv:
        res = client.post("/api/v1/config/temperature-ranges", json={
            "cargo_type": "FRIO", "label": "Frío", "min_c": 2, "max_c": 5,
        })
    assert res.status_code == 200
    inv.assert_awaited_once()


def test_patch_temperature_range_invalidates_meta_cache():
    pool = AsyncMock()
    existing = {"cargo_type": "FRIO", "label": "Frío", "min_c": 0, "max_c": 5}
    pool.fetchrow.side_effect = [existing, {**existing, "min_c": 2}]
    client = make_client(pool)
    with patch("app.routers.config.invalidate_trips_meta_cache", new_callable=AsyncMock) as inv:
        res = client.patch("/api/v1/config/temperature-ranges/FRIO", json={"min_c": 2})
    assert res.status_code == 200
    inv.assert_awaited_once()


def test_delete_temperature_range_invalidates_meta_cache():
    pool = AsyncMock()
    pool.execute.return_value = "DELETE 1"
    client = make_client(pool)
    with patch("app.routers.config.invalidate_trips_meta_cache", new_callable=AsyncMock) as inv:
        res = client.delete("/api/v1/config/temperature-ranges/FRIO")
    assert res.status_code == 200
    inv.assert_awaited_once()


def test_patch_monitor_alert_rules_invalidates_meta_cache():
    pool = AsyncMock()
    pool.fetchrow.return_value = {**RULES_ROW, "dwell_hours": 3.5}
    client = make_client(pool)
    with patch("app.routers.config.invalidate_trips_meta_cache", new_callable=AsyncMock) as inv:
        res = client.patch("/api/v1/config/monitor-alert-rules", json={"dwell_hours": 3.5})
    assert res.status_code == 200
    inv.assert_awaited_once()


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
    pool.fetchval.return_value = 1
    pool.fetch.return_value = [{
        "asset_id": "a1", "tractor_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "carrier_id": "c1", "carrier_name": "TransCargo", "trips_total": 0, "last_report_at": None,
        "driver_id": None, "driver_name": None, "driver_rut": None, "driver_phone": None,
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    assert res.status_code == 200
    body = res.json()
    assert body["total_active"] == 1
    assert body["items"][0]["tractor_plate"] == "ABCD12"
    query = pool.fetch.call_args_list[0].args[0]
    assert "public.asset_assignments" in query
    assert "sodimac" in query


def test_available_assets_today_trips_uses_shared_resolution_view():
    """Fase B (feedback post-weekly 2026-07-22, ítem 5): mismo fix que
    available-drivers, para el lado del equipo/tracto."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args_list[0].args[0]
    assert "app.v_trip_fleet_resolution" in query
    assert "vfr.resolved_tractor_asset_id" in query


def test_available_assets_response_shape_has_total_active_and_items():
    pool = AsyncMock()
    pool.fetchval.return_value = 5
    pool.fetch.return_value = [{
        "asset_id": "a1", "tractor_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "carrier_id": "c1", "carrier_name": "TransCargo", "trips_total": 0, "last_report_at": None,
        "driver_id": "d1", "driver_name": "Juan Pérez", "driver_rut": "12345678-9", "driver_phone": None,
    }]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    body = res.json()
    assert body["total_active"] == 5
    assert body["items"][0]["carrier_id"] == "c1"
    assert body["items"][0]["driver_id"] == "d1"


def test_available_assets_casts_uuid_for_max_aggregate():
    """Bug real en producción (2026-07-28): Postgres no tiene max(uuid) —
    max(vfr.resolved_driver_id) sin cast tira '42883: function max(uuid)
    does not exist' y available-assets devolvía 500 en el Diario real.
    Confirmado y corregido contra la base real (execute_sql), no solo con
    el mock de este test — el mock no ejecuta SQL de verdad y no lo hubiera
    detectado."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args_list[0].args[0]
    assert "max(vfr.resolved_driver_id::text)::uuid" in query


def test_available_assets_includes_standing_driver_for_idle_equipment():
    """Centro de Flota (2026-07-28): un equipo sin viajes hoy debe traer su
    conductor habitual — antes solo se llenaba si el equipo tuvo un viaje hoy,
    dejando la mitad de la lista sin conductor en la UI."""
    pool = AsyncMock()
    pool.fetchval.return_value = 1
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    query = pool.fetch.call_args_list[0].args[0]
    assert "public.vehicle_driver_assignments" in query
    assert "standing_driver" in query
    assert "c.id AS carrier_id" in query


def test_available_assets_returns_busy_equipment_with_real_trip_data():
    """Centro de Flota, Opción B (2026-07-28): el tile "En viaje hoy" debe
    poder mostrar datos reales (no solo un conteo) — qué viaje está haciendo
    cada equipo ocupado, para poder abrirlo desde ahí. Antes ese tile mostraba
    un número pero nunca ninguna fila (available-assets solo devolvía equipo
    IDLE) — feedback real del usuario tras el primer deploy."""
    pool = AsyncMock()
    pool.fetchval.return_value = 2
    pool.fetch.side_effect = [
        [],  # items (idle) — vacío para simplificar
        [{
            "asset_id": "a1", "tractor_plate": "ABCD12", "carrier_name": "TransCargo",
            "trip_id": "t1", "client_name": "Walmart", "current_status": "ORIGEN",
        }],
    ]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/available-assets?fecha=2026-07-06")
    body = res.json()
    assert body["busy"][0]["trip_id"] == "t1"
    assert body["busy"][0]["client_name"] == "Walmart"
    assert body["busy"][0]["current_status"] == "ORIGEN"
    busy_query = pool.fetch.call_args_list[1].args[0]
    assert "busy_trip" in busy_query
    assert "app.v_trip_fleet_resolution" in busy_query
    assert "NOT (t.trip_status LIKE 'CERRADO%'" in busy_query


# ── Centro de Flota — fix multi-día (2026-08-02, ítem 16 de la minuta:
#    "los números no cuadran"). Antes las 3 queries filtraban
#    planning_date = fecha exacta — un equipo/conductor con viaje abierto
#    desde un día anterior aparecía como "disponible" cuando no lo estaba.
#    Ahora también cuentan los viajes de días anteriores mientras sigan
#    is_active=true. ───────────────────────────────────────────────────────

def test_available_drivers_counts_multi_day_active_trip_from_earlier_date():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-drivers?fecha=2026-08-02")
    query = pool.fetch.call_args.args[0]
    assert "t.planning_date < $1 AND t.is_active" in query


def test_available_assets_today_trips_counts_multi_day_active_trip():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-08-02")
    query = pool.fetch.call_args_list[0].args[0]
    assert "t.planning_date < $1 AND t.is_active" in query


def test_available_assets_busy_trip_counts_multi_day_active_trip():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.side_effect = [[], []]
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/available-assets?fecha=2026-08-02")
    busy_query = pool.fetch.call_args_list[1].args[0]
    assert "t.planning_date < $1 AND t.is_active" in busy_query


# ── /trips/fleet-daily-overview (Fase 2, HU-01 Cierre del Día) ──────────────

def _fleet_row(
    asset_id="a1", tractor_plate="ABCD12", carrier_id="c1", carrier_name="TransCargo",
    is_tractoreo=False, is_equipo_completo=False, trip_id=None, client_name=None, origin_local=None,
):
    return {
        "asset_id": asset_id, "tractor_plate": tractor_plate,
        "carrier_id": carrier_id, "carrier_name": carrier_name,
        "is_tractoreo": is_tractoreo, "is_equipo_completo": is_equipo_completo,
        "trip_id": trip_id, "client_name": client_name, "origin_local": origin_local,
    }


def test_fleet_daily_overview_requires_fecha():
    pool = AsyncMock()
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview")
    assert res.status_code == 422


def test_fleet_daily_overview_query_scopes_to_active_tractocamiones_excluding_sodimac():
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02")
    query = pool.fetch.call_args_list[0].args[0]
    assert "asset_type = 'TRACTOCAMION'" in query
    assert "sodimac" in query
    assert "t.planning_date < $1 AND t.is_active" in query


def test_fleet_daily_overview_categorizes_tractoreo_con_carga():
    pool = AsyncMock()
    pool.fetch.return_value = [_fleet_row(is_tractoreo=True, trip_id="t1", client_name="Walmart")]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02")
    body = res.json()
    assert body["equipment"][0]["categories"] == ["TRACTOREO"]
    assert body["equipment"][0]["con_carga"] is True
    tractoreo = next(c for c in body["categories"] if c["category"] == "TRACTOREO")
    assert tractoreo == {"category": "TRACTOREO", "assigned": 1, "unassigned": 0, "utilization_pct": 100.0}


def test_fleet_daily_overview_sin_clasificar_when_no_fleet_service_type():
    pool = AsyncMock()
    pool.fetch.return_value = [_fleet_row()]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02")
    body = res.json()
    assert body["equipment"][0]["categories"] == ["SIN_CLASIFICAR"]
    sin_clasificar = next(c for c in body["categories"] if c["category"] == "SIN_CLASIFICAR")
    assert sin_clasificar["assigned"] == 0
    assert sin_clasificar["unassigned"] == 1


def test_fleet_daily_overview_dual_category_when_carrier_selects_both():
    pool = AsyncMock()
    pool.fetch.return_value = [_fleet_row(is_tractoreo=True, is_equipo_completo=True)]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02")
    body = res.json()
    assert set(body["equipment"][0]["categories"]) == {"TRACTOREO", "EQUIPO_COMPLETO"}


def test_fleet_daily_overview_utilization_pct_rounds_and_handles_empty_category():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _fleet_row(asset_id="a1", is_equipo_completo=True, trip_id="t1"),
        _fleet_row(asset_id="a2", is_equipo_completo=True),
        _fleet_row(asset_id="a3", is_equipo_completo=True),
    ]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02")
    equipo_completo = next(c for c in res.json()["categories"] if c["category"] == "EQUIPO_COMPLETO")
    assert equipo_completo == {
        "category": "EQUIPO_COMPLETO", "assigned": 1, "unassigned": 2, "utilization_pct": 33.3,
    }
    tractoreo = next(c for c in res.json()["categories"] if c["category"] == "TRACTOREO")
    assert tractoreo["utilization_pct"] == 0.0


def test_fleet_daily_overview_client_filter_keeps_idle_equipment_of_enabled_carrier():
    """Un equipo SIN CARGA de una empresa habilitada para el cliente filtrado
    debe seguir contando — el filtro no depende de que el viaje de hoy
    exista, sino de public.carrier_shippers."""
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [_fleet_row(carrier_id="c1")],
        [{"carrier_id": "c1", "shipper_name": "walmart"}],
    ]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02&client=Walmart")
    assert len(res.json()["equipment"]) == 1
    shipper_query = pool.fetch.call_args_list[1].args[0]
    assert "public.carrier_shippers" in shipper_query


def test_fleet_daily_overview_client_filter_excludes_unrelated_carrier():
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [_fleet_row(carrier_id="c1")],
        [],
    ]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02&client=Walmart")
    assert res.json()["equipment"] == []


def test_fleet_daily_overview_origin_filter_excludes_idle_equipment():
    """Un equipo SIN CARGA no tiene CD de origen de hoy — un filtro por
    origen lo excluye siempre, es una limitación de datos documentada."""
    pool = AsyncMock()
    pool.fetch.return_value = [_fleet_row(trip_id=None)]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02&origin=CD Lo Aguirre")
    assert res.json()["equipment"] == []


def test_fleet_daily_overview_origin_filter_keeps_matching_con_carga_equipment():
    pool = AsyncMock()
    pool.fetch.return_value = [_fleet_row(trip_id="t1", origin_local="CD Lo Aguirre")]
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/fleet-daily-overview?fecha=2026-08-02&origin=CD Lo Aguirre")
    assert len(res.json()["equipment"]) == 1


# ── list_trips q amplía a cliente ─────────────────────────────────────────────

def test_list_trips_q_matches_client_name():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?q=walmart&view=historial")
    assert res.status_code == 200
    queries = [c.args[0] for c in pool.fetch.call_args_list]
    assert any("t.client_name ILIKE" in q for q in queries)


# ── list_trips — sort_by/sort_dir (2026-08-02: ordenamiento server-side real,
#    reemplaza al sort 100% client-side de antes que solo reordenaba la
#    página ya cargada) ─────────────────────────────────────────────────────

def test_list_trips_sort_by_valid_column_builds_order_by():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&sort_by=client_name&sort_dir=asc")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ORDER BY client_name ASC NULLS LAST" in query


def test_list_trips_sort_by_defaults_to_desc_when_sort_dir_invalid():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&sort_by=tractor_plate&sort_dir=sideways")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ORDER BY tractor_plate DESC NULLS LAST" in query


def test_list_trips_ignores_invalid_sort_by_falls_back_to_planning_date():
    """Allow-list real — nunca interpola sort_by directo en el SQL (un
    nombre de columna arbitrario, que no sea uno de los 8 permitidos, cae
    al default en vez de romper la query o filtrarse sin validar)."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&sort_by=some_unknown_column")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ORDER BY planning_date DESC NULLS LAST" in query
    assert "some_unknown_column" not in query


def test_list_trips_sort_by_status_reported_at_is_allowed():
    """Bug 5.6: Operaciones quiere el viaje más recientemente reportado por
    el TMS primero — status_reported_at pasa a ser sorteable y es también el
    tie-break (reemplaza a t.updated_at, que se pisa con ediciones
    manuales)."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&sort_by=status_reported_at&sort_dir=desc")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ORDER BY status_reported_at DESC NULLS LAST, status_reported_at DESC NULLS LAST" in query


def test_list_trips_default_sort_falls_back_to_planning_date_when_no_sort_by_sent():
    """El backend no cambia su default (planning_date) si no viene sort_by —
    el default nuevo (status_reported_at) es decisión del frontend
    (useDiarioFilters.ts), no del backend, para no romper otros consumidores
    del endpoint que dependan del default actual."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    assert "ORDER BY planning_date DESC NULLS LAST, status_reported_at DESC NULLS LAST" in query


# ── list_trips — client como lista (multi-select), cargo_type, origin
#    (2026-08-02, ver AGENTLOG Ronda de filtros del Diario) ──────────────────

def test_list_trips_client_filters_as_list():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client_test = make_client(pool, router=trips_router)
    res = client_test.get("/api/v1/trips/?view=historial&client=Walmart,Sodimac")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    params = pool.fetch.call_args_list[0].args[1:]
    assert "lower(trim(t.client_name)) = ANY(" in query
    assert ["walmart", "sodimac"] in params


def test_list_trips_client_filter_normalizes_case_and_whitespace():
    """Root cause del bug 5.1: t.client_name viene crudo del TMS (casing/
    espacios no garantizados, confirmado contra datos reales — ~100% de los
    viajes tienen client_name en minúsculas) — el filtro debe normalizar
    igual que el JOIN con public.shippers (líneas 660-661), no comparar
    exacto."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client_test = make_client(pool, router=trips_router)
    res = client_test.get("/api/v1/trips/?view=historial&client=%20Walmart%20,SODIMAC")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    params = pool.fetch.call_args_list[0].args[1:]
    assert "lower(trim(t.client_name)) = ANY(" in query
    assert ["walmart", "sodimac"] in params


def test_list_trips_cargo_type_filters_as_list():
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&cargo_type=FRIO,CONGELADO")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    params = pool.fetch.call_args_list[0].args[1:]
    assert "t.cargo_type = ANY(" in query
    assert ["FRIO", "CONGELADO"] in params


def test_list_trips_origin_filters_via_exists_against_trip_stops():
    """origin no es columna de app.trips (se deriva de la parada ORIGIN en
    app.trip_stops, _attach_origin) — el filtro necesita un EXISTS."""
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool, router=trips_router)
    res = client.get("/api/v1/trips/?view=historial&origin=CD+Quilicura")
    assert res.status_code == 200
    query = pool.fetch.call_args_list[0].args[0]
    params = pool.fetch.call_args_list[0].args[1:]
    assert "EXISTS (SELECT 1 FROM app.trip_stops ts" in query
    assert "ts.stop_type = 'ORIGIN'" in query
    assert ["CD Quilicura"] in params


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
    queries = [c.args[0] for c in pool.fetch.call_args_list]
    assert any("app.v_driver_daily_trip_legs" in q for q in queries)
    assert any("leg_number >= 2" in q for q in queries)


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


# ── /config/inventario — qué gobierna cada dominio ──────────────────────────

_FILA_INVENTARIO = {
    "req_total": 37, "req_condicion": 2, "req_inactivos": 2,
    "estados_tms": 25, "estados_op": 5, "estados_eq": 6, "motivos": 16,
    "rangos_temp": 2, "subtipos": 10, "tipos_operacion": 2,
    "usuarios": 10, "roles": 5,
}


def test_inventario_devuelve_pares_por_dominio():
    """La portada dibuja pares (numero, etiqueta) y no sabe nada de dominios en
    particular: si supiera, agregar Facturacion obligaria a tocarla."""
    pool = AsyncMock()
    pool.fetchrow.return_value = _FILA_INVENTARIO
    res = make_client(pool).get("/api/v1/config/inventario")

    assert res.status_code == 200
    cuerpo = res.json()
    assert cuerpo["certificacion"][0] == {"n": 37, "etiqueta": "documentos"}
    assert cuerpo["flota"] == [
        {"n": 10, "etiqueta": "subtipos"},
        {"n": 2, "etiqueta": "tipos de operación"},
    ]


def test_inventario_omite_los_ceros():
    """Una linea que dice '0 rangos' ocupa el lugar de algo que si informa."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {**_FILA_INVENTARIO, "rangos_temp": 0, "req_inactivos": 0}
    cuerpo = make_client(pool).get("/api/v1/config/inventario").json()

    assert all("rango" not in p["etiqueta"] for p in cuerpo["operaciones"])
    assert all("vigencia" not in p["etiqueta"] for p in cuerpo["certificacion"])


def test_inventario_usa_el_singular_cuando_corresponde():
    pool = AsyncMock()
    pool.fetchrow.return_value = {**_FILA_INVENTARIO, "usuarios": 1, "subtipos": 1}
    cuerpo = make_client(pool).get("/api/v1/config/inventario").json()

    assert {"n": 1, "etiqueta": "usuario"} in cuerpo["personas"]
    assert {"n": 1, "etiqueta": "subtipo"} in cuerpo["flota"]


def test_los_dominios_validos_coinciden_con_los_del_frontend():
    """Los dominios de taxonomia estan declarados DOS VECES: aca y en el union
    TaxonomyDomain de frontend/lib/api/config.ts. WEBCARGA_OPERATION_TYPE
    existio meses solo del lado TypeScript, asi que la seccion "Tipos de
    operacion" devolvia 422 al listar y al crear -- media pantalla rotulada que
    no funcionaba, invisible para tsc y para los tests con el cliente mockeado.

    Mientras las dos listas existan, este test es lo unico que las mantiene
    juntas."""
    import re
    from pathlib import Path
    from app.schemas.status_taxonomy import VALID_DOMAINS

    fuente = Path(__file__).resolve().parents[3] / "frontend" / "lib" / "api" / "config.ts"
    texto = fuente.read_text(encoding="utf-8")
    bloque = texto.split("export type TaxonomyDomain =")[1].split("export type")[0]
    del_frontend = set(re.findall(r"'([A-Z_]+)'", bloque))

    assert del_frontend == VALID_DOMAINS, (
        f"solo en el frontend: {del_frontend - VALID_DOMAINS} · "
        f"solo en el backend: {VALID_DOMAINS - del_frontend}"
    )
