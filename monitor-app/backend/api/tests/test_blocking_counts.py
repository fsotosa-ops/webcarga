"""Lo que bloquea la habilitación, contado aparte (Entrega 1 de fichas, 15/10).

La ficha dice POR QUÉ alguien no está habilitado. Las cifras del resumen no
sirven para eso: cuentan también los opcionales, que no bloquean. `blocking`
cuenta solo los obligatorios vencidos o faltantes, y la empresa los separa entre
los suyos y los de su flota activa (spec 2026-10-15, F2 y F3)."""
from __future__ import annotations

import pytest

from app.services.entity_summary import driver_summary
from app.services.fleet_compliance import (
    CARRIER_SUMMARY_COLUMNS, carrier_compliance_cte, summary_from_row, take_summary,
)


def test_la_empresa_separa_lo_que_bloquea_entre_lo_suyo_y_su_flota():
    fila = {"worst_state": "MISSING", "own_overdue": 0, "own_expiring": 0, "own_missing": 4,
            "fleet_overdue": 1, "fleet_expiring": 0, "fleet_missing": 6, "can_operate": False,
            "blocking_own": 3, "blocking_fleet": 5, "requirements_met": False}
    assert take_summary(fila, with_fleet=True)["blocking"] == {"own": 3, "fleet": 5}


def test_un_conductor_bloquea_con_sus_obligatorios_y_no_tiene_flota():
    fila = {"operational_status": "ACTIVE", "worst_state": "MISSING", "overdue": 0,
            "expiring": 1, "missing": 2, "blocking_mandatory": 2}
    assert take_summary(fila, with_fleet=False)["blocking"] == {"own": 2, "fleet": None}


@pytest.mark.integracion
async def test_f3_la_empresa_no_esta_habilitada_si_y_solo_si_algo_la_bloquea(conexion_revertida):
    filas = await conexion_revertida.fetch(
        f"WITH {carrier_compliance_cte()} "
        f"SELECT c.operational_status, {', '.join('cc.' + col for col in CARRIER_SUMMARY_COLUMNS)} "
        "FROM public.carriers c JOIN carrier_compliance cc ON cc.carrier_id = c.id"
    )
    assert filas, "sin empresas no hay nada que probar"
    for fila in filas:
        resumen = summary_from_row(fila, with_fleet=True)
        bloquea = resumen.blocking.own + (resumen.blocking.fleet or 0)
        assert resumen.can_operate == (fila["operational_status"] == "ACTIVE" and bloquea == 0), dict(fila)


@pytest.mark.integracion
async def test_f2_el_conductor_no_esta_habilitado_si_y_solo_si_algo_lo_bloquea(conexion_revertida):
    ids = [r["id"] for r in await conexion_revertida.fetch("SELECT id FROM public.drivers")]
    assert ids, "sin conductores no hay nada que probar"
    for driver_id in ids:
        resumen = (await driver_summary(conexion_revertida, driver_id))["compliance_summary"]
        activo = resumen is not None and (await conexion_revertida.fetchval(
            "SELECT operational_status = 'ACTIVE' FROM public.drivers WHERE id = $1", driver_id))
        assert resumen["can_operate"] == (activo and resumen["blocking"]["own"] == 0), (driver_id, resumen)
