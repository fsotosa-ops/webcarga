"""Bloque 0 del Directorio, 0.9: la flota de una empresa dada de baja se ve
marcada. Dar de baja archiva, no oculta (P1): la flota sigue vinculada como
historial, y las lecturas tienen que decir que su empresa está de baja (F-04)."""
from __future__ import annotations

import uuid

import pytest

from app.routers.assets import get_asset_summary
from app.routers.carriers import buscar_en_el_directorio
from app.routers.drivers import get_driver_summary, list_drivers
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _flota_de_empresa_de_baja(conn) -> dict:
    s = uuid.uuid4().hex[:6]
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'INACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {s}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {s}")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", driver, carrier)
    asset = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}")
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')", asset, carrier)
    return {"carrier": carrier, "driver": driver, "asset": asset, "sufijo": s}


async def test_la_vista_rapida_dice_que_la_empresa_esta_de_baja(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    pool = PoolDeUnaConexion(conn)
    conductor = await get_driver_summary(f["driver"], pool=pool, _=None)
    equipo = await get_asset_summary(f["asset"], pool=pool, _=None)
    assert conductor["carrier"]["operational_status"] == "INACTIVE"
    assert equipo["carrier"]["operational_status"] == "INACTIVE"


async def test_la_busqueda_del_monitor_trae_la_empresa_y_su_estado(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    filas = await list_drivers(q=f"Conductor {f['sufijo']}", limit=10, pool=PoolDeUnaConexion(conn), _=None)
    assert [(r["carrier_id"], r["carrier_operational_status"]) for r in filas] == [(f["carrier"], "INACTIVE")]


async def test_el_buscador_del_directorio_trae_el_estado_de_la_empresa(conexion_revertida):
    conn = conexion_revertida
    f = await _flota_de_empresa_de_baja(conn)
    r = await buscar_en_el_directorio(q=f"Conductor {f['sufijo']}", limit=10, pool=PoolDeUnaConexion(conn), _=None)
    assert [c["carrier_operational_status"] for c in r["conductores"]] == ["INACTIVE"]
