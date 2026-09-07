from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.daily_closures import router
from tests.conftest import USER, wire_transactional_conn

ADMIN_USER = {"sub": "22222222-2222-2222-2222-222222222222", "email": "admin@webcarga.cl", "role": "admin"}


def make_client(pool, user=None):
    """HU-02 (Fase 3): _recompute ahora corre run_pre_cierre primero, que
    usa pool.acquire()/conn.transaction() — se wirea acá un stub vacío por
    defecto (ningún viaje, ninguna inconsistencia) para que los tests de
    este archivo (que no ejercitan pre-cierre, ver test_pre_cierre.py) no
    tengan que repetir el wiring uno por uno."""
    if isinstance(pool.acquire, AsyncMock):
        # Todavía no wireado a mano (ver test_close_day_override_as_admin_logs_and_closes,
        # que sí lo hace explícito para inspeccionar conn.execute) — stub vacío.
        conn = AsyncMock()
        conn.fetch.return_value = []
        wire_transactional_conn(pool, conn)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: (user or USER)
    app.dependency_overrides[require_editor] = lambda: (user or USER)
    return TestClient(app)


def _driver_row(**overrides):
    base = {
        "driver_id": "d1", "full_name": "Juan Pérez", "tax_id": "11111111-1",
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa", "status": "ASSIGNED",
        "unassigned_reason_id": None, "unassigned_reason_label": None,
        "resolved_by": None, "resolved_at": None, "client_names": [],
        "driver_pending_docs_critical": None, "suggested_reason_id": None,
        "trip_id": None, "today_trip_id": None,
        "last_known_tractor_plate": None, "last_known_operation_type": None,
    }
    base.update(overrides)
    return base


# ── Bug real corregido 2026-07-22 (Ronda 38): day_trips debe replicar la
# MISMA cadena de resolución en vivo que usa available_drivers/_TRIP_FROM en
# trips.py, no solo trip_fleet_links.driver_id (vacío para todo viaje desde
# el 2026-07-19 — nada lo puebla para viajes que llegan del TMS).
#
# Consolidado en Fase B (feedback post-weekly 2026-07-22, ítem 5): la cadena
# ahora vive en app.v_trip_fleet_resolution (migración 20260722030000), no
# inline acá — la duplicación en 4 lugares fue justo la causa del bug de
# arriba. Este test verifica que day_trips usa la vista compartida en vez de
# reconstruir su propia copia. ──────────

def test_recompute_sql_uses_shared_fleet_resolution_view():
    from app.routers.daily_closures import _RECOMPUTE_SQL
    assert "app.v_trip_fleet_resolution" in _RECOMPUTE_SQL
    assert "vfr.resolved_driver_id" in _RECOMPUTE_SQL
    assert "vfr.resolved_carrier_id" in _RECOMPUTE_SQL
    # No debe reconstruir la cadena inline — si aparece un JOIN real a
    # vehicle_driver_assignments (no solo la mención en un comentario
    # explicativo), alguien la duplicó de nuevo en vez de usar la vista.
    assert "JOIN public.vehicle_driver_assignments" not in _RECOMPUTE_SQL


# ── Bug real reportado por el usuario en vivo 2026-08-02: "veo 30 viajes en
# curso pero solo 14 asignados en la cuadratura, ¿tiene sentido?" — no lo
# tenía. day_trips solo miraba planning_date = fecha exacta (mismo bug
# "ítem 16 de la minuta" ya corregido en Fase 0.1 para Centro de Flota,
# nunca replicado acá). Confirmado con datos reales: de 29 viajes
# is_active=true, 26 eran multi-día, y sus 14 conductores resueltos eran
# 100% invisibles para day_trips — aparecían "No asignado" con un viaje
# activo real en curso. ──────────

def test_recompute_sql_counts_multi_day_active_trip():
    from app.routers.daily_closures import _RECOMPUTE_SQL
    assert "t.planning_date < $1 AND t.is_active" in _RECOMPUTE_SQL


def test_detail_sql_mismatch_trip_counts_multi_day_active_trip():
    from app.routers.daily_closures import _DETAIL_SQL
    assert "t.planning_date < dds.business_date AND t.is_active" in _DETAIL_SQL


