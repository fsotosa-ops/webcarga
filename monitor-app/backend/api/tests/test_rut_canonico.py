"""El RUT tiene UNA forma en la base, y la entrada acepta todas.

Ver `docs/superpowers/plans/2026-08-17-cierre-bloque-0-padron.md`. El padron de
conductor se cruza por RUT, y para un JOIN `12.345.678-5` y `123456785` son dos
personas distintas. El candado vive en Postgres —no en el backend ni en el
formulario— porque `public.drivers` la escribe Mage, no la API: un guardia en
Python no veria nunca esa escritura.

Los RUT de este archivo son SINTETICOS: se eligieron calculando el digito
verificador, no copiando personas reales.
"""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.integracion


# ══════════════════════════════════════════════════════════════════════════
# public.rut_canonico
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("12.345.678-5", "12345678-5"),      # con puntos y guion
        ("12345678-5", "12345678-5"),        # ya canonico, no cambia
        ("123456785", "12345678-5"),         # todo junto
        ("  12.345.678-5  ", "12345678-5"),  # con espacios alrededor
        ("12.345.670-k", "12345670-K"),      # k minuscula -> mayuscula
        ("1.234.567-4", "1234567-4"),        # 7 digitos, DV correcto
    ],
)
async def test_normaliza_todas_las_variantes(conexion_revertida, entrada, esperado):
    obtenido = await conexion_revertida.fetchval("SELECT public.rut_canonico($1)", entrada)
    assert obtenido == esperado


@pytest.mark.parametrize(
    "basura",
    [
        "12345678-9",       # DV incorrecto para ese cuerpo
        "SIN RUT",
        "",
        "   ",
        "-",
        "123",              # muy corto
        "1234567890123",    # muy largo
        None,
    ],
)
async def test_lo_que_no_es_un_rut_devuelve_null(conexion_revertida, basura):
    assert await conexion_revertida.fetchval("SELECT public.rut_canonico($1)", basura) is None


async def test_normalizar_es_idempotente(conexion_revertida):
    """Normalizar lo ya normalizado no lo cambia. Es lo que permite ponerlo en
    un trigger sin que la segunda escritura difiera de la primera."""
    una = await conexion_revertida.fetchval("SELECT public.rut_canonico('12.345.678-5')")
    dos = await conexion_revertida.fetchval("SELECT public.rut_canonico($1)", una)
    assert una == dos == "12345678-5"


async def test_el_dv_es_el_que_desambigua_los_de_ocho_caracteres(conexion_revertida):
    """8 caracteres normalizados pueden ser 7 digitos + DV, o 8 digitos sin DV.
    Se resuelve VALIDANDO: si el ultimo caracter cierra el modulo 11, es DV."""
    conn = conexion_revertida
    # 12345674 -> cuerpo 1234567, DV 4: cierra, se acepta
    assert await conn.fetchval("SELECT public.rut_canonico('12345674')") == "1234567-4"
    # 12345670 -> cuerpo 1234567, DV 0: no cierra (el correcto es 4).
    # No se corrige ni se completa: un RUT mal escrito se rechaza.
    assert await conn.fetchval("SELECT public.rut_canonico('12345670')") is None


async def test_los_ruts_reales_de_drivers_ya_son_canonicos(conexion_revertida):
    """La forma canonica no se inventa: es la que ya tienen las 79 filas de
    produccion. Si esto falla, alguien metio un formato nuevo."""
    fila = await conexion_revertida.fetchrow(
        """
        SELECT count(*) AS total,
               count(*) FILTER (WHERE public.rut_canonico(tax_id) = tax_id) AS canonicos
        FROM public.drivers WHERE tax_id IS NOT NULL
        """
    )
    assert fila["total"] > 0, "sin filas el test no prueba nada"
    assert fila["canonicos"] == fila["total"]


# ══════════════════════════════════════════════════════════════════════════
# El candado de public.drivers.tax_id
# ══════════════════════════════════════════════════════════════════════════

async def test_el_trigger_normaliza_lo_que_entra_sucio(conexion_revertida):
    """Un RUT con puntos entra; lo que queda guardado es canonico."""
    conn = conexion_revertida
    driver_id = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        "Prueba Padron", "12.345.678-5",
    )
    assert await conn.fetchval(
        "SELECT tax_id FROM public.drivers WHERE id = $1", driver_id
    ) == "12345678-5"


async def test_un_rut_invalido_no_entra(conexion_revertida):
    """El DV que no cierra se rechaza con error: no se guarda ni se corrige."""
    with pytest.raises(asyncpg.IntegrityConstraintViolationError):
        await conexion_revertida.execute(
            "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2)",
            "Prueba DV Malo", "12345678-9",
        )


async def test_sin_rut_sigue_permitido(conexion_revertida):
    """Hay 1 conductor real sin RUT esperando que lo completen a mano (ver
    20260814120000_dedupe_drivers_sin_rut.sql). NULL sigue siendo valido."""
    driver_id = await conexion_revertida.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, NULL) RETURNING id",
        "Prueba Sin Rut Padron",
    )
    assert driver_id is not None


async def test_actualizar_tambien_normaliza(conexion_revertida):
    """El trigger es BEFORE INSERT OR UPDATE: editar desde la app tampoco
    puede ensuciar la columna."""
    conn = conexion_revertida
    driver_id = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id) VALUES ($1, $2) RETURNING id",
        "Prueba Update", "12345678-5",
    )
    await conn.execute(
        "UPDATE public.drivers SET tax_id = $1 WHERE id = $2", "1.234.567-4", driver_id)
    assert await conn.fetchval(
        "SELECT tax_id FROM public.drivers WHERE id = $1", driver_id
    ) == "1234567-4"


# ══════════════════════════════════════════════════════════════════════════
# La patente, el mismo tratamiento
# ══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize(
    "entrada,esperado",
    [
        ("gbvc90", "GBVC90"),
        ("GBVC90\t", "GBVC90"),   # el caso real que habia en produccion
        (" GB-VC-90 ", "GBVC90"),
        ("GBVC90", "GBVC90"),
    ],
)
async def test_normaliza_patentes(conexion_revertida, entrada, esperado):
    assert await conexion_revertida.fetchval(
        "SELECT public.patente_canonica($1)", entrada) == esperado


@pytest.mark.parametrize("basura", ["", "   ", "GB", "GBVC901234", None])
async def test_lo_que_no_es_patente_devuelve_null(conexion_revertida, basura):
    assert await conexion_revertida.fetchval(
        "SELECT public.patente_canonica($1)", basura) is None


async def test_no_quedan_patentes_fuera_de_forma(conexion_revertida):
    """Despues de la limpieza, ninguna. Este test es el que detecta que
    alguien volvio a meter una con espacios o un tabulador."""
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.assets WHERE license_plate !~ '^[A-Z0-9]{6}$'") == 0


async def test_una_patente_sucia_no_entra(conexion_revertida):
    conn = conexion_revertida
    asset_id = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, $2) RETURNING id",
        " zzzz99 ", "TRACTOCAMION",
    )
    assert await conn.fetchval(
        "SELECT license_plate FROM public.assets WHERE id = $1", asset_id) == "ZZZZ99"
