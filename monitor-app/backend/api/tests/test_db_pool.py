"""Como se conecta la API, y por que esos numeros.

Estos tests no prueban que Postgres funcione: fijan las DOS decisiones que
tienen consecuencias y que nadie va a recordar dentro de seis meses — cuantas
conexiones abre cada instancia, y cuando hay que apagar el cache de sentencias
preparadas.
"""
import inspect

import pytest

from app.db import (
    MAX_CONEXIONES_POR_INSTANCIA,
    MIN_CONEXIONES_POR_INSTANCIA,
    PUERTO_POOLER_TRANSACCION,
    init_pool,
    usa_pooler_de_transaccion,
)

DIRECTO = "postgresql://postgres:x@db.viclzoftiudkepqnhekv.supabase.co:5432/postgres"
POOLER_SESION = "postgresql://postgres.ref:x@aws-1-us-east-1.pooler.supabase.com:5432/postgres"
POOLER_TRANSACCION = "postgresql://postgres.ref:x@aws-1-us-east-1.pooler.supabase.com:6543/postgres"


@pytest.mark.parametrize(
    "dsn, espera, por_que",
    [
        (DIRECTO, False, "backend dedicado: el cache es correcto y ahorra una vuelta de red"),
        (POOLER_SESION, False, "sesion tambien fija el backend mientras dura la conexion"),
        (POOLER_TRANSACCION, True, "el backend cambia entre consultas: el cache apunta a un plan que ya no esta"),
    ],
)
def test_el_dsn_decide_si_el_cache_de_sentencias_se_apaga(dsn, espera, por_que):
    assert usa_pooler_de_transaccion(dsn) is espera, por_que


def test_el_techo_de_conexiones_deja_la_mitad_de_la_base_libre():
    """`max_connections` de esta base es 60 (medido, no estimado) y
    `--max-instances` es 5. Si este producto se acerca a 60, lo primero que se
    cae no es la API sino postgrest y el exporter de Supabase."""
    MAX_INSTANCIAS = 5          # deploy-monitor-api.yml
    MAX_CONNECTIONS_DE_LA_BASE = 60

    techo = MAX_CONEXIONES_POR_INSTANCIA * MAX_INSTANCIAS

    assert techo <= MAX_CONNECTIONS_DE_LA_BASE // 2, (
        f"la API sola puede tomar {techo} de {MAX_CONNECTIONS_DE_LA_BASE} conexiones. "
        "Si hace falta subirlo, sube tambien max_connections o mueve la API al "
        "pooler en modo transaccion (puerto "
        f"{PUERTO_POOLER_TRANSACCION}), donde el backend se comparte."
    )
    assert MIN_CONEXIONES_POR_INSTANCIA < MAX_CONEXIONES_POR_INSTANCIA


def test_init_pool_le_pasa_a_asyncpg_lo_que_el_dsn_decide(monkeypatch):
    """Que la regla exista no sirve si `init_pool` no la usa. Ya paso en este
    repo: `conftest.py` ponia `statement_cache_size=0` con su comentario
    explicando por que, y la app de produccion no lo ponia."""
    recibidos = {}

    async def falso_create_pool(dsn, **kwargs):
        recibidos.update(kwargs)
        recibidos["dsn"] = dsn
        return object()

    monkeypatch.setattr("app.db.asyncpg.create_pool", falso_create_pool)

    import asyncio

    asyncio.run(init_pool(POOLER_TRANSACCION))
    assert recibidos["statement_cache_size"] == 0
    assert recibidos["max_size"] == MAX_CONEXIONES_POR_INSTANCIA

    recibidos.clear()
    asyncio.run(init_pool(DIRECTO))
    # NO se manda en absoluto. Mandarlo en None revienta: asyncpg lo valida con
    # `>= 0` y devuelve ValueError, o sea que la API no arrancaria. Se
    # descubrio contra la libreria real, no contra este mock.
    assert "statement_cache_size" not in recibidos


def test_asyncpg_rechaza_none_como_valor_del_cache():
    """Fija POR QUE la rama directa OMITE el kwarg en vez de mandarlo en None.

    Sin este test, el proximo que lea `init_pool` puede pensar que el dict
    condicional es un rodeo innecesario y "simplificarlo" a
    `statement_cache_size=0 if ... else None`. Eso es lo que estaba escrito
    hasta que se probo contra la libreria de verdad, y habria impedido que la
    API arrancara — en la rama de la conexion directa, que es la que corre hoy
    en produccion.

    No necesita base: asyncpg valida los argumentos ANTES de abrir el socket,
    asi que apuntando a un puerto cerrado el None falla con ValueError y el 0
    llega hasta el intento de conexion."""
    import asyncio

    import asyncpg

    INALCANZABLE = "postgresql://u:p@127.0.0.1:1/postgres"

    with pytest.raises(ValueError, match="greater or equal to 0"):
        asyncio.run(asyncpg.connect(INALCANZABLE, statement_cache_size=None, timeout=1))

    # Con 0 pasa la validacion y muere recien en la red: la diferencia es el
    # punto del test.
    with pytest.raises(OSError):
        asyncio.run(asyncpg.connect(INALCANZABLE, statement_cache_size=0, timeout=1))
