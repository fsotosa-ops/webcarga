"""El origen de un viaje es su PRIMERA parada ORIGIN (10/10).

Desde el 18/07 el origen no es una columna de app.trips: es la parada ORIGIN de
app.trip_stops. Sodimac es multiorigen (una fila ORIGIN por bodega, stop_order
0..k-1), y cinco consultas tomaban "una cualquiera" (LIMIT 1 sin orden, o un
JOIN que multiplicaba filas). Todas leen ahora services/origen_del_viaje.py.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest

from app.routers.equipment_closures import _DETAIL_SQL as _DETAIL_TRACTOS_SQL
from app.routers.status_report import _TODAY_TRIPS_SQL
from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-11")
PRIMERO, SEGUNDO = "ZZ-ORIGEN-PRIMERO", "ZZ-ORIGEN-SEGUNDO"


async def _viaje_con_dos_origenes(conn):
    tipo = await conn.fetchval("SELECT id FROM app.status_taxonomies WHERE code = 'EQUIPO_COMPLETO'")
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ('ZZ-TEST Origen', 'ACTIVE') RETURNING id")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id", f"ZZ{uuid.uuid4().hex[:4].upper()}", tipo)
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", tractor, carrier)
    viaje = uuid.uuid4()
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "status_reported_at, is_active, is_assigned) VALUES ($1, $2, 'Sodimac', 'sodimac', $3, 'Control de salida', $4, true, true)",
        viaje, D, f"ZZ-{viaje.hex[:6]}", datetime(D.year, D.month, D.day, 12))
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, tractor_asset_id, link_source) VALUES ($1, $2, $3, 'manual')",
        viaje, carrier, tractor)
    # El segundo origen se escribe PRIMERO: un "LIMIT 1" sin orden tiende a
    # devolver la fila insertada antes, que es justo la equivocada.
    for orden, local in ((1, SEGUNDO), (0, PRIMERO)):
        await conn.execute(
            "INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local) VALUES ($1, $2, $3, 'ORIGIN', $4)",
            f"zz-{viaje.hex[:8]}-{orden}", viaje, orden, local)
    return viaje, tractor


async def test_el_reporte_toma_el_primer_origen(conexion_revertida):
    viaje, _ = await _viaje_con_dos_origenes(conexion_revertida)
    filas = [f for f in await conexion_revertida.fetch(_TODAY_TRIPS_SQL, D) if f["trip_id"] == viaje]
    assert [f["origin_cd"] for f in filas] == [PRIMERO]


async def test_el_detalle_del_cierre_toma_el_primer_origen(conexion_revertida):
    viaje, tractor = await _viaje_con_dos_origenes(conexion_revertida)
    await cierre_lineas.recalcular(PoolDeUnaConexion(conexion_revertida), D)
    filas = [f for f in await conexion_revertida.fetch(_DETAIL_TRACTOS_SQL, D) if f["asset_id"] == tractor]
    assert [f["today_trip_origin"] for f in filas] == [PRIMERO]
