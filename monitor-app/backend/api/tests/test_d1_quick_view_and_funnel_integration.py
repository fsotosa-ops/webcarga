"""D1 "Una sola respuesta", Task 6: la vista rápida y el embudo leen la misma
respuesta que Pendientes (spec §6.1). La vista rápida contaba la flota dada de
baja (F-03) y el embudo sumaba 80 documentos de conductores y equipos de baja
(2.306 frente a 2.226, F-02). Contra Postgres de verdad, en una transacción
revertida."""
from __future__ import annotations

from datetime import timedelta
from uuid import UUID

import pytest

from app.routers.carriers import get_carrier_summary
from app.routers.compliance import _PENDING_ROWS_SQL, SUMMARY_LIMIT, get_certification_status
from app.routers.drivers import get_driver_summary
from tests import d1_subjects as s
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def _flota_con_un_pendiente(conn) -> dict:
    """Empresa activa con un conductor y un equipo activos y otro de cada uno
    dado de baja. Cada conductor debe un documento obligatorio; solo cuenta el
    del activo."""
    c = await s.carrier(conn)
    f = {
        "carrier": c,
        "driver": await s.driver(conn, c),
        "inactive_driver": await s.driver(conn, c, status="INACTIVE"),
        "asset": await s.asset(conn, c),
        "inactive_asset": await s.asset(conn, c, status="INACTIVE"),
    }
    await s.without_seeding(conn, *f.values())
    req = await s.requirement(conn, entity="DRIVER")
    await s.record(conn, req, "DRIVER", f["driver"])
    await s.record(conn, req, "DRIVER", f["inactive_driver"])
    return f


async def _embudo(conn, carrier_id: str) -> dict:
    res = await get_certification_status(group="carrier", scope="active", carrier_id=carrier_id, q="",
                                         limit=200, pool=PoolDeUnaConexion(conn), _=None)
    [fila] = res["rows"]
    return fila


async def test_la_vista_rapida_cuenta_solo_la_flota_activa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    resumen = await get_carrier_summary(UUID(f["carrier"]), pool=PoolDeUnaConexion(conn), _=None)

    assert (resumen["active_drivers"], resumen["active_assets"]) == (1, 1)
    assert resumen["compliance_summary"]["fleet"] == {"overdue": 0, "expiring": 0, "missing": 1}
    assert resumen["compliance_summary"]["can_operate"] is False
    assert "documents" in resumen   # lo viejo sigue al lado


async def test_la_vista_rapida_del_conductor_trae_su_resumen_y_su_empresa(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    resumen = await get_driver_summary(UUID(f["driver"]), pool=PoolDeUnaConexion(conn), _=None)

    assert resumen["carrier"]["id"] == f["carrier"]
    assert resumen["compliance_summary"] == {
        "worst_state": "MISSING", "own": {"overdue": 0, "expiring": 0, "missing": 1},
        "fleet": None, "can_operate": False,
    }


async def test_el_embudo_no_cuenta_la_flota_de_baja(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    f = await _flota_con_un_pendiente(conn)

    fila = await _embudo(conn, f["carrier"])

    assert fila["pending_count"] == 1, "contó el documento del conductor dado de baja"
    assert fila["compliance_summary"]["fleet"]["missing"] == 1
    assert fila["funnel_bucket"] == "not_enabled"
    assert "funnel_group" in fila   # D1-R2: sigue al lado hasta la Task 16


async def test_los_baldes_del_embudo_salen_del_resumen(conexion_revertida):
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    con_por_vencer = await s.carrier(conn)
    al_dia = await s.carrier(conn)
    recien_creada = await s.carrier(conn, status="ONBOARDING")
    await s.without_seeding(conn, con_por_vencer, al_dia, recien_creada)
    req = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, req, "CARRIER", con_por_vencer, status="APPROVED_MANUAL",
                   expires=hoy + timedelta(days=10))

    assert (await _embudo(conn, con_por_vencer))["funnel_bucket"] == "expiring"
    assert (await _embudo(conn, al_dia))["funnel_bucket"] == "up_to_date"
    # R-B4: una empresa no activa no está "No habilitada" en las colas.
    assert (await _embudo(conn, recien_creada))["funnel_bucket"] is None


async def test_el_tipo_de_operacion_de_pendientes_sale_de_la_funcion(conexion_revertida):
    """spec §4.3: lo observado en los tractos manda y lo declarado cubre el
    hueco. La CTE propia de Pendientes solo miraba los vehículos."""
    conn = conexion_revertida
    await s.apply_fleet_facts(conn)
    c = await s.carrier(conn, management_types=["EQUIPO_COMPLETO"])
    await s.without_seeding(conn, c)
    req = await s.requirement(conn, entity="CARRIER")
    await s.record(conn, req, "CARRIER", c)

    filas = await conn.fetch(
        _PENDING_ROWS_SQL,
        c, None, None, None, None, SUMMARY_LIMIT, 0, None, None, "todos", None, False)

    assert {tuple(f["carrier_operation_types"]) for f in filas} == {("Equipo Completo",)}
