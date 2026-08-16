"""El reordenamiento: una transacción, no dos PATCH.

La mitad de arriba prueba la lógica con una conexión falsa. La mitad de abajo
(`integracion`) la ejecuta contra Postgres, porque un AsyncMock no sabe si el
SQL es válido — dos bugs reales de Postgres ya pasaron por acá.
"""
import inspect
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user, require_admin
from app.db import get_pool
from app.routers.config import router as config_router
from app.routers.status_taxonomies import router as taxonomies_router
from app.services.reordenamiento import (
    ABAJO, ARRIBA, ESTADOS_DEL_TABLERO, TAXONOMIAS, mover_una_posicion,
)
from .conftest import wire_transactional_conn

USER = {"sub": "11111111-1111-1111-1111-111111111111", "email": "a@b.c", "role": "admin"}


def conexion_con(filas, fila_propia=None):
    """Una conexión falsa que devuelve `fila_propia` al primer fetchrow y
    `filas` (el alcance ordenado) al fetch."""
    conn = AsyncMock()
    conn.fetchrow.return_value = fila_propia if fila_propia is not None else {"sort_order": 1}
    conn.fetch.return_value = filas
    return conn


TRES = [
    {"id": "A", "sort_order": 1},
    {"id": "B", "sort_order": 2},
    {"id": "C", "sort_order": 3},
]


def numeros_escritos(conn):
    """(id, sort_order) de cada UPDATE que se ejecutó, en orden."""
    return [(c.args[1], c.args[2]) for c in conn.execute.call_args_list]


# ── La lógica del movimiento ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_subir_intercambia_con_el_de_arriba():
    conn = conexion_con(TRES, {"sort_order": 2})
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "B", ARRIBA)
    assert numeros_escritos(conn) == [("B", 1), ("A", 2)]


@pytest.mark.asyncio
async def test_bajar_intercambia_con_el_de_abajo():
    conn = conexion_con(TRES, {"sort_order": 2})
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "B", ABAJO)
    assert numeros_escritos(conn) == [("C", 2), ("B", 3)]


@pytest.mark.asyncio
async def test_no_toca_las_filas_que_no_se_mueven():
    """`updated_at` no puede mentir sobre las que quedaron donde estaban."""
    conn = conexion_con(TRES, {"sort_order": 2})
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "B", ARRIBA)
    tocados = {id_ for id_, _ in numeros_escritos(conn)}
    assert "C" not in tocados


@pytest.mark.asyncio
async def test_el_primero_no_puede_subir():
    conn = conexion_con(TRES, {"sort_order": 1})
    with pytest.raises(HTTPException) as e:
        await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "A", ARRIBA)
    assert e.value.status_code == 409
    assert conn.execute.await_count == 0


@pytest.mark.asyncio
async def test_el_ultimo_no_puede_bajar():
    conn = conexion_con(TRES, {"sort_order": 3})
    with pytest.raises(HTTPException) as e:
        await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "C", ABAJO)
    assert e.value.status_code == 409


@pytest.mark.asyncio
async def test_un_id_que_no_existe_es_404():
    conn = AsyncMock()
    conn.fetchrow.return_value = None
    with pytest.raises(HTTPException) as e:
        await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "NO_EXISTE", ARRIBA)
    assert e.value.status_code == 404


@pytest.mark.asyncio
async def test_un_elemento_inactivo_no_ocupa_lugar():
    """Existe, pero no está en la lista que se ve: mover no tiene sentido."""
    conn = conexion_con(TRES, {"sort_order": 9})
    with pytest.raises(HTTPException) as e:
        await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "APAGADO", ABAJO)
    assert e.value.status_code == 409


# El empate era el modo de falla del diseño viejo: si el segundo PATCH no
# llegaba, dos filas quedaban con el mismo número. Renumerar el alcance lo
# deshace en el primer movimiento, en vez de dejarlo para siempre.
@pytest.mark.asyncio
async def test_un_empate_heredado_se_deshace_al_mover():
    conn = conexion_con(
        [{"id": "A", "sort_order": 2}, {"id": "B", "sort_order": 2}, {"id": "C", "sort_order": 3}],
        {"sort_order": 2},
    )
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "B", ARRIBA)
    # B baja a 1 y A se queda en 2: el empate desaparece porque el número sale
    # de la POSICIÓN, no de restarle uno al del vecino.
    assert numeros_escritos(conn) == [("B", 1)]


@pytest.mark.asyncio
async def test_una_direccion_inventada_no_llega_a_la_base():
    conn = AsyncMock()
    with pytest.raises(HTTPException) as e:
        await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "A", "adiagonal")
    assert e.value.status_code == 422
    assert conn.fetchrow.await_count == 0


