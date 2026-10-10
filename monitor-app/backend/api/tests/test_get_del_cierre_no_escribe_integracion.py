"""RFC 9110 §9.2.1: leer el Cierre no escribe (spec 2026-10-10, §3.4)."""
from __future__ import annotations

import pytest

from app.routers.daily_closures import get_daily_closure_status
from app.routers.equipment_closures import get_equipment_closure_status
from app.routers.status_report import get_status_report
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

_CONTADORES = "SELECT coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) FROM pg_stat_xact_user_tables"


@pytest.mark.parametrize("leer", [
    lambda pool, f: get_daily_closure_status(fecha=f, pool=pool, _=None),
    lambda pool, f: get_equipment_closure_status(fecha=f, pool=pool, _=None),
    lambda pool, f: get_status_report(fecha=f, client=None, pool=pool, _=None),
])
async def test_leer_el_cierre_no_escribe_ninguna_fila(conexion_revertida, leer):
    fecha = (await conexion_revertida.fetchval("SELECT public.hoy_chile()")).isoformat()
    antes = await conexion_revertida.fetchval(_CONTADORES)
    respuesta = await leer(PoolDeUnaConexion(conexion_revertida), fecha)
    assert await conexion_revertida.fetchval(_CONTADORES) == antes
    assert "pendiente_desde" in respuesta and "calculado_a" in respuesta
