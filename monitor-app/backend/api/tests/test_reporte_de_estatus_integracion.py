"""La única consulta que cambió en el rediseño del reporte (spec 2026-10-11):
el conductor del viaje, para "Segundas vueltas". Se prepara contra Postgres de
verdad para fijar que compila y trae la columna, sin depender de qué viajes
haya ese día."""
import pytest

from app.routers.status_report import _TODAY_TRIPS_SQL

pytestmark = pytest.mark.integracion


async def test_los_viajes_del_dia_traen_el_conductor_resuelto(conexion_revertida):
    sentencia = await conexion_revertida.prepare(_TODAY_TRIPS_SQL)
    columnas = [a.name for a in sentencia.get_attributes()]
    assert "driver_name" in columnas
    assert "planning_date" not in columnas, "días en curso salió del reporte"
