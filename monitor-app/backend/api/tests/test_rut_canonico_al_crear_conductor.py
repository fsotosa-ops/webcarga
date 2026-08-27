"""El RUT con puntos y el RUT sin puntos son el mismo conductor.

Contra Postgres real, porque el bug vivía justo en la juntura que un AsyncMock
no puede contradecir: `public.drivers.tax_id` lo canoniza un TRIGGER y lo exige
un CHECK, y el endpoint comparaba el texto crudo.

POR QUÉ EXISTE. Es el bug crítico #1 de la minuta del 25/08. El formulario del
Diario enseña el formato CON puntos en su placeholder ("16.428.339-1"), la base
guarda siempre "NNNNNNNN-D", y el pre-chequeo del alta comparaba literal. Un RUT
que ya existía, tecleado con puntos, esquivaba el pre-chequeo, llegaba al INSERT,
el trigger lo canonizaba y recién ahí chocaba con el UNIQUE: `UniqueViolationError`
sin `except`, o sea **500**. Un dígito verificador malo terminaba igual, por el
CHECK. Y como el frontend no atrapaba nada, los tres casos —409, 500 y 500— se
veían iguales en pantalla: no pasaba nada.
"""
from __future__ import annotations

import secrets

import pytest
from fastapi import HTTPException

from app.routers.drivers import create_driver
from app.schemas.driver import DriverCreateBody
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


async def _rut_libre(conexion) -> tuple[str, str]:
    """Un RUT válido que todavía no exista, en sus dos formatos.

    El dígito verificador lo calcula la MISMA función de la base que usa el
    CHECK. Escribirlo a mano acá sería inventar un dato que la base puede
    rechazar, y el test fallaría por el motivo equivocado."""
    for _ in range(20):
        cuerpo = str(secrets.randbelow(9_000_000) + 10_000_000)  # 8 dígitos
        dv = await conexion.fetchval("SELECT public.rut_check_digit($1)", cuerpo)
        canonico = f"{cuerpo}-{dv}"
        existe = await conexion.fetchval(
            "SELECT 1 FROM public.drivers WHERE tax_id = $1", canonico,
        )
        if not existe:
            con_puntos = f"{cuerpo[:2]}.{cuerpo[2:5]}.{cuerpo[5:]}-{dv}"
            return canonico, con_puntos
    pytest.skip("no se encontró un RUT libre en 20 intentos")


async def _crear(conexion, tax_id: str, nombre: str):
    return await create_driver(
        body=DriverCreateBody(tax_id=tax_id, full_name=nombre),
        pool=PoolDeUnaConexion(conexion),
        user=await _usuario_real(conexion),
    )


async def test_el_rut_con_puntos_se_guarda_canonico(conexion_revertida):
    canonico, con_puntos = await _rut_libre(conexion_revertida)

    creado = await _crear(conexion_revertida, con_puntos, "ZZ Test Conductor Puntos")

    assert creado["tax_id"] == canonico

    guardado = await conexion_revertida.fetchval(
        "SELECT tax_id FROM public.drivers WHERE id = $1", creado["id"],
    )
    assert guardado == canonico


async def test_el_mismo_rut_en_el_otro_formato_da_409_y_no_500(conexion_revertida):
    """El corazón del bug: antes esto reventaba con UniqueViolationError."""
    canonico, con_puntos = await _rut_libre(conexion_revertida)
    primero = await _crear(conexion_revertida, canonico, "ZZ Test Conductor Uno")

    with pytest.raises(HTTPException) as caso:
        await _crear(conexion_revertida, con_puntos, "ZZ Test Conductor Dos")

    assert caso.value.status_code == 409
    # Estructurado y con el id: es lo que le permite a la interfaz ofrecer
    # "asignar a este conductor" en vez de dejar al coordinador sin salida.
    assert caso.value.detail["code"] == "CONDUCTOR_YA_EXISTE"
    assert caso.value.detail["driver_id"] == str(primero["id"])
    assert caso.value.detail["tax_id"] == canonico


async def test_un_digito_verificador_malo_da_422_y_no_500(conexion_revertida):
    cuerpo = "12345678"
    dv_bueno = await conexion_revertida.fetchval("SELECT public.rut_check_digit($1)", cuerpo)
    dv_malo = "0" if dv_bueno != "0" else "1"

    with pytest.raises(HTTPException) as caso:
        await _crear(conexion_revertida, f"{cuerpo}-{dv_malo}", "ZZ Test DV Malo")

    assert caso.value.status_code == 422
    assert caso.value.detail["code"] == "RUT_INVALIDO"


async def test_el_pre_cierre_encuentra_al_conductor_aunque_el_TMS_mande_puntos(conexion_revertida):
    """La otra mitad del mismo bug, la que bloqueaba el cierre del 25/08.

    Los 7 viajes de agosto que traen RUT del TMS lo traen CON puntos, y los 7
    conductores existen al canonizar: la escalación CONDUCTOR_NO_REGISTRADO era
    100% falso positivo. Acá se fija la consulta, no el resultado del día."""
    canonico, con_puntos = await _rut_libre(conexion_revertida)
    await _crear(conexion_revertida, canonico, "ZZ Test Conductor Pre Cierre")

    encontrado = await conexion_revertida.fetchval(
        "SELECT id FROM public.drivers WHERE tax_id = public.canonical_rut($1)", con_puntos,
    )
    assert encontrado is not None

    # Y la comparación vieja, la que fallaba, sigue fallando — si algún día
    # deja de fallar es que la base cambió y este test ya no prueba nada.
    literal = await conexion_revertida.fetchval(
        "SELECT id FROM public.drivers WHERE upper(trim(tax_id)) = upper(trim($1))", con_puntos,
    )
    assert literal is None
