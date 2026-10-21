"""La zona del destino y el tipo de un local, llamados en lote desde la API (services/destination_zone.py).

Las reglas viven en la base (test_trip_location_rules_integration.py las prueba caso a caso). Aquí se prueba que
la API las llama bien: en lote, con los pares correctos, y sin ir a la base cuando no hay nada que resolver."""
from unittest.mock import AsyncMock

import pytest

from app.services.destination_zone import ZONES, operation_types_by_local, trip_zones, zones_by_destination
from tests.conftest import PoolDeUnaConexion
from tests.test_trip_location_rules_integration import WALMART, _shipper, _viaje


def test_el_orden_de_las_zonas():
    assert ZONES == ("RM", "Z0", "Región", "Sin clasificar")


async def test_sin_nada_que_resolver_no_va_a_la_base():
    pool = AsyncMock()
    assert await trip_zones(pool, []) == {}
    assert await zones_by_destination(pool, []) == {}
    assert await operation_types_by_local(pool, []) == {}
    pool.fetch.assert_not_awaited()


@pytest.mark.integracion
async def test_en_lote_contra_la_base(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    shipper = await _shipper(conn, WALMART)
    t1 = await _viaje(conn, shipper, ["SANTA ROSA - 87"], [])
    t2 = await _viaje(conn, shipper, ["CURICO, CAMILO HENRIQUEZ - 279"], [])
    t3 = await _viaje(conn, None, [], [])

    assert await trip_zones(pool, [str(t1), str(t2), str(t3), None, str(t1)]) == {
        str(t1): "RM", str(t2): "Región", str(t3): "Sin clasificar"}
    assert await zones_by_destination(pool, [(shipper, "LINARES - 171"), (shipper, "CD LO AGUIRRE"), (None, None)]) == {
        (shipper, "LINARES - 171"): "Z0", (shipper, "CD LO AGUIRRE"): "Sin clasificar", (None, None): "Sin clasificar"}
    assert await operation_types_by_local(pool, [(shipper, "Santa Rosa"), (shipper, "Santa Rosa")]) == {
        (shipper, "Santa Rosa"): "RM"}
