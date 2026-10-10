"""La vuelta se cuenta por patente (minuta 09/10, ítem 7).

Pablo: si una empresa tiene dos tractos que hacen un viaje cada uno, son dos
patentes con una vuelta, no dos vueltas. La única definición es la vista
app.v_driver_daily_trip_legs (la usan el reporte y el filtro "2ª vuelta" del
Monitor); contaba "mismo conductor O mismo tracto", así que un conductor que
cambia de tracto le sumaba una vuelta al segundo.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-11")


async def _tracto(conn):
    return await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", f"ZZ{uuid.uuid4().hex[:4].upper()}")


async def _viaje(conn, *, conductor, tracto, hora):
    viaje = uuid.uuid4()
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned) VALUES ($1, $2, 'Walmart', 'qanalytics', $3, 'RUTA', true, true)",
        viaje, D, f"ZZ-{viaje.hex[:6]}")
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, tractor_asset_id, link_source) VALUES ($1, $2, $3, 'manual')",
        viaje, conductor, tracto)
    await conn.execute(
        "INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local, departure_date) "
        "VALUES ($1, $2, 0, 'ORIGIN', 'ZZ CD', $3)",
        f"zz-{viaje.hex[:8]}", viaje, datetime(D.year, D.month, D.day, hora))
    return viaje


async def _vuelta(conn, viaje):
    return await conn.fetchval("SELECT leg_number FROM app.v_driver_daily_trip_legs WHERE trip_id = $1", viaje)


async def test_un_conductor_que_cambia_de_tracto_no_le_suma_una_vuelta_al_segundo(conexion_revertida):
    conn = conexion_revertida
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('ZZ-TEST Vueltas', 'ACTIVE') RETURNING id")
    x, y = await _tracto(conn), await _tracto(conn)

    en_x = await _viaje(conn, conductor=conductor, tracto=x, hora=8)
    en_y = await _viaje(conn, conductor=conductor, tracto=y, hora=12)

    assert await _vuelta(conn, en_x) == 1
    assert await _vuelta(conn, en_y) == 1


async def test_el_mismo_tracto_dos_veces_en_el_dia_es_la_segunda_vuelta(conexion_revertida):
    conn = conexion_revertida
    a = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('ZZ-TEST Vueltas A', 'ACTIVE') RETURNING id")
    b = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('ZZ-TEST Vueltas B', 'ACTIVE') RETURNING id")
    x = await _tracto(conn)

    primera = await _viaje(conn, conductor=a, tracto=x, hora=8)
    segunda = await _viaje(conn, conductor=b, tracto=x, hora=14)

    assert await _vuelta(conn, primera) == 1
    assert await _vuelta(conn, segunda) == 2


async def test_sin_tracto_resuelto_la_vuelta_se_cuenta_por_conductor(conexion_revertida):
    conn = conexion_revertida
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ('ZZ-TEST Vueltas C', 'ACTIVE') RETURNING id")

    primera = await _viaje(conn, conductor=conductor, tracto=None, hora=8)
    segunda = await _viaje(conn, conductor=conductor, tracto=None, hora=15)

    assert await _vuelta(conn, primera) == 1
    assert await _vuelta(conn, segunda) == 2
