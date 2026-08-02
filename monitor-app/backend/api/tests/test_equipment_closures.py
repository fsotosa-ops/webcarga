from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_editor
from app.db import get_pool
from app.routers.equipment_closures import router
from tests.conftest import USER, wire_transactional_conn

ADMIN_USER = {"sub": "22222222-2222-2222-2222-222222222222", "email": "admin@webcarga.cl", "role": "admin"}


def make_client(pool, user=None):
    """run_pre_cierre corre antes de cada recompute (mismo criterio que
    daily_closures.py) — stub vacío por defecto salvo que el test ya wiree
    pool.acquire a mano."""
    if isinstance(pool.acquire, AsyncMock):
        conn = AsyncMock()
        conn.fetch.return_value = []
        wire_transactional_conn(pool, conn)
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: (user or USER)
    app.dependency_overrides[require_editor] = lambda: (user or USER)
    return TestClient(app)


def _equipment_row(**overrides):
    base = {
        "asset_id": "a1", "tractor_plate": "ABCD12", "carrier_id": "c1", "carrier_name": "Transportes Sur",
        "status": "UNASSIGNED", "requires_motivo": True, "unassigned_reason_id": None, "unassigned_reason_label": None,
        "resolved_by": None, "resolved_at": None,
        "driver_id": None, "driver_name": None, "last_known_origin": None,
    }
    base.update(overrides)
    return base


def test_get_equipment_closure_status_requires_fecha():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.get("/api/v1/equipment-closures?fecha=no-es-una-fecha")
    assert res.status_code == 422


def test_get_equipment_closure_status_splits_tractoreo_y_equipos_completos():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _equipment_row(asset_id="a1", requires_motivo=True, status="ASSIGNED"),
        _equipment_row(asset_id="a2", requires_motivo=True, status="UNASSIGNED"),
        _equipment_row(asset_id="a3", requires_motivo=False, status="ASSIGNED", carrier_name="Equipo Sur"),
        _equipment_row(asset_id="a4", requires_motivo=False, status="UNASSIGNED", carrier_name="Equipo Sur"),
    ]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/equipment-closures?fecha=2026-08-02")

    assert res.status_code == 200
    body = res.json()
    assert body["tractoreo"]["summary"] == {
        "total": 2, "assigned": 1, "unassigned": 1, "utilization_pct": 50.0,
    }
    assert body["equipos_completos"]["summary"] == {
        "total": 2, "assigned": 1, "unassigned": 1, "utilization_pct": 50.0,
    }
    assert body["equipos_completos"]["by_carrier"] == [
        {"carrier_id": "c1", "carrier_name": "Equipo Sur", "enrolled": 2, "assigned": 1, "unassigned": 1},
    ]


def test_get_equipment_closure_status_pending_count_solo_cuenta_tractoreo_sin_motivo():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _equipment_row(asset_id="a1", requires_motivo=True, status="UNASSIGNED", unassigned_reason_id=None),
        _equipment_row(asset_id="a2", requires_motivo=True, status="UNASSIGNED", unassigned_reason_id="r1"),
        _equipment_row(asset_id="a3", requires_motivo=False, status="UNASSIGNED", unassigned_reason_id=None),
    ]
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/equipment-closures?fecha=2026-08-02")

    assert res.json()["tractoreo"]["pending_count"] == 1


def test_recompute_sql_requires_motivo_trata_sin_clasificar_como_tractoreo():
    from app.routers.equipment_closures import _RECOMPUTE_SQL
    assert "NOT (COALESCE(ct.is_equipo_completo, false) AND NOT COALESCE(ct.is_tractoreo, false))" in _RECOMPUTE_SQL
    assert "asset_type = 'TRACTOCAMION'" in _RECOMPUTE_SQL
    assert "t.planning_date < $1 AND t.is_active" in _RECOMPUTE_SQL
    assert "sodimac" in _RECOMPUTE_SQL


