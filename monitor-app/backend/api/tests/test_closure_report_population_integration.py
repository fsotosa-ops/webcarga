"""Quién cuenta en el reporte del Cierre, definido una sola vez en la base (22/10).

El roster de Tractoreo de un día (`app.tractoreo_roster`) y la regla de qué línea entra al
reporte (`app.closure_line_in_report`) los leen el Cierre, la Reportería y la analítica
(gold.fct_fleet_daily_status). Antes la regla vivía solo en el SQL del router del Cierre y
la analítica contaba de más los días anteriores a la primera firma (02/09: 49 contra 41).
Contra Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

from datetime import timedelta

import pytest

from tests.test_closure_single_universe_integration import (
    D, _conductor_en_roster, _go_live, _linea_sin_motivo,
)

pytestmark = pytest.mark.integracion


async def _en_reporte(conn, subject_type, subject_id, dia) -> bool:
    return await conn.fetchval("SELECT app.closure_line_in_report($1::text, $2::uuid, $3::date)", subject_type, subject_id, dia)


async def test_el_roster_del_dia_trae_solo_a_quien_estaba_asignado_ese_dia(conexion_revertida):
    conn = conexion_revertida
    dia = D
    estaba = await _conductor_en_roster(conn)
    entra_despues = await _conductor_en_roster(conn, desde=dia + timedelta(days=1))

    roster = {r["driver_id"]: r for r in await conn.fetch("SELECT * FROM app.tractoreo_roster($1::date)", dia)}

    assert estaba["driver"] in roster
    assert roster[estaba["driver"]]["home_carrier_id"] == estaba["carrier"]
    assert entra_despues["driver"] not in roster


async def test_antes_de_la_primera_firma_solo_cuenta_el_roster_de_ese_dia(conexion_revertida):
    conn = conexion_revertida
    antes = await _go_live(conn) - timedelta(days=1)
    queda = await _conductor_en_roster(conn)
    fuera = await _conductor_en_roster(conn, desde=antes + timedelta(days=1))

    assert await _en_reporte(conn, "DRIVER", queda["driver"], antes) is True
    assert await _en_reporte(conn, "DRIVER", fuera["driver"], antes) is False


async def test_desde_la_primera_firma_cuenta_toda_linea(conexion_revertida):
    conn = conexion_revertida
    await _go_live(conn)
    fuera = await _conductor_en_roster(conn, desde=D + timedelta(days=1))

    assert await _en_reporte(conn, "DRIVER", fuera["driver"], D) is True


async def test_la_regla_es_de_conductores_un_equipo_siempre_cuenta(conexion_revertida):
    conn = conexion_revertida
    antes = await _go_live(conn) - timedelta(days=1)
    tracto = await conn.fetchval("SELECT id FROM public.assets LIMIT 1")

    assert await _en_reporte(conn, "ASSET", tracto, antes) is True


async def test_la_regla_coincide_con_lo_que_muestra_la_reporteria(conexion_revertida):
    """El SQL de la Reportería y la función dicen lo mismo línea por línea."""
    from app.routers.daily_closures import _REPORT_SQL
    conn = conexion_revertida
    antes = await _go_live(conn) - timedelta(days=1)
    queda = await _conductor_en_roster(conn)
    fuera = await _conductor_en_roster(conn, desde=antes + timedelta(days=1))
    await _linea_sin_motivo(conn, queda["driver"], antes)
    await _linea_sin_motivo(conn, fuera["driver"], antes)
    nuestros = {queda["driver"], fuera["driver"]}

    reporte = {f["driver_id"] for f in await conn.fetch(_REPORT_SQL, antes, antes)} & nuestros
    funcion = {d for d in nuestros if await _en_reporte(conn, "DRIVER", d, antes)}

    assert reporte == funcion == {queda["driver"]}


async def _roster(conn, dia) -> set:
    return {r["driver_id"] for r in await conn.fetch("SELECT driver_id FROM app.tractoreo_roster($1::date)", dia)}


async def test_el_roster_excluye_bajas_de_conductor_empresa_y_tracto(conexion_revertida):
    """FIX 2026-08-18: el conductor de baja tampoco cuenta (antes solo se filtraban empresa y tracto)."""
    conn = conexion_revertida
    baja_conductor = await _conductor_en_roster(conn)
    baja_empresa = await _conductor_en_roster(conn)
    baja_tracto = await _conductor_en_roster(conn)
    await conn.execute("UPDATE public.drivers SET operational_status = 'INACTIVE' WHERE id = $1", baja_conductor["driver"])
    await conn.execute("UPDATE public.carriers SET operational_status = 'INACTIVE' WHERE id = $1", baja_empresa["carrier"])
    await conn.execute(
        "UPDATE public.assets SET operational_status = 'INACTIVE' WHERE id IN "
        "(SELECT subject_id FROM app.fleet_assignment_periods WHERE relation = 'ASSET_CARRIER' AND counterpart_id = $1)",
        baja_tracto["carrier"])

    roster = await _roster(conn, D)

    assert not roster & {baja_conductor["driver"], baja_empresa["driver"], baja_tracto["driver"]}


async def test_el_roster_es_solo_de_empresas_con_tracto_de_tractoreo(conexion_revertida):
    """Equipo Completo queda fuera del cierre activo (minuta 2026-08-03)."""
    conn = conexion_revertida
    equipo = await _conductor_en_roster(conn)
    await conn.execute(
        "UPDATE public.assets SET webcarga_operation_type_id = "
        "(SELECT id FROM app.status_taxonomies WHERE code = 'EQUIPO_COMPLETO' LIMIT 1) WHERE id IN "
        "(SELECT subject_id FROM app.fleet_assignment_periods WHERE relation = 'ASSET_CARRIER' AND counterpart_id = $1)",
        equipo["carrier"])

    assert equipo["driver"] not in await _roster(conn, D)