# ── Tarea 4 (minuta 2026-08-03): roster acotado a conductores de empresas
# Tractoreo — Equipo Completo queda fuera de este cierre activo (pasivo por
# tracto en equipment_closures.py). Las 3 queries deben compartir la MISMA
# constante TRACTOREO_ROSTER_CTE, no una copia divergente. ──────────

def test_tractoreo_roster_cte_filters_by_operation_type_code():
    from app.routers.daily_closures import TRACTOREO_ROSTER_CTE
    assert "app.status_taxonomies" in TRACTOREO_ROSTER_CTE
    assert "wot.code = 'TRACTOREO'" in TRACTOREO_ROSTER_CTE
    assert "a.asset_type = 'TRACTOCAMION'" in TRACTOREO_ROSTER_CTE


def test_recompute_sql_uses_shared_tractoreo_roster_cte():
    from app.routers.daily_closures import _RECOMPUTE_SQL, TRACTOREO_ROSTER_CTE
    assert TRACTOREO_ROSTER_CTE in _RECOMPUTE_SQL
    assert "app.status_taxonomies" in _RECOMPUTE_SQL
    assert "wot.code = 'TRACTOREO'" in _RECOMPUTE_SQL


def test_detail_sql_uses_shared_tractoreo_roster_cte():
    from app.routers.daily_closures import _DETAIL_SQL, TRACTOREO_ROSTER_CTE
    assert TRACTOREO_ROSTER_CTE in _DETAIL_SQL
    assert "wot.code = 'TRACTOREO'" in _DETAIL_SQL
    assert "JOIN active_roster ar ON ar.driver_id = dds.driver_id" in _DETAIL_SQL


def test_report_sql_uses_shared_tractoreo_roster_cte():
    from app.routers.daily_closures import _REPORT_SQL, TRACTOREO_ROSTER_CTE
    assert TRACTOREO_ROSTER_CTE in _REPORT_SQL
    assert "wot.code = 'TRACTOREO'" in _REPORT_SQL
    assert "JOIN active_roster ar ON ar.driver_id = dds.driver_id" in _REPORT_SQL


def test_detail_sql_keeps_driver_assignments_and_carriers_as_left_join():
    """El JOIN nuevo a active_roster ya restringe el roster — da/c deben
    seguir siendo LEFT JOIN para no perder un conductor cuyo día ya quedó
    calculado y después perdió su asignación activa antes del próximo
    recompute (caso borde documentado en el brief de la Tarea 4)."""
    from app.routers.daily_closures import _DETAIL_SQL
    assert "LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'" in _DETAIL_SQL
    assert "LEFT JOIN public.carriers c ON c.id = da.carrier_id" in _DETAIL_SQL


# ── GET /cuadratura ──────────────────────────────────────────────────────

def test_get_daily_closure_status_returns_counts_and_drivers():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _driver_row(driver_id="d1", status="ASSIGNED"),
        _driver_row(driver_id="d2", status="UNASSIGNED", full_name="Ana Soto"),
        _driver_row(driver_id="d3", status="MISMATCH", full_name="Luis Rojas"),
    ]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.status_code == 200
    body = res.json()
    assert body["business_date"] == "2026-07-21"
    assert body["closed"] is False
    assert body["total_drivers"] == 3
    assert body["assigned_count"] == 1
    assert body["unassigned_count"] == 1
    assert body["mismatch_count"] == 1
    assert body["pending_count"] == 2  # 1 unassigned sin motivo + 1 mismatch
    recompute_sql = pool.execute.call_args_list[0].args[0]
    assert "app.driver_day_status" in recompute_sql
    assert "ON CONFLICT (driver_id, business_date)" in recompute_sql


def test_get_daily_closure_status_includes_carrier_id_for_linking_to_empresas():
    """Ítem 4 (feedback post-weekly 2026-07-22): 'Revisar en Empresas' en el
    modal Cerrar el día necesita un carrier_id real para armar el link — sin
    esto era texto estático sin ninguna acción posible."""
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d3", status="MISMATCH", carrier_id="c7")]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["drivers"][0]["carrier_id"] == "c7"
    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "c.id AS carrier_id" in detail_sql


