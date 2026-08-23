"""El directorio de empresas, contra Postgres de verdad.

Es la tira de cifras que Pablo echaba de menos del módulo de Empresas: cuántas
empresas hay, cuántas operan, y con qué flota. Se ejercita contra la base porque
son ocho subconsultas correlacionadas en una sola sentencia — exactamente el
tipo de SQL que un AsyncMock no puede contradecir.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.routers.carriers import get_directorio
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _empresa(conn, estado: str) -> str:
    suf = uuid4().hex[:10]
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} {suf}", f"{PREFIJO}-{suf}", estado,
    )


async def _tracto_de(conn, empresa) -> None:
    asset = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) "
        "VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{uuid4().hex[:4].upper()}",
    )
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) "
        "VALUES ($1, $2, 'ACTIVE')",
        asset, empresa,
    )


async def test_una_empresa_activa_suma_en_las_dos_cifras(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    antes = await get_directorio(pool=pool, _=None)
    await _empresa(conexion_revertida, "ACTIVE")
    despues = await get_directorio(pool=pool, _=None)

    assert despues["empresas"]["total"] == antes["empresas"]["total"] + 1
    assert despues["empresas"]["activas"] == antes["empresas"]["activas"] + 1
    assert despues["empresas"]["inactivas"] == antes["empresas"]["inactivas"]


async def test_las_dadas_de_baja_cuentan_como_inactivas_y_no_como_activas(conexion_revertida):
    """`INACTIVE` (baja manual) y `LEGACY_INACTIVE` (histórico) son dos formas
    de lo mismo para quien mira el directorio: no operan. Separarlas en la tira
    de cifras obligaría a Pablo a sumar dos números para saber cuántas quedan
    fuera, que es justo lo que la cifra viene a evitar."""
    pool = PoolDeUnaConexion(conexion_revertida)
    antes = await get_directorio(pool=pool, _=None)
    await _empresa(conexion_revertida, "INACTIVE")
    await _empresa(conexion_revertida, "LEGACY_INACTIVE")
    despues = await get_directorio(pool=pool, _=None)

    assert despues["empresas"]["inactivas"] == antes["empresas"]["inactivas"] + 2
    assert despues["empresas"]["activas"] == antes["empresas"]["activas"]


async def test_la_flota_de_una_empresa_dada_de_baja_no_se_cuenta(conexion_revertida):
    """Contar los 124 vehículos del catálogo diría "124 tractos" incluyendo los
    de empresas dadas de baja hace un año, y ese número no describe ninguna
    operación. La cifra es de la flota que opera."""
    pool = PoolDeUnaConexion(conexion_revertida)
    antes = await get_directorio(pool=pool, _=None)

    activa = await _empresa(conexion_revertida, "ACTIVE")
    de_baja = await _empresa(conexion_revertida, "LEGACY_INACTIVE")
    await _tracto_de(conexion_revertida, activa)
    await _tracto_de(conexion_revertida, de_baja)

    despues = await get_directorio(pool=pool, _=None)
    assert despues["flota"]["tractos"] == antes["flota"]["tractos"] + 1, (
        "se contó el tracto de una empresa que no opera"
    )