# ── El alcance ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_la_taxonomia_se_mueve_dentro_de_su_dominio():
    """Los vecinos de un estado operacional son los de SU vocabulario, no los
    de los otros cinco que comparten la tabla."""
    conn = conexion_con(TRES, {"sort_order": 2, "domain": "EQUIPMENT_STATE"})
    await mover_una_posicion(conn, TAXONOMIAS, "B", ARRIBA)
    consulta, *args = conn.fetch.call_args.args
    assert "domain = $1" in consulta
    assert args == ["EQUIPMENT_STATE"]


@pytest.mark.asyncio
async def test_el_alcance_se_bloquea_en_el_orden_canonico():
    """Todos los movimientos toman los candados en la misma secuencia: es lo
    que evita que dos simultáneos se traben."""
    conn = conexion_con(TRES, {"sort_order": 2})
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "B", ARRIBA)
    consulta = conn.fetch.call_args.args[0]
    assert f"ORDER BY {ESTADOS_DEL_TABLERO.orden} FOR UPDATE" in consulta


def test_el_orden_canonico_es_total():
    """Un ORDER BY que empata deja "el de al lado" a criterio del plan de
    Postgres: el mismo clic daría resultados distintos."""
    for lista in (ESTADOS_DEL_TABLERO, TAXONOMIAS):
        assert lista.orden.split(", ")[-1] == "id"


def test_la_taxonomia_ordena_igual_que_su_endpoint_de_lista():
    """Si la lista que se ve y la lista contra la que se mueve difirieran,
    subir movería contra un vecino que la pantalla no muestra."""
    from app.routers.status_taxonomies import _SQL_LISTA
    from app.routers.config import _SQL_ESTADOS

    assert _SQL_LISTA.endswith(f"ORDER BY {TAXONOMIAS.orden}")
    assert _SQL_ESTADOS.endswith(f"ORDER BY {ESTADOS_DEL_TABLERO.orden}")


# ── El `sort_order` ya no se puede escribir de a uno ─────────────────────────

def test_el_patch_de_estado_ya_no_acepta_sort_order():
    """Mientras un cliente pueda mandar un número arbitrario, el empate vuelve
    a ser alcanzable por otro camino."""
    from app.routers.config import TripStatusPatch

    assert "sort_order" not in TripStatusPatch.model_fields


def test_el_patch_de_taxonomia_ya_no_acepta_sort_order():
    from app.schemas.status_taxonomy import StatusTaxonomyPatch

    assert "sort_order" not in StatusTaxonomyPatch.model_fields


# ── Los endpoints ────────────────────────────────────────────────────────────

def cliente(pool):
    app = FastAPI()
    app.include_router(config_router, prefix="/api/v1")
    app.include_router(taxonomies_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_admin] = lambda: USER
    return TestClient(app)


def pool_con_conexion(conn):
    pool = AsyncMock()
    wire_transactional_conn(pool, conn)
    return pool


def test_mover_estado_devuelve_la_lista_completa():
    """Mover es un cambio sobre el conjunto: devolver sólo la fila movida
    obligaría al llamador a adivinar qué pasó con la otra."""
    conn = conexion_con(TRES, {"sort_order": 2})
    pool = pool_con_conexion(conn)
    pool.fetch.return_value = [
        {"id": "B", "label": "B", "bg_color": "#fff", "text_color": "#000",
         "group": "en_ruta", "sort_order": 1},
        {"id": "A", "label": "A", "bg_color": "#fff", "text_color": "#000",
         "group": "en_ruta", "sort_order": 2},
    ]
    res = cliente(pool).post("/api/v1/config/statuses/B/move", json={"direction": "up"})
    assert res.status_code == 200
    assert [f["id"] for f in res.json()] == ["B", "A"]


def test_mover_estado_corre_dentro_de_una_transaccion():
    """La garantía entera del arreglo. Sin transacción son otra vez dos
    escrituras sueltas, sólo que ahora del lado del servidor."""
    conn = conexion_con(TRES, {"sort_order": 2})
    pool = pool_con_conexion(conn)
    pool.fetch.return_value = []
    cliente(pool).post("/api/v1/config/statuses/B/move", json={"direction": "up"})
    assert conn.transaction.call_count == 1


def test_una_direccion_invalida_es_422_de_pydantic():
    conn = conexion_con(TRES)
    pool = pool_con_conexion(conn)
    res = cliente(pool).post("/api/v1/config/statuses/B/move", json={"direction": "arriba"})
    assert res.status_code == 422
    assert conn.execute.await_count == 0


def test_mover_taxonomia_devuelve_su_dominio_completo():
    uuid_b = "22222222-2222-2222-2222-222222222222"
    conn = conexion_con(
        [{"id": "11111111-1111-1111-1111-111111111111", "sort_order": 1},
         {"id": uuid_b, "sort_order": 2}],
        {"sort_order": 2, "domain": "EQUIPMENT_STATE"},
    )
    pool = pool_con_conexion(conn)
    pool.fetchval.return_value = "EQUIPMENT_STATE"
    pool.fetch.return_value = [{"id": "B", "domain": "EQUIPMENT_STATE", "label": "B",
                                "bg_color": "#fff", "text_color": "#000", "group": None,
                                "sort_order": 1, "active": True}]
    res = cliente(pool).post(
        "/api/v1/config/taxonomies/22222222-2222-2222-2222-222222222222/move",
        json={"direction": "up"},
    )
    assert res.status_code == 200
    assert res.json()[0]["id"] == "B"
    assert pool.fetch.call_args.args[1] == "EQUIPMENT_STATE"