def test_set_batch_reason_actualiza_varios_equipos_en_un_llamado():
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [{"asset_id": "a1", "requires_motivo": True, "status": "UNASSIGNED"},
         {"asset_id": "a2", "requires_motivo": True, "status": "UNASSIGNED"}],
        [_equipment_row(asset_id="a1"), _equipment_row(asset_id="a2")],
    ]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/equipment-closures/reason?fecha=2026-08-02",
        json={"asset_ids": ["a1", "a2"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 200
    assert len(res.json()) == 2
    update_sql = pool.execute.call_args_list[-1].args[0]
    assert "unassigned_reason_id = $1" in update_sql
    assert pool.execute.call_args_list[-1].args[-1] == ["a1", "a2"]


def test_set_batch_reason_404_cuando_falta_un_equipo():
    pool = AsyncMock()
    pool.fetch.return_value = [{"asset_id": "a1", "requires_motivo": True, "status": "UNASSIGNED"}]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/equipment-closures/reason?fecha=2026-08-02",
        json={"asset_ids": ["a1", "a2"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 404


def test_set_batch_reason_422_cuando_ya_tiene_carga():
    pool = AsyncMock()
    pool.fetch.return_value = [{"asset_id": "a1", "requires_motivo": True, "status": "ASSIGNED"}]
    client = make_client(pool)

    res = client.patch(
        "/api/v1/equipment-closures/reason?fecha=2026-08-02",
        json={"asset_ids": ["a1"], "unassigned_reason_id": "r1"},
    )

    assert res.status_code == 422


def test_close_equipment_day_succeeds_when_nothing_pending():
    pool = AsyncMock()
    pool.fetch.return_value = [_equipment_row(asset_id="a1", status="ASSIGNED")]
    client = make_client(pool)

    res = client.post("/api/v1/equipment-closures/close?fecha=2026-08-02", json={})

    assert res.status_code == 200
    assert res.json() == {"ok": True, "business_date": "2026-08-02", "overridden": 0}


def test_close_equipment_day_409_when_tractoreo_pending():
    pool = AsyncMock()
    pool.fetch.return_value = [
        _equipment_row(asset_id="a1", requires_motivo=True, status="UNASSIGNED"),
    ]
    client = make_client(pool)

    res = client.post("/api/v1/equipment-closures/close?fecha=2026-08-02", json={})

    assert res.status_code == 409
    assert res.json()["detail"]["pending"][0]["asset_id"] == "a1"


def test_close_equipment_day_no_bloquea_por_equipos_completos_sin_motivo():
    """HU-03 criterio: Equipos Completos SIN CARGA nunca bloquea el cierre
    (cierre pasivo) — ni siquiera tienen unassigned_reason_id."""
    pool = AsyncMock()
    pool.fetch.return_value = [
        _equipment_row(asset_id="a1", requires_motivo=False, status="UNASSIGNED", unassigned_reason_id=None),
    ]
    client = make_client(pool)

    res = client.post("/api/v1/equipment-closures/close?fecha=2026-08-02", json={})

    assert res.status_code == 200


def test_close_equipment_day_override_requires_admin_role():
    pool = AsyncMock()
    pool.fetch.return_value = [_equipment_row(asset_id="a1", requires_motivo=True, status="UNASSIGNED")]
    client = make_client(pool)  # USER es editor, no admin

    res = client.post(
        "/api/v1/equipment-closures/close?fecha=2026-08-02",
        json={"override": True, "override_note": "Autorizo cerrar igual"},
    )

    assert res.status_code == 403


def test_close_equipment_day_override_as_admin_logs_and_closes():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [_equipment_row(asset_id="a1", requires_motivo=True, status="UNASSIGNED")]
    client = make_client(pool, user=ADMIN_USER)

    res = client.post(
        "/api/v1/equipment-closures/close?fecha=2026-08-02",
        json={"override": True, "override_note": "Autorizo cerrar igual"},
    )

    assert res.status_code == 200
    assert res.json()["overridden"] == 1
    audit_calls = [c.args[0] for c in conn.execute.call_args_list]
    assert any("audit_log" in s for s in audit_calls)
