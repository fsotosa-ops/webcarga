from urllib.parse import urlsplit

import asyncpg
from fastapi import Request

_pool: asyncpg.Pool | None = None

# El puerto del pooler de Supabase en MODO TRANSACCION. El de sesion es el
# 5432, igual que la conexion directa.
PUERTO_POOLER_TRANSACCION = 6543

# Cuantas conexiones abre CADA instancia de Cloud Run.
#
# El techo no lo pone este numero solo: lo pone multiplicado por
# `--max-instances`, que hoy es 5 (deploy-monitor-api.yml). Y la base es
# chica: `max_connections = 60`, medido. Con el valor anterior —10— el techo
# de la API sola era 50 de 60, y lo primero que se cae al llegar ahi no es la
# API sino los servicios internos de Supabase (postgrest, el exporter, la
# mgmt-api), que ya ocupan ~9.
#
# 5 x 5 = 25 deja la mitad de la base libre. Si algun dia la latencia sube por
# cola de conexiones, este numero puede subir — pero sabiendo que 12 es donde
# vuelve a rozar el techo con 5 instancias.
MAX_CONEXIONES_POR_INSTANCIA = 5
MIN_CONEXIONES_POR_INSTANCIA = 2


def usa_pooler_de_transaccion(dsn: str) -> bool:
    """Si el DSN apunta al pooler en modo transaccion.

    Es la UNICA pregunta que decide si el cache de sentencias preparadas puede
    quedar encendido, y por eso se deriva del DSN en vez de ser una opcion
    aparte: una opcion que hay que acordarse de cambiar junto con la URL es
    exactamente como esto se rompe en silencio.

    En modo transaccion el pooler devuelve el backend al terminar cada
    transaccion, asi que la siguiente consulta puede caer en OTRO backend, que
    no tiene la sentencia preparada que el cliente cree haber preparado.
    Medido contra la base real: 60 consultas concurrentes por el 6543 con el
    cache encendido → 44 fallan con `prepared statement "__asyncpg_stmt_3__"
    does not exist`. Con el cache apagado → 0.

    Y no se apaga siempre "por las dudas" porque no es gratis: sin cache cada
    consulta paga una vuelta de red extra (~25-30 ms desde Cloud Run). Hoy
    produccion va por conexion directa IPv6, donde el backend es dedicado y el
    cache es correcto.
    """
    return urlsplit(dsn).port == PUERTO_POOLER_TRANSACCION


async def init_pool(dsn: str) -> asyncpg.Pool:
    global _pool
    # El kwarg se OMITE cuando no hace falta, en vez de mandarse en None.
    # asyncpg lo valida con `>= 0` y rechaza None con ValueError — o sea que
    # "None es el default" habria tumbado la API al arrancar, en la rama de la
    # conexion directa, que es la que corre hoy en produccion. Se descubrio
    # probando contra la base real; el test que lo mockeaba pasaba igual,
    # porque un mock nunca contradice a la libreria.
    opciones = {"statement_cache_size": 0} if usa_pooler_de_transaccion(dsn) else {}
    _pool = await asyncpg.create_pool(
        dsn,
        min_size=MIN_CONEXIONES_POR_INSTANCIA,
        max_size=MAX_CONEXIONES_POR_INSTANCIA,
        **opciones,
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool
