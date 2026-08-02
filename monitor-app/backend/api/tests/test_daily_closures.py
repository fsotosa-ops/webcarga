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
        "trip_id": None,
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


# ── POST /cuadratura/close ───────────────────────────────────────────────

def test_close_day_succeeds_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = [_driver_row(driver_id="d1", status="ASSIGNED")]
    client = make_client(pool)

    res = client.post("/api/v1/daily-closures/close?fecha=2026-07-21", json={})

    assert res.status_code == 200
    assert res.json() == {"ok": True, "business_date": "2026-07-21", "overridden": 0}
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
