"""El CD base del conductor, contra Postgres de verdad (HU-28).

Las reglas que se fijan acá viven en SQL —un trigger, un COALESCE y una rama de
borrado—, y un AsyncMock no ejecuta ninguna. Todo corre dentro de la transacción
del fixture, que siempre termina en ROLLBACK.

Ojo con el actor: `patch_driver` pasa por `record_manual_edit`, que escribe
`drivers.overridden_by`, y esa columna tiene FK a `auth.users`. El USER sintético
del conftest no existe ahí, así que las escrituras usan `_usuario_real`.
"""
from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.drivers import get_driver, patch_driver
from app.routers.locations import create_location
from app.schemas.driver import DriverPatchBody
from app.schemas.location import LocationCreateBody
from tests.conftest import PoolDeUnaConexion, USER, _usuario_real

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-CDBASE"


async def _shipper(conn) -> str:
    return await conn.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} {uuid4().hex[:10]}",
    )


# El digito verificador lo decide la BASE, no Python: el CHECK
# `drivers_tax_id_is_canonical` usa `public.canonical_rut()`, y reescribir esa
# regla acá daria dos definiciones que se separan el dia que alguien toca una.
#
# La primera version de este helper sorteaba el RUT COMPLETO y confiaba en que
# `canonical_rut` lo aceptara — pero esa funcion VALIDA el digito, asi que un
# numero al azar servia 1 de cada 11 veces. Con 40 reintentos, cada llamada
# fallaba el ~2%, y el archivo la llama 7 veces: ~14% de que la corrida se
# cayera, en un test distinto cada vez. Paso dos veces en la suite completa y
# ninguna corriendo el archivo solo. Un test que cambia de color solo no es un
# test verde, asi que ahora es determinista: se prueban los 11 digitos posibles
# y exactamente uno califica.
_SQL_RUT_LIBRE = """
SELECT r.rut
FROM unnest(ARRAY['0','1','2','3','4','5','6','7','8','9','K']) AS d
CROSS JOIN LATERAL (SELECT public.canonical_rut($1 || d) AS rut) r
WHERE r.rut IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.drivers dr WHERE dr.tax_id = r.rut)
LIMIT 1
"""


async def _conductor(conn) -> str:
    for _ in range(20):
        cuerpo = str(int(uuid4().int % 9_000_000) + 1_000_000)
        rut = await conn.fetchval(_SQL_RUT_LIBRE, cuerpo)
        if rut:
            return await conn.fetchval(
                "INSERT INTO public.drivers (tax_id, full_name, operational_status) "
                "VALUES ($1, $2, 'ACTIVE') RETURNING id",
                rut, f"{PREFIJO} Conductor",
            )
    raise AssertionError("no se pudo generar un RUT canónico libre")


async def _ubicacion(pool, shipper, *, nombre, es_cd):
    """El USER sintético alcanza acá: `create_location` sólo escribe audit_log."""
    return await create_location(
        LocationCreateBody(entity_type="SHIPPER", entity_id=str(shipper),
                           name=f"{PREFIJO} {nombre}", is_origin_cd=es_cd),
        pool=pool, user=USER,
    )


async def _escenario(conn, *, nombre_cd, es_cd=True):
    pool = PoolDeUnaConexion(conn)
    shipper = await _shipper(conn)
    ubicacion = await _ubicacion(pool, shipper, nombre=nombre_cd, es_cd=es_cd)
    return pool, await _usuario_real(conn), ubicacion, await _conductor(conn)


async def test_se_le_asigna_un_cd_base_y_vuelve_con_su_nombre(conexion_revertida):
    pool, actor, cd, driver = await _escenario(conexion_revertida, nombre_cd="CD EL PEÑON")

    salida = await patch_driver(
        str(driver), DriverPatchBody(home_location_id=str(cd["id"])), pool=pool, user=actor,
    )

    assert salida["home_location_id"] == str(cd["id"])
    assert salida["home_location_name"] == f"{PREFIJO} CD EL PEÑON"
    # El generador de carga viaja con el CD: "cada Cliente tiene sus CD de carga".
    assert salida["home_location_shipper"] is not None