# ── Contra Postgres ──────────────────────────────────────────────────────────

@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_el_sql_del_movimiento_corre_de_verdad(conexion_revertida):
    """Un AsyncMock acepta cualquier SQL. Esto lo ejecuta.

    Los datos los crea el test dentro de la misma transacción revertida —
    nunca se mueve una fila real de producción."""
    conn = conexion_revertida
    await conn.execute(
        """
        INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order, active)
        VALUES ('ZZ_PRUEBA_1', 'Prueba 1', '#fff', '#000', 'otro', 9001, true),
               ('ZZ_PRUEBA_2', 'Prueba 2', '#fff', '#000', 'otro', 9002, true)
        """
    )

    antes = await conn.fetch(
        "SELECT id FROM app.trip_statuses WHERE active = true "
        f"ORDER BY {ESTADOS_DEL_TABLERO.orden}"
    )
    posicion_1 = [r["id"] for r in antes].index("ZZ_PRUEBA_1")
    posicion_2 = [r["id"] for r in antes].index("ZZ_PRUEBA_2")
    assert posicion_2 == posicion_1 + 1

    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "ZZ_PRUEBA_2", ARRIBA)

    despues = [r["id"] for r in await conn.fetch(
        "SELECT id FROM app.trip_statuses WHERE active = true "
        f"ORDER BY {ESTADOS_DEL_TABLERO.orden}"
    )]
    assert despues.index("ZZ_PRUEBA_2") == posicion_1
    assert despues.index("ZZ_PRUEBA_1") == posicion_1 + 1


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_el_orden_queda_sin_empates(conexion_revertida):
    """La propiedad que el diseño viejo no podía garantizar."""
    conn = conexion_revertida
    await conn.execute(
        """
        INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order, active)
        VALUES ('ZZ_EMPATE_1', 'Empate 1', '#fff', '#000', 'otro', 9500, true),
               ('ZZ_EMPATE_2', 'Empate 2', '#fff', '#000', 'otro', 9500, true)
        """
    )
    await mover_una_posicion(conn, ESTADOS_DEL_TABLERO, "ZZ_EMPATE_2", ARRIBA)

    empates = await conn.fetchval(
        "SELECT count(*) FROM (SELECT sort_order FROM app.trip_statuses "
        "WHERE active = true GROUP BY sort_order HAVING count(*) > 1) x"
    )
    assert empates == 0


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_la_taxonomia_no_pisa_otro_dominio(conexion_revertida):
    """Mover dentro de un vocabulario no puede renumerar los otros cinco.

    Los dos valores de prueba entran en un dominio que YA existe: la columna
    `domain` tiene un CHECK, así que un dominio inventado ni siquiera se puede
    insertar (verificado — el primer intento de este test falló ahí)."""
    conn = conexion_revertida
    ids = await conn.fetch(
        """
        INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order)
        VALUES ('EQUIPMENT_STATE', 'ZZ Prueba Uno', '#fff', '#000', 9001),
               ('EQUIPMENT_STATE', 'ZZ Prueba Dos', '#fff', '#000', 9002)
        RETURNING id::text AS id, label
        """
    )
    dos = next(r["id"] for r in ids if r["label"].endswith("Dos"))

    otros_antes = await conn.fetch(
        "SELECT id::text AS id, sort_order FROM app.status_taxonomies "
        "WHERE domain = 'DRIVER_REASON' ORDER BY id"
    )
    await mover_una_posicion(conn, TAXONOMIAS, dos, ARRIBA)
    otros_despues = await conn.fetch(
        "SELECT id::text AS id, sort_order FROM app.status_taxonomies "
        "WHERE domain = 'DRIVER_REASON' ORDER BY id"
    )

    assert [dict(r) for r in otros_antes] == [dict(r) for r in otros_despues]
    orden = await conn.fetch(
        "SELECT label FROM app.status_taxonomies WHERE domain = 'EQUIPMENT_STATE' "
        f"AND active = true ORDER BY {TAXONOMIAS.orden}"
    )
    finales = [r["label"] for r in orden][-2:]
    assert finales == ["ZZ Prueba Dos", "ZZ Prueba Uno"]


def test_el_modulo_de_reordenamiento_no_confirma_nada():
    """El servicio recibe una conexión que ya está en una transacción y no
    tiene forma de cerrarla: si acá apareciera un `commit`, el rollback de los
    tests de integración dejaría de ser una garantía."""
    from app.services import reordenamiento

    fuente = inspect.getsource(reordenamiento)
    assert "commit" not in fuente
    assert "asyncpg.connect" not in fuente
