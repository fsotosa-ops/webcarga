"""Fixtures compartidas. Ver test_trip_create.py para el patrón original de
mock de pool.acquire()/conn.transaction() — factorizado acá porque H2.2+
lo repite en varios routers nuevos (carriers/drivers/assets/contacts).

La segunda mitad del archivo es la infraestructura de los tests marcados
`integracion`, que sí ejecutan SQL contra Postgres. Ver el docstring de
`conexion_revertida` antes de escribir uno.
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "editor@webcarga.cl",
    "role": "editor",
}


def wire_transactional_conn(pool: AsyncMock, conn: AsyncMock) -> None:
    """Hace que `async with pool.acquire() as conn: async with conn.transaction():`
    devuelva `conn` y no haga nada real — mismo patrón que test_trip_create.py."""
    acquire_ctx = MagicMock()
    acquire_ctx.__aenter__ = AsyncMock(return_value=conn)
    acquire_ctx.__aexit__ = AsyncMock(return_value=False)
    pool.acquire = MagicMock(return_value=acquire_ctx)

    tx_ctx = MagicMock()
    tx_ctx.__aenter__ = AsyncMock(return_value=None)
    tx_ctx.__aexit__ = AsyncMock(return_value=False)
    conn.transaction = MagicMock(return_value=tx_ctx)


# ══════════════════════════════════════════════════════════════════════════
# Tests de integración: SQL de verdad, contra la base de verdad
# ══════════════════════════════════════════════════════════════════════════
#
# ESTA ES LA ÚNICA BASE QUE HAY. No existe una copia de desarrollo. Por eso
# todo lo que sigue está construido alrededor de una sola regla:
#
#     CADA TEST CORRE DENTRO DE UNA TRANSACCIÓN QUE TERMINA EN ROLLBACK.
#
# La garantía es estructural, no de disciplina: el test nunca ve el objeto
# transacción, sólo recibe una conexión que ya está adentro de una, y el
# `finally` del fixture la revierte pase lo que pase (falle la aserción,
# reviente el SQL, o corte el proceso el usuario). No hay COMMIT en ninguna
# parte de la suite — `test_integracion_certificacion.py` incluye un test que
# lo verifica sobre el propio archivo.
#
# La segunda red es `guardia_de_produccion`: toma la huella de
# public.compliance_records antes del primer test de integración y la vuelve a
# tomar al final de la sesión. Si algo se escapó del rollback, la sesión
# termina en error en vez de terminar en silencio.

RUTA_ENV_BACKEND = Path(__file__).resolve().parents[2] / ".env"

# El host del pooler. `db.<ref>.supabase.co` NO resuelve desde acá (sólo
# publica AAAA/IPv6) y el prefijo `aws-0` es el del pooler viejo: los dos
# fallaban por DNS, no por firewall, y de ahí venía la creencia de que la
# sandbox no llegaba a Postgres. El que responde es `aws-1`.
HOST_POOLER = "aws-1-us-east-1.pooler.supabase.com"
PUERTO_POOLER = 5432
PROYECTO_SUPABASE = "viclzoftiudkepqnhekv"

MOTIVO_SIN_CREDENCIALES = (
    "integracion: falta SUPABASE_DB_PASSWORD (ni en el entorno ni en "
    f"{RUTA_ENV_BACKEND}); los tests que ejecutan SQL real se saltean"
)
MOTIVO_SIN_RED = (
    "integracion: no se pudo abrir la conexion a Postgres "
    f"({HOST_POOLER}); los tests que ejecutan SQL real se saltean"
)


def credenciales_integracion() -> dict | None:
    """Los kwargs de `asyncpg.connect`, o None si no hay contraseña a mano.

    La contraseña se pasa como parámetro, nunca embebida en una URL: así no
    hay que escaparla y no termina impresa en el traceback de un DSN mal
    formado. Se lee del entorno primero y de `monitor-app/backend/.env`
    después, con `dotenv` — nunca de la línea de comandos."""
    clave = os.environ.get("SUPABASE_DB_PASSWORD")
    if not clave and RUTA_ENV_BACKEND.is_file():
        try:
            from dotenv import dotenv_values
        except ModuleNotFoundError:  # pragma: no cover - entorno sin dotenv
            return None
        clave = dotenv_values(RUTA_ENV_BACKEND).get("SUPABASE_DB_PASSWORD")
    if not clave:
        return None
    return {
        "host": HOST_POOLER,
        "port": PUERTO_POOLER,
        "user": f"postgres.{PROYECTO_SUPABASE}",
        "password": clave,
        "database": "postgres",
        "ssl": "require",
        # El pooler comparte sesiones: sentencias preparadas cacheadas del
        # lado del cliente pueden apuntar a un plan que esa sesión ya no
        # tiene. Es la receta estándar de asyncpg contra pgbouncer.
        "statement_cache_size": 0,
        "timeout": 15,
    }


HAY_CREDENCIALES = credenciales_integracion() is not None

# Quién saltea: la fixture `conexion_revertida`, no un skipif de módulo. Así
# los tests que NO necesitan la base —el guardia que revisa el propio
# archivo— siguen corriendo en un entorno sin acceso, que es justamente donde
# más importa que la regla del rollback siga verificada.

SQL_HUELLA = (
    "SELECT count(*) AS filas, "
    "md5(string_agg(id::text, ',' ORDER BY id)) AS huella "
    "FROM public.compliance_records"
)


def _huella_compliance_records() -> tuple | None:
    """(filas, md5) de public.compliance_records, en su propia conexión."""
    import asyncpg

    async def _leer():
        conn = await asyncpg.connect(**credenciales_integracion())
        try:
            fila = await conn.fetchrow(SQL_HUELLA)
            return (fila["filas"], fila["huella"])
        finally:
            await conn.close()

    try:
        return asyncio.run(_leer())
    except Exception:  # sin red: el guardia no puede opinar, y no debe romper
        return None


@pytest.fixture(scope="session")
def guardia_de_produccion():
    """Toma la huella de la tabla antes y después de la sesión.

    No reemplaza al rollback: lo audita. Si un test lograra escribir en firme,
    la sesión termina en error con los dos números a la vista. Es de sesión y
    lo pide `conexion_revertida`, así que una corrida sin tests de integración
    no abre ninguna conexión."""
    antes = _huella_compliance_records()
    yield antes
    despues = _huella_compliance_records()
    if antes is None or despues is None:
        return
    if antes != despues:
        pytest.fail(
            "public.compliance_records CAMBIO durante la corrida: "
            f"antes={antes} despues={despues}. Puede ser una escritura "
            "legitima de otro proceso sobre la misma base, o una fuga de "
            "esta suite. Revisar antes de seguir."
        )


@pytest.fixture
async def conexion_revertida(guardia_de_produccion):
    """Una conexión a Postgres ya metida en una transacción que SIEMPRE se
    revierte.

    El test recibe la conexión, no la transacción: no tiene forma de
    confirmarla ni obligación de acordarse de revertirla. El `finally`
    corre igual si la aserción falla o si el SQL revienta.

    Los datos que use el test los tiene que CREAR él, adentro de esta misma
    transacción. Depender de filas reales por su id ata el test al dato de
    producción del día que se escribió."""
    import asyncpg

    credenciales = credenciales_integracion()
    if credenciales is None:
        pytest.skip(MOTIVO_SIN_CREDENCIALES)
    try:
        conn = await asyncpg.connect(**credenciales)
    except (OSError, asyncio.TimeoutError, asyncpg.PostgresError) as exc:
        pytest.skip(f"{MOTIVO_SIN_RED}: {type(exc).__name__}: {exc}")

    transaccion = conn.transaction()
    await transaccion.start()
    try:
        yield conn
    finally:
        try:
            await transaccion.rollback()
        finally:
            await conn.close()


def pytest_report_header(config):
    """El estado de la capa de integración, en la cabecera de la corrida."""
    if HAY_CREDENCIALES:
        return f"integracion: ACTIVA (Postgres {HOST_POOLER}, cada test en transaccion revertida)"
    return f"integracion: SALTEADA ({MOTIVO_SIN_CREDENCIALES})"


def pytest_configure(config):
    """Y un aviso, porque `pytest -q` —el comando del proyecto— no imprime la
    cabecera. Un test que se saltea en silencio es peor que no tenerlo: sin
    esto, una corrida sin credenciales se ve igual de verde que una que sí
    ejercitó el SQL. Los avisos sí salen con `-q`."""
    if not HAY_CREDENCIALES:
        config.issue_config_time_warning(
            pytest.PytestWarning(
                f"{MOTIVO_SIN_CREDENCIALES}. Nada de esta corrida ejecuto SQL "
                "contra Postgres: el SQL del Tramo 3 queda SIN verificar."
            ),
            stacklevel=2,
        )