def test_get_daily_closure_status_includes_trip_id_for_mismatch():
    """Centro de Flota (2026-07-28) / ítem 4 del refinamiento v2: la fila
    MISMATCH en Cerrar el día debe poder abrir el viaje real que causó el
    descuadre, no solo linkear genéricamente a la ficha de empresa."""
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d3", status="MISMATCH", trip_id="t-99")]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["drivers"][0]["trip_id"] == "t-99"
    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "mismatch_trip.trip_id" in detail_sql
    assert "app.v_trip_fleet_resolution" in detail_sql


def test_detail_sql_trae_el_viaje_de_hoy_aparte_del_de_mismatch():
    """`trip_id` responde "cual es el viaje que contradice a su empresa", asi
    que en un ASSIGNED sano es NULL por diseno — y la fila quedaba sin "Ver
    viaje". Medido contra la base del 2026-09-03: de 25 conductores asignados
    solo 1 tenia link; con `today_trip_id` lo tienen los 25.

    Van en dos columnas porque son dos preguntas: un NULL con dos significados
    es la clase de bug que este proyecto ya vio cinco veces."""
    from app.routers.daily_closures import _DETAIL_SQL
    assert "today_trip.trip_id AS today_trip_id" in _DETAIL_SQL
    # El de hoy NO filtra por mismatch: ese predicado es lo que vaciaba el link.
    i = _DETAIL_SQL.index(") today_trip ON true")
    bloque = _DETAIL_SQL[_DETAIL_SQL.index("LEFT JOIN LATERAL", _DETAIL_SQL.index("last_tractor ON true")):i]
    assert "resolved_carrier_id IS DISTINCT FROM" not in bloque


# ── Tarea 5 (plan 2.2, minuta 2026-08-03): "tracto habitual" y tipo de
# operación por conductor — mejor esfuerzo, dato de contexto para el
# coordinador, resuelto desde el lado del conductor vía
# app.v_trip_fleet_resolution (mismo patrón que last_origin en
# equipment_closures.py, pero desde el LATERAL de tracto). ──────────

def test_detail_sql_resolves_last_known_tractor_for_driver():
    from app.routers.daily_closures import _DETAIL_SQL
    assert "vfr2.resolved_driver_id = dds.driver_id" in _DETAIL_SQL
    assert "app.v_trip_fleet_resolution" in _DETAIL_SQL
    assert "last_known_tractor_plate" in _DETAIL_SQL
    assert "last_known_operation_type" in _DETAIL_SQL


def test_get_daily_closure_status_includes_last_known_tractor():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(
        driver_id="d1",
        last_known_tractor_plate="ABCD12",
        last_known_operation_type="Tractoreo",
    )]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.status_code == 200
    driver = res.json()["drivers"][0]
    assert driver["last_known_tractor_plate"] == "ABCD12"
    assert driver["last_known_operation_type"] == "Tractoreo"


def test_get_daily_closure_status_last_known_tractor_null_when_no_history():
    """Mejor esfuerzo: un conductor sin ningún viaje histórico resuelto no
    debe romper el endpoint — los campos vienen null."""
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(
        driver_id="d1",
        last_known_tractor_plate=None,
        last_known_operation_type=None,
    )]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.status_code == 200
    driver = res.json()["drivers"][0]
    assert driver["last_known_tractor_plate"] is None
    assert driver["last_known_operation_type"] is None


def test_get_daily_closure_status_pending_excludes_unassigned_with_reason():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _driver_row(driver_id="d2", status="UNASSIGNED", unassigned_reason_id="pana", unassigned_reason_label="Pana"),
    ]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["pending_count"] == 0


def test_get_daily_closure_status_reports_closed_day():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row()]
    pool.fetchrow.return_value = {
        "closed_by": "u1", "closed_at": datetime(2026, 7, 21, 20, 0, tzinfo=timezone.utc),
        "total_drivers": 1, "resolved_count": 1, "override_count": 0,
    }
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["closed"] is True
    assert res.json()["closure"]["total_drivers"] == 1


def test_get_daily_closure_status_invalid_fecha_422():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=no-es-una-fecha")

    assert res.status_code == 422