async def test_un_local_de_entrega_no_puede_ser_cd_base(conexion_revertida):
    """Lo rechaza el trigger, no la pantalla. Una FK sola diría que apunta a UNA
    ubicación, no que apunte a un CD de origen."""
    pool, actor, local, driver = await _escenario(
        conexion_revertida, nombre_cd="Tienda Maipú", es_cd=False,
    )

    with pytest.raises(HTTPException) as e:
        await patch_driver(
            str(driver), DriverPatchBody(home_location_id=str(local["id"])), pool=pool, user=actor,
        )
    assert e.value.status_code == 422
    assert "centro de distribución" in str(e.value.detail)


async def test_un_cd_dado_de_baja_tampoco(conexion_revertida):
    pool, actor, cd, driver = await _escenario(conexion_revertida, nombre_cd="CD Cerrado")
    await conexion_revertida.execute(
        "UPDATE public.locations SET operational_status = 'INACTIVE' WHERE id = $1", cd["id"],
    )

    with pytest.raises(HTTPException) as e:
        await patch_driver(
            str(driver), DriverPatchBody(home_location_id=str(cd["id"])), pool=pool, user=actor,
        )
    assert e.value.status_code == 422


async def test_cambiar_el_nombre_no_le_borra_el_cd(conexion_revertida):
    """"No mandó la clave" no es "la quiere vacía". Es el bug que este repo ya
    vio en el cierre: cambiar el motivo borraba el comentario."""
    pool, actor, cd, driver = await _escenario(conexion_revertida, nombre_cd="CD QUILICURA")
    await patch_driver(str(driver), DriverPatchBody(home_location_id=str(cd["id"])),
                       pool=pool, user=actor)

    salida = await patch_driver(
        str(driver), DriverPatchBody(full_name="Otro Nombre"), pool=pool, user=actor,
    )

    assert salida["full_name"] == "Otro Nombre"
    assert salida["home_location_id"] == str(cd["id"])


async def test_se_le_puede_quitar_el_cd_base(conexion_revertida):
    """Cadena vacía = quitarlo. Sin esta rama un COALESCE no puede expresar el
    borrado y un CD mal asignado quedaría pegado para siempre."""
    pool, actor, cd, driver = await _escenario(conexion_revertida, nombre_cd="CD LO AGUIRRE")
    await patch_driver(str(driver), DriverPatchBody(home_location_id=str(cd["id"])),
                       pool=pool, user=actor)

    salida = await patch_driver(
        str(driver), DriverPatchBody(home_location_id=""), pool=pool, user=actor,
    )

    assert salida["home_location_id"] is None
    assert salida["home_location_name"] is None


async def test_sin_cd_base_y_sin_viajes_no_se_propone_nada(conexion_revertida):
    """El silencio se dice, no se rellena: un conductor sin historial queda
    "Sin CD", y eso es un pendiente del directorio, no un dato que inventar."""
    pool = PoolDeUnaConexion(conexion_revertida)
    driver = await _conductor(conexion_revertida)

    salida = await get_driver(str(driver), pool=pool, _=USER)

    assert salida["home_location_id"] is None
    assert salida["suggested_home_location"] is None


async def test_con_cd_base_no_se_propone_nada(conexion_revertida):
    """La sugerencia sólo existe para llenar un vacío. Con el dato puesto no se
    ofrece una alternativa: el dato maestro manda."""
    pool, actor, cd, driver = await _escenario(conexion_revertida, nombre_cd="CD Tambores")
    await patch_driver(str(driver), DriverPatchBody(home_location_id=str(cd["id"])),
                       pool=pool, user=actor)

    salida = await get_driver(str(driver), pool=pool, _=USER)

    assert salida["home_location_id"] == str(cd["id"])
    assert salida["suggested_home_location"] is None
