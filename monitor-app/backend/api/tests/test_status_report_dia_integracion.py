"""Asignados del día vs En ruta desde días anteriores (plan Analítica, Fase 0, 21/10).

Operaciones cuenta como asignado del día al equipo con un viaje planificado ese día.
Un equipo que solo sigue en un viaje de días anteriores va aparte, "en ruta". Antes
el reporte miraba el viaje reportado más tarde: un tracto con un viaje de hoy y otro
de anteayer todavía activo contaba como "en ruta", y no cuadraba con el Excel."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from app.routers.status_report import _build_asset_rows, _resumen_del_tipo
from tests.conftest import PoolDeUnaConexion, asignacion_previa

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-11")


async def _tractor(conn, carrier) -> uuid.UUID:
    tipo = await conn.fetchval("SELECT id FROM app.status_taxonomies WHERE code = 'EQUIPO_COMPLETO'")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id", f"ZZ{uuid.uuid4().hex[:4].upper()}", tipo)
    await asignacion_previa(conn, 'ASSET', tractor, carrier)
    return tractor


async def _viaje(conn, carrier, tractor, planificado: date, reportado: datetime) -> None:
    viaje = uuid.uuid4()
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "status_reported_at, is_active, is_assigned) VALUES ($1, $2, 'X', 'manual', $3, 'Asignado', $4, true, true)",
        viaje, planificado, f"ZZ-DIA-{viaje.hex[:6]}", reportado)
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, tractor_asset_id, link_source) "
        "VALUES ($1, $2, $3, 'manual')", viaje, carrier, tractor)


async def test_el_dia_del_equipo_es_su_viaje_planificado_mas_reciente(conexion_revertida):
    conn = conexion_revertida
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ('ZZ-TEST Dia', 'ACTIVE') RETURNING id")
    hace_dos = D - timedelta(days=2)
    # Con viaje de hoy y otro de anteayer todavía activo, reportado MÁS TARDE que el de hoy.
    del_dia = await _tractor(conn, carrier)
    await _viaje(conn, carrier, del_dia, D, datetime(D.year, D.month, D.day, 9))
    await _viaje(conn, carrier, del_dia, hace_dos, datetime(D.year, D.month, D.day, 18))
    # Solo el viaje de anteayer, todavía activo hoy.
    en_ruta = await _tractor(conn, carrier)
    await _viaje(conn, carrier, en_ruta, hace_dos, datetime(D.year, D.month, D.day, 10))

    filas = {r["asset_id"]: r for r in await _build_asset_rows(PoolDeUnaConexion(conn), D)}

    assert filas[del_dia]["dias_en_curso"] == 0
    assert filas[en_ruta]["dias_en_curso"] == 2
    resumen = _resumen_del_tipo([filas[del_dia], filas[en_ruta]])
    assert (resumen["assigned"], resumen["assigned_today"], resumen["multi_day"]["total"]) == (2, 1, 1)
    assert resumen["multi_day"]["by_days_back"] == {"2": 1}


async def test_la_reporteria_no_devuelve_el_rut(conexion_revertida):
    """/daily-closures/report lo lee todo el que tiene operations.read; el RUT no se usa ahí."""
    from app.routers.daily_closures import _REPORT_SQL
    columnas = [a.name for a in (await conexion_revertida.prepare(_REPORT_SQL)).get_attributes()]
    assert "full_name" in columnas
    assert not {"tax_id", "rut", "phone"} & set(columnas)