def test_get_daily_closure_status_includes_client_names():
    """Fase 1.5 (2026-07-21): cliente(s) servidos ese día — denominador
    común de los 3 reportes manuales (Sider/Lansa, Sodimac, Walmart)."""
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d1", client_names=["Walmart"])]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-21")

    assert res.json()["drivers"][0]["client_names"] == ["Walmart"]
    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "client_names" in detail_sql
    assert "public.shippers" in detail_sql


# ── Tarea 5 (status_taxonomies, Ronda 44): label de motivo desde
# status_taxonomies + sugerencia cuando hay documentación crítica vencida ──

def test_get_daily_closure_status_includes_pending_docs_and_suggestion():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(
        driver_id="d1", status="UNASSIGNED",
        driver_pending_docs_critical=True, suggested_reason_id="r-doc-vencida",
    )]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures?fecha=2026-07-22")

    assert res.status_code == 200
    driver = res.json()["drivers"][0]
    assert driver["driver_pending_docs_critical"] is True
    assert driver["suggested_reason_id"] == "r-doc-vencida"


def test_get_daily_closure_status_detail_sql_uses_status_taxonomies_and_compliance_join():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row()]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    client.get("/api/v1/daily-closures?fecha=2026-07-22")

    detail_sql = pool.fetch.call_args_list[0].args[0]
    assert "app.status_taxonomies" in detail_sql
    assert "app.unassigned_reasons" not in detail_sql
    assert "public.compliance_records" in detail_sql


# ── GET /daily-closures/report (Reportería) ─────────────────────────────
# Spec 2026-07-21-cuadratura-reporteria-redesign-design.md

def test_get_daily_closures_report_returns_flat_rows_with_business_date():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {**_driver_row(driver_id="d1"), "business_date": "2026-07-20"},
        {**_driver_row(driver_id="d2", status="UNASSIGNED"), "business_date": "2026-07-21"},
    ]
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures/report?fecha_desde=2026-07-20&fecha_hasta=2026-07-21")

    assert res.status_code == 200
    body = res.json()
    assert body["fecha_desde"] == "2026-07-20"
    assert body["fecha_hasta"] == "2026-07-21"
    assert len(body["rows"]) == 2
    assert body["rows"][0]["business_date"] == "2026-07-20"
    report_sql = pool.fetch.call_args_list[0].args[0]
    assert "BETWEEN $1 AND $2" in report_sql


def test_get_daily_closures_report_does_not_recompute():
    """A diferencia de GET /daily-closures (un solo día), el reporte es
    puramente de lectura — no debe llamar a pool.execute (_RECOMPUTE_SQL)."""
    pool = AsyncMock()
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/daily-closures/report?fecha_desde=2026-07-20&fecha_hasta=2026-07-21")

    pool.execute.assert_not_called()


def test_get_daily_closures_report_422_when_range_inverted():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures/report?fecha_desde=2026-07-21&fecha_hasta=2026-07-20")

    assert res.status_code == 422


def test_get_daily_closures_report_422_invalid_dates():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.get("/api/v1/daily-closures/report?fecha_desde=no-es-fecha&fecha_hasta=2026-07-21")

    assert res.status_code == 422


# ── PATCH /cuadratura/{driver_id} ────────────────────────────────────────

def test_patch_driver_day_status_sets_reason():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "UNASSIGNED"}
    pool.fetch.return_value = [
        _driver_row(driver_id="d1", status="UNASSIGNED", unassigned_reason_id="pana", unassigned_reason_label="Pana"),
    ]
    client = make_client(pool)

    res = client.patch("/api/v1/daily-closures/d1?fecha=2026-07-21", json={"unassigned_reason_id": "pana"})

    assert res.status_code == 200
    update_sql = pool.execute.call_args_list[1].args[0]
    assert "unassigned_reason_id = $1" in update_sql


def test_patch_driver_day_status_404_when_not_found():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.patch("/api/v1/daily-closures/d1?fecha=2026-07-21", json={"unassigned_reason_id": "pana"})

    assert res.status_code == 404


def test_patch_driver_day_status_422_when_not_unassigned():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "ASSIGNED"}
    client = make_client(pool)

    res = client.patch("/api/v1/daily-closures/d1?fecha=2026-07-21", json={"unassigned_reason_id": "pana"})

    assert res.status_code == 422


