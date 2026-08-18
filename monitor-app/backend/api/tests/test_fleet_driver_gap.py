from unittest.mock import AsyncMock

from app.services.fleet_driver_gap import _FLEET_DRIVER_GAP_SQL, compute_fleet_driver_gap


async def test_compute_fleet_driver_gap_devuelve_filas_tal_cual():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"carrier_id": "c1", "business_name": "Transportes Sur", "n_tractos": 3, "n_conductores": 2, "gap": 1},
        {"carrier_id": "c2", "business_name": "Rios Ltda", "n_tractos": 2, "n_conductores": 4, "gap": -2},
    ]

    rows = await compute_fleet_driver_gap(pool)

    assert rows == [
        {"carrier_id": "c1", "business_name": "Transportes Sur", "n_tractos": 3, "n_conductores": 2, "gap": 1},
        {"carrier_id": "c2", "business_name": "Rios Ltda", "n_tractos": 2, "n_conductores": 4, "gap": -2},
    ]


def test_sql_excluye_equipo_completo():
    assert "wot.code = 'TRACTOREO'" in _FLEET_DRIVER_GAP_SQL


def test_sql_filtra_por_operational_status_active():
    assert "a.operational_status = 'ACTIVE'" in _FLEET_DRIVER_GAP_SQL
    assert "c.operational_status = 'ACTIVE'" in _FLEET_DRIVER_GAP_SQL
    assert "d.operational_status = 'ACTIVE'" in _FLEET_DRIVER_GAP_SQL


def test_sql_excluye_empresas_balanceadas():
    assert "!= COALESCE(td.n_conductores, 0)" in _FLEET_DRIVER_GAP_SQL
