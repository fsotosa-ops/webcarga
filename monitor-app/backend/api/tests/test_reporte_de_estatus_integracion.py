"""La única consulta que cambió en el rediseño del reporte (spec 2026-10-11):
el conductor del viaje, para "Segundas vueltas", y el cliente con el nombre
del directorio. Se prepara contra Postgres de
verdad para fijar que compila y trae la columna, sin depender de qué viajes
haya ese día."""
import pytest

from app.routers.status_report import _TODAY_TRIPS_SQL

pytestmark = pytest.mark.integracion


async def test_los_viajes_del_dia_traen_el_conductor_resuelto(conexion_revertida):
    sentencia = await conexion_revertida.prepare(_TODAY_TRIPS_SQL)
    columnas = [a.name for a in sentencia.get_attributes()]
    assert "driver_name" in columnas
    # Los viajes de varios días se cuentan desde la fecha de planificación.
    assert "planning_date" in columnas
    assert "client_name" in columnas
