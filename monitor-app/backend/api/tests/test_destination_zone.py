"""La zona del destino de un viaje, una sola definición (services/destination_zone.py):
la usan el Reporte y las pestañas del Cierre (Flota del día, Viajes, Pendientes)."""
from unittest.mock import AsyncMock

from app.services.destination_zone import ZONES, trip_zones, zone_of


def test_cada_tipo_de_operacion_cae_en_su_zona():
    assert [zone_of(t) for t in ("RM", "Z0", "Region Norte", "Region Sur", None, "Otro")] == \
        ["RM", "Z0", "Región", "Región", "Sin clasificar", "Sin clasificar"]
    assert ZONES == ("RM", "Z0", "Región", "Sin clasificar")


async def test_la_zona_de_cada_viaje_sale_de_su_ultimo_destino_en_el_catalogo_del_cliente():
    async def fetch(sql, *args):
        if "FROM app.trips t" in sql:
            assert sorted(args[0]) == ["t1", "t2", "t3"]
            return [
                {"trip_id": "t1", "shipper_id": "s1", "last_destination_local": "SANTA ROSA - 87"},
                {"trip_id": "t2", "shipper_id": "s1", "last_destination_local": "LOS ANGELES - 36"},
                {"trip_id": "t3", "shipper_id": None, "last_destination_local": None},
            ]
        # El catálogo de lugares del cliente, un solo pedido para el lote.
        return [
            {"shipper_id": "s1", "name": "Santa Rosa", "site_number": "87", "operation_type": "RM"},
            {"shipper_id": "s1", "name": "Los Angeles", "site_number": "36", "operation_type": "Region Sur"},
        ]

    pool = AsyncMock()
    pool.fetch.side_effect = fetch
    assert await trip_zones(pool, ["t1", "t2", "t3", None, "t1"]) == {"t1": "RM", "t2": "Región", "t3": "Sin clasificar"}
    assert pool.fetch.await_count == 2


async def test_sin_viajes_no_va_a_la_base():
    pool = AsyncMock()
    assert await trip_zones(pool, []) == {}
    pool.fetch.assert_not_awaited()
