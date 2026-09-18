"""El rol "CD de origen" sobre public.locations, contra Postgres de verdad (HU-28).

POR QUÉ ESTE ARCHIVO EXISTE. `routers/locations.py` no tenía NINGÚN test de
integración: sus 789 tests mockeados pasan aunque `_LOCATION_FIELDS` nombre una
columna que la tabla no tiene, porque un AsyncMock nunca contradice al SQL. Es
literalmente el modo de falla que este proyecto ya pagó dos veces en producción
(un `max(uuid)` y una columna inexistente).

Estos tests ejercitan los endpoints REALES sobre la conexión del fixture, que
está dentro de una transacción que siempre termina en ROLLBACK.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.routers.locations import create_location, list_locations, patch_location
from app.schemas.location import LocationCreateBody, LocationPatchBody
from tests.conftest import PoolDeUnaConexion, USER

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-CD"


async def _shipper(conn) -> str:
    return await conn.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} {uuid4().hex[:10]}",
    )


async def _listar(pool, **kwargs):
    """list_locations tiene 12 parámetros con default; se nombran sólo los del caso."""
    base = dict(
        entity_type="", entity_id="", q="", operation_type="", operational_status="",
        incomplete="", needs_manual_classification="", include_rate="", origin="",
        page=1, limit=50,
    )
    base.update(kwargs)
    return await list_locations(pool=pool, _=USER, **base)


async def test_el_listado_devuelve_is_origin(conexion_revertida):
    """El que habría atajado el despliegue en el orden equivocado: si la columna
    no existe en la base, este SELECT revienta aunque todo lo mockeado esté verde."""
    pool = PoolDeUnaConexion(conexion_revertida)
    shipper = await _shipper(conexion_revertida)

    await create_location(
        LocationCreateBody(entity_type="SHIPPER", entity_id=str(shipper), name=f"{PREFIJO} Bodega"),
        pool=pool, user=USER,
    )
    salida = await _listar(pool, entity_id=str(shipper))

    assert salida["count"] == 1
    assert "is_origin" in salida["data"][0]
    # Un local nace SIN el rol: el catálogo de CD no se llena solo.
    assert salida["data"][0]["is_origin"] is False


async def test_un_lugar_puede_ser_cd_de_origen_y_local_de_entrega_a_la_vez(conexion_revertida):
    """La razón de que sea un booleano y no un `kind` de valor único: medido el
    2026-09-17, 14 de los 24 orígenes observados YA existían como local de
    entrega. Un valor único obligaría a duplicar esas filas."""
    pool = PoolDeUnaConexion(conexion_revertida)
    shipper = await _shipper(conexion_revertida)

    creado = await create_location(
        LocationCreateBody(
            entity_type="SHIPPER", entity_id=str(shipper),
            name=f"{PREFIJO} La Farfana", site_number="256", operation_type="RM",
        ),
        pool=pool, user=USER,
    )

    tras_marcar = await patch_location(
        str(creado["id"]), LocationPatchBody(is_origin=True), pool=pool, user=USER,
    )

    assert tras_marcar["is_origin"] is True
    # No perdió nada de lo que lo hacía un local de entrega.
    assert tras_marcar["site_number"] == "256"
    assert tras_marcar["operation_type"] == "RM"


async def test_el_filtro_origin_cd_recorta_el_listado(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    shipper = await _shipper(conexion_revertida)

    cd = await create_location(
        LocationCreateBody(entity_type="SHIPPER", entity_id=str(shipper),
                           name=f"{PREFIJO} CD EL PEÑON", is_origin=True),
        pool=pool, user=USER,
    )
    await create_location(
        LocationCreateBody(entity_type="SHIPPER", entity_id=str(shipper),
                           name=f"{PREFIJO} Tienda"),
        pool=pool, user=USER,
    )

    todos = await _listar(pool, entity_id=str(shipper))
    solo_cd = await _listar(pool, entity_id=str(shipper), origin="true")

    assert todos["count"] == 2
    assert solo_cd["count"] == 1
    assert solo_cd["data"][0]["id"] == cd["id"]


async def test_se_le_puede_quitar_el_rol_de_cd(conexion_revertida):
    """`false` es un valor que se guarda, no un "no mandó la clave". Si el PATCH
    usara `CASE WHEN ... THEN` en vez de COALESCE sobre un Optional[bool], un CD
    dado de baja del catálogo se quedaría marcado para siempre."""
    pool = PoolDeUnaConexion(conexion_revertida)
    shipper = await _shipper(conexion_revertida)

    creado = await create_location(
        LocationCreateBody(entity_type="SHIPPER", entity_id=str(shipper),
                           name=f"{PREFIJO} Ex CD", is_origin=True),
        pool=pool, user=USER,
    )
    assert creado["is_origin"] is True

    apagado = await patch_location(
        str(creado["id"]), LocationPatchBody(is_origin=False), pool=pool, user=USER,
    )
    assert apagado["is_origin"] is False

    # Y no se lo llevó puesto un campo que no se tocó.
    assert apagado["name"] == f"{PREFIJO} Ex CD"
