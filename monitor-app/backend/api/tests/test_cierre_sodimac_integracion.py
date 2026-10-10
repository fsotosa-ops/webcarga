"""Un viaje de Sodimac con flota vinculada asigna su tracto en el Cierre (10/10).

Ítem 4 de la minuta del 09/10: los Sodimac con patente, conductor y empresa
salían de Rezago, pero su tracto de Equipo Completo seguía "No asignado" en
Flota del día, porque las consultas del día excluían ese TMS. Ver
tests/test_viajes_del_dia_sin_exclusion_por_tms.py.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

from app.routers.equipment_closures import _DETAIL_SQL as _DETAIL_TRACTOS_SQL
from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-11")
PREFIJO = "ZZ-TEST-CIERRE-SODIMAC"


async def _escenario(conn):
    """Empresa ACTIVE + tracto de Equipo Completo + conductor, y un viaje de
    Sodimac del día D al que Operaciones le vinculó esa flota."""
    equipo_completo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE code = 'EQUIPO_COMPLETO'")
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) "
        "VALUES ($1, 'ACTIVE') RETURNING id", f"{PREFIJO} Empresa")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", equipo_completo)
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        tractor, carrier)
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) "
        "VALUES ($1, 'ACTIVE') RETURNING id", f"{PREFIJO} Conductor")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        conductor, carrier)
    viaje = uuid.uuid4()
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, "
        "trip_status, status_reported_at, is_active, is_assigned) "
        "VALUES ($1, $2, 'Sodimac', 'sodimac', $3, 'Control de salida', $4, true, true)",
        viaje, D, f"{PREFIJO}-{viaje.hex[:6]}", datetime(D.year, D.month, D.day, 12))
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, carrier_id, tractor_asset_id, link_source) "
        "VALUES ($1, $2, $3, $4, 'manual')", viaje, conductor, carrier, tractor)
    return {"tractor": tractor, "viaje": viaje}


async def test_el_tracto_del_viaje_sodimac_queda_asignado(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    esc = await _escenario(conexion_revertida)

    await cierre_lineas.recalcular(pool, D)

    estado = await conexion_revertida.fetchval(
        "SELECT status FROM app.closure_lines "
        "WHERE business_date = $1 AND subject_type = 'ASSET' AND subject_id = $2",
        D, esc["tractor"])
    assert estado == "ASSIGNED"


async def test_la_fila_del_tracto_lleva_al_viaje_sodimac(conexion_revertida):
    """El "Ver viaje" de Flota del día sale del mismo LATERAL."""
    pool = PoolDeUnaConexion(conexion_revertida)
    esc = await _escenario(conexion_revertida)

    await cierre_lineas.recalcular(pool, D)

    tractos = await conexion_revertida.fetch(_DETAIL_TRACTOS_SQL, D)
    suyo = next(f for f in tractos if f["asset_id"] == esc["tractor"])
    assert str(suyo["trip_id"]) == str(esc["viaje"])