# ── PATCH /cuadratura/reason (Tarea 7, plan 2.4) ────────────────────────

def test_set_batch_reason_actualiza_varios_conductores_en_un_llamado():
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [{"driver_id": "d1", "status": "UNASSIGNED"}, {"driver_id": "d2", "status": "UNASSIGNED"}],
        [_driver_row(driver_id="d1"), _driver_row(driver_id="d2")],
    ]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/daily-closures/reason?fecha=2026-08-02",
        json={"driver_ids": ["d1", "d2"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 200
    assert len(res.json()) == 2
    update_sql = pool.execute.call_args_list[-1].args[0]
    assert "unassigned_reason_id = $1" in update_sql
    # Por posicion y no por `args[-1]`: el ultimo argumento dejo de ser la
    # lista de ids cuando se sumo el comentario, y un test que apunta "al
    # ultimo" se rompe cada vez que el UPDATE crece.
    assert pool.execute.call_args_list[-1].args[4] == ["d1", "d2"]


def test_set_batch_reason_404_cuando_falta_un_conductor():
    pool = AsyncMock()
    pool.fetch.return_value = [{"driver_id": "d1", "status": "UNASSIGNED"}]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/daily-closures/reason?fecha=2026-08-02",
        json={"driver_ids": ["d1", "d2"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 404


def test_set_batch_reason_422_cuando_ya_esta_asignado():
    pool = AsyncMock()
    pool.fetch.return_value = [{"driver_id": "d1", "status": "ASSIGNED"}]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/daily-closures/reason?fecha=2026-08-02",
        json={"driver_ids": ["d1"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 422


def test_set_batch_reason_422_cuando_driver_ids_vacio():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.patch(
        "/api/v1/daily-closures/reason?fecha=2026-08-02",
        json={"driver_ids": [], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 422


# ── POST /cuadratura/close ───────────────────────────────────────────────

def test_close_day_succeeds_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d1", status="ASSIGNED")]
    client = make_client(pool)

    res = client.post("/api/v1/daily-closures/close?fecha=2026-07-21", json={})

    assert res.status_code == 200
    assert res.json() == {
        "ok": True, "business_date": "2026-07-21",
        # `overridden` cuenta TODO lo forzado; `overridden_sin_flota` separa la
        # mitad que es de viaje y no de conductor. Un cierre firmado sobre 2
        # patentes fuera del directorio con overridden=0 diria que no se forzo
        # nada.
        "overridden": 0, "overridden_sin_flota": 0,
    }
    insert_sql = pool.execute.call_args_list[-1].args[0]
    assert "app.daily_closures" in insert_sql


def test_close_day_409_when_pending_without_override():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _driver_row(driver_id="d2", status="UNASSIGNED", full_name="Ana Soto"),
    ]
    client = make_client(pool)

    res = client.post("/api/v1/daily-closures/close?fecha=2026-07-21", json={})

    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["pending"][0]["full_name"] == "Ana Soto"


def test_close_day_409_cuando_la_flota_no_esta_en_el_directorio(monkeypatch):
    """El bloqueo nuevo. Es de VIAJE y no de conductor: un dia sin ningun
    conductor pendiente igual no se puede firmar si hay una patente que no
    existe en el directorio, porque ese viaje no tiene empresa a la que
    atribuirse.

    Antes del cambio, el pre-cierre detectaba esto y el dia se firmaba igual.
    """
    from app.routers import daily_closures as dc

    async def _recompute_falso(pool, business_date):
        return {"escalations": {"PATENTE_NO_REGISTRADA": [
            {"tractor_plate": "ABCD12", "reason": "La patente no existe en public.assets"}]}}

    monkeypatch.setattr(dc, "_recompute", _recompute_falso)
    pool = AsyncMock()
    # Ningun conductor pendiente: lo unico que bloquea es la flota.
    pool.fetch.return_value = [_driver_row(driver_id="d1", status="ASSIGNED")]
    client = make_client(pool)

    res = client.post("/api/v1/daily-closures/close?fecha=2026-07-21", json={})

    assert res.status_code == 409
    detail = res.json()["detail"]
    assert detail["pending"] == [], "no habia conductores pendientes"
    assert detail["sin_flota"][0]["tractor_plate"] == "ABCD12"
    assert detail["sin_flota"][0]["tipo"] == "PATENTE_NO_REGISTRADA"
    assert "flota fuera del directorio" in detail["message"]


def test_close_day_deja_firmar_con_override_y_lo_cuenta(monkeypatch):
    """La valvula que ya existia sigue siendo la valvula: admin + comentario.
    Es la que el propio refinamiento diseno contra el "deadlock operativo"."""
    from app.routers import daily_closures as dc

    async def _recompute_falso(pool, business_date):
        return {"escalations": {"PATENTE_NO_REGISTRADA": [{"tractor_plate": "ABCD12"}]}}

    monkeypatch.setattr(dc, "_recompute", _recompute_falso)
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d1", status="ASSIGNED")]
    client = make_client(pool, user=ADMIN_USER)

    res = client.post(
        "/api/v1/daily-closures/close?fecha=2026-07-21",
        json={"override": True, "override_note": "la patente se da de alta manana"},
    )

    assert res.status_code == 200
    assert res.json()["overridden_sin_flota"] == 1
    assert res.json()["overridden"] == 1


def test_close_day_override_requires_admin_role():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d2", status="UNASSIGNED")]
    client = make_client(pool)  # USER es editor, no admin

    res = client.post(
        "/api/v1/daily-closures/close?fecha=2026-07-21",
        json={"override": True, "override_note": "Ok, autorizo cierre"},
    )

    assert res.status_code == 403


def test_close_day_override_requires_note():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d2", status="UNASSIGNED")]
    client = make_client(pool, user=ADMIN_USER)

    res = client.post("/api/v1/daily-closures/close?fecha=2026-07-21", json={"override": True})

    assert res.status_code == 422


def test_close_day_override_as_admin_logs_and_closes():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [
        _driver_row(driver_id="d2", status="UNASSIGNED", full_name="Ana Soto"),
        _driver_row(driver_id="d3", status="MISMATCH", full_name="Luis Rojas"),
    ]
    client = make_client(pool, user=ADMIN_USER)

    res = client.post(
        "/api/v1/daily-closures/close?fecha=2026-07-21",
        json={"override": True, "override_note": "Datos sucios de medianoche, autorizo cerrar igual"},
    )

    assert res.status_code == 200
    body = res.json()
    assert body["overridden"] == 2
    audit_calls = [c.args[0] for c in conn.execute.call_args_list]
    assert sum("audit_log" in s for s in audit_calls) == 2
    insert_sql = pool.execute.call_args_list[-1].args[0]
    assert "app.daily_closures" in insert_sql


# ── FIX 2026-08-18: las 3 pantallas del Cierre no miraban el mismo universo.
# daily_closures no excluía Sodimac mientras equipment_closures.py:69 y
# status_report.py:107 sí lo hacen ("esa fuente no resuelve tracto por la
# misma cadena"), así que el mismo día daba conteos distintos según dónde se
# lo mirara. Medido sobre el 2026-08-14 antes de aplicarlo: el universo baja
# de 63 a 49 viajes y ningún conductor cambia de estado (27 antes y
# después). ──────────

def test_recompute_sql_excluye_sodimac():
    from app.routers.daily_closures import _RECOMPUTE_SQL
    assert "t.source_system != 'sodimac'" in _RECOMPUTE_SQL


def test_detail_sql_excluye_sodimac_en_el_lateral_de_mismatch():
    from app.routers.daily_closures import _DETAIL_SQL
    assert "t.source_system != 'sodimac'" in _DETAIL_SQL


# ── FIX 2026-08-18: el roster filtraba la empresa y el activo por
# operational_status, pero no al CONDUCTOR, mientras fleet_driver_gap.py sí
# lo hace — el mismo conductor de baja contaba distinto en dos secciones del
# mismo reporte. ──────────

def test_tractoreo_roster_cte_excluye_conductores_de_baja():
    from app.routers.daily_closures import TRACTOREO_ROSTER_CTE
    assert "d.operational_status = 'ACTIVE'" in TRACTOREO_ROSTER_CTE
    # los otros dos filtros ya estaban y no deben perderse
    assert "c.operational_status = 'ACTIVE'" in TRACTOREO_ROSTER_CTE
    assert "a.operational_status = 'ACTIVE'" in TRACTOREO_ROSTER_CTE

# ── Permiso, comentario y las dos columnas nuevas (2026-09-07) ─────────────


def test_cerrar_el_dia_lo_puede_hacer_un_writer():
    """Definicion del usuario (07/09): *"ambos pueden hacer cierres de viaje"*.
    `writer` es el rol de quien opera el Diario todos los dias y era justamente
    el que no podia terminar su propio trabajo."""
    from app.auth import WRITER_ROLES
    assert "writer" in WRITER_ROLES
    from app.routers import daily_closures
    fuente = open(daily_closures.__file__, encoding="utf-8").read()
    # Sobre el uso real, no sobre la palabra: "require_editor" tambien aparece
    # en el comentario que explica por que ya no se usa.
    assert "Depends(require_editor)" not in fuente
    assert "Depends(require_writer)" in fuente
    # El override NO se abrio: forzar con pendientes sigue siendo de admin.
    assert "ADMIN_ROLES" in fuente


def test_el_comentario_se_guarda_y_el_recompute_lo_conserva_solo_si_sigue_sin_asignar():
    from app.routers.daily_closures import _RECOMPUTE_SQL
    assert "comentario = CASE WHEN EXCLUDED.status = 'UNASSIGNED'" in _RECOMPUTE_SQL
    # Sigue al motivo: explica por que alguien no trabajo, asi que no puede
    # sobrevivir al dia en que si trabajo.
    assert "ELSE NULL END" in _RECOMPUTE_SQL


def test_patch_guarda_el_comentario_junto_al_motivo():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "UNASSIGNED"}
    pool.fetch.return_value = [_driver_row(driver_id="d1")]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/daily-closures/d1?fecha=2026-09-03",
        json={"unassigned_reason_id": "r1", "comentario": "llegó tarde el repuesto"},
    )

    assert res.status_code == 200
    # args[0] es el SQL; los parametros van (motivo, actor, driver_id, fecha,
    # comentario), asi que el comentario es el quinto parametro.
    assert pool.execute.call_args_list[-1].args[5] == "llegó tarde el repuesto"
    assert pool.execute.call_args_list[-1].args[6] is True  # la clave vino en el payload


def test_cambiar_solo_el_motivo_no_borra_el_comentario():
    """"No mandé el campo" no es lo mismo que pedir que quede en null. Sin esto, elegir otro motivo
    —que no manda comentario— borraba en silencio el texto que alguien había
    escrito."""
    pool = AsyncMock()
    pool.fetchrow.return_value = {"status": "UNASSIGNED"}
    pool.fetch.return_value = [_driver_row(driver_id="d1")]
    client = make_client(pool)

    res = client.patch("/api/v1/daily-closures/d1?fecha=2026-09-03", json={"unassigned_reason_id": "r2"})

    assert res.status_code == 200
    assert pool.execute.call_args_list[-1].args[6] is False
    update_sql = pool.execute.call_args_list[-1].args[0]
    assert "CASE WHEN $6 THEN $5 ELSE app.driver_day_status.comentario END" in update_sql


def test_detail_sql_trae_numero_de_viaje_y_local_de_origen():
    """Pablo, 04/09: *"para no estar adivinando por que esta la patente nomas,
    no esta el numero de viaje, nada"*.

    El origen sale de app.trip_stops y NO de trips.origin_tms: esa columna esta
    vacia en las 2.204 filas (medido contra la base el 2026-09-07)."""
    from app.routers.daily_closures import _DETAIL_SQL
    assert "today_trip_code" in _DETAIL_SQL
    assert "today_trip_origin" in _DETAIL_SQL
    # El origen sale del JOIN a trip_stops, no de la columna vacia. Se afirma
    # sobre el SELECT y no sobre la ausencia de la palabra: "origin_tms" vive
    # tambien en el comentario que explica por que no se usa.
    assert "ts3.local AS origen" in _DETAIL_SQL
    assert "ts3.stop_type = 'ORIGIN'" in _DETAIL_SQL
