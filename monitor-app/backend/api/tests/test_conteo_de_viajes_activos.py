"""Cuántos viajes activos tiene alguien, antes de desvincularlo de su empresa.

Contra Postgres real, y por un motivo concreto: la primera versión de esta
consulta miraba `vfr.resolved_trailer_asset_id`, una columna que
`app.v_trip_fleet_resolution` NO tiene. Un AsyncMock la habría dado por buena y
el 500 habría aparecido recién en pantalla, justo en el diálogo que existe para
evitar un error.

POR QUÉ EXISTE EL ENDPOINT. Un conductor sin empresa desaparece del cierre del
día —el roster de Tractoreo se arma desde `driver_assignments`—, así que sacarle
la empresa a alguien que está manejando lo vuelve invisible sin que nada avise.
El 25/08, durante la revisión de la app, se desvinculó a un conductor con 70
viajes en 60 días.
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.routers.trips import conteo_de_viajes_activos
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

NADIE = "00000000-0000-0000-0000-000000000000"


async def _contar(conexion, tipo: str, entity_id: str):
    return await conteo_de_viajes_activos(
        entity_type=tipo, entity_id=entity_id,
        pool=PoolDeUnaConexion(conexion), _=await _usuario_real(conexion),
    )


async def test_la_consulta_corre_contra_el_esquema_real(conexion_revertida):
    """Lo que un mock no puede contradecir: que las columnas existan."""
    respuesta = await _contar(conexion_revertida, "DRIVER", NADIE)

    assert respuesta == {"activos": 0, "ultimo": None}


async def test_tambien_para_un_vehiculo(conexion_revertida):
    respuesta = await _contar(conexion_revertida, "ASSET", NADIE)

    assert respuesta["activos"] == 0


async def test_cuenta_los_viajes_activos_de_un_conductor_que_los_tiene(conexion_revertida):
    """Se elige al conductor DESDE la base, no por un id fijo: atar el test a un
    uuid de producción lo hace fallar el día que ese viaje se cierre."""
    fila = await conexion_revertida.fetchrow(
        """
        SELECT vfr.resolved_driver_id AS id, count(*) AS activos
        FROM app.trips t
        JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
        WHERE t.is_active AND vfr.resolved_driver_id IS NOT NULL
        GROUP BY 1 ORDER BY 2 DESC LIMIT 1
        """,
    )
    if fila is None:
        pytest.skip("no hay ningún viaje activo con conductor resuelto ahora mismo")

    respuesta = await _contar(conexion_revertida, "DRIVER", str(fila["id"]))

    assert respuesta["activos"] == fila["activos"]
    assert respuesta["ultimo"] is not None

