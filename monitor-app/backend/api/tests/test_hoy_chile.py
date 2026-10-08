"""`public.hoy_chile()` es el dia calendario de Chile, sin importar el
TimeZone de la sesion. La base corre en UTC (medido el 07/10): con
CURRENT_DATE, un documento que vence hoy figuraba vencido desde las 21:00
de Chile.

La funcion se carga desde la migracion dentro de la transaccion revertida:
se prueba el SQL que se va a desplegar."""
import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.integracion

MIGRACION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261008100000_hoy_chile.sql"
)


async def _cargar(conn) -> None:
    sql = MIGRACION.read_text()
    funcion = re.search(r"CREATE OR REPLACE FUNCTION.*?\$\$;", sql, re.S).group(0)
    await conn.execute(funcion)


async def test_hoy_chile_no_depende_del_timezone_de_la_sesion(conexion_revertida):
    await _cargar(conexion_revertida)
    dias = set()
    for tz in ("UTC", "Asia/Tokyo", "America/Santiago"):
        await conexion_revertida.execute(f"SET LOCAL TimeZone = '{tz}'")
        dias.add(await conexion_revertida.fetchval("SELECT public.hoy_chile()"))
    assert len(dias) == 1


async def test_hoy_chile_es_el_dia_de_santiago(conexion_revertida):
    await _cargar(conexion_revertida)
    esperado = await conexion_revertida.fetchval(
        "SELECT (now() AT TIME ZONE 'America/Santiago')::date"
    )
    assert await conexion_revertida.fetchval("SELECT public.hoy_chile()") == esperado
