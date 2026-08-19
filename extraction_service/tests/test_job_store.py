import asyncio
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.api.schemas import ExtractionRequest, JobResult, JobStatus
from app.jobs.store import JobStore


def make_pool():
    """Pool falso para los métodos que usan las convenience methods del
    pool directo (pool.execute/pool.fetchrow) — sin acquire() manual, mismo
    patrón que ya usa monitor-app/backend/api (pool.fetch/pool.execute
    directo sobre el AsyncMock)."""
    return AsyncMock()


def make_pool_with_conn():
    """Pool falso para try_claim_slot, que sí necesita una única conexión
    para varias sentencias dentro de la misma transacción. En asyncpg real,
    pool.acquire() y conn.transaction() son llamadas SYNC que devuelven un
    context manager async — por eso van con MagicMock (no AsyncMock, que
    haría de la llamada en sí una coroutine)."""
    conn = AsyncMock()
    txn_cm = AsyncMock()
    conn.transaction = MagicMock(return_value=txn_cm)
    # try_claim_slot hace un conn.fetch(...) para recuperar slots huérfanos.
    # Sin este default, el AsyncMock devuelve un mock truthy y el camino de
    # "hubo huérfanos" se dispara siempre.
    conn.fetch.return_value = []

    acquire_cm = AsyncMock()
    acquire_cm.__aenter__.return_value = conn
    pool = AsyncMock()
    pool.acquire = MagicMock(return_value=acquire_cm)
    return pool, conn


def test_create_inserts_queued_job_and_returns_it():
    pool = make_pool()
    store = JobStore(pool)
    request = ExtractionRequest(client_name="walmart", timeout_ms=180000)

    job = asyncio.run(store.create(source="qanalytics", product="trips", request=request))

    assert job.status == JobStatus.QUEUED
    assert job.source == "qanalytics"
    insert_call = pool.execute.call_args
    assert "INSERT INTO ops.extraction_jobs" in insert_call.args[0]
    assert insert_call.args[1] == uuid.UUID(job.job_id)  # $1 = job_id


def test_get_returns_none_when_job_missing():
    pool = make_pool()
    pool.fetchrow.return_value = None
    store = JobStore(pool)

    result = asyncio.run(store.get("00000000-0000-0000-0000-000000000000"))

    assert result is None


def test_get_reconstructs_job_from_row():
    pool = make_pool()
    now = datetime.now(timezone.utc)
    pool.fetchrow.return_value = {
        "job_id": uuid.uuid4(),
        "source": "sodimac",
        "product": "trips",
        "status": "done",
        "request": json.dumps({"client_name": "sodimac", "timeout_ms": 180000}),
        "result": json.dumps({
            "local_path": "/tmp/x.csv", "gcs_uri": "gs://b/x.csv", "source": "sodimac",
            "product": "trips", "client_name": "sodimac", "timestamp": 123,
        }),
        "error": None,
        "queued_at": now,
        "started_at": now,
        "completed_at": now,
    }
    store = JobStore(pool)

    job = asyncio.run(store.get("11111111-1111-1111-1111-111111111111"))

    assert job.status == JobStatus.DONE
    assert job.result.gcs_uri == "gs://b/x.csv"


def test_mark_done_updates_status_result_and_completed_at():
    pool = make_pool()
    store = JobStore(pool)
    result = JobResult(
        local_path="/tmp/x.csv", gcs_uri="gs://b/x.csv", source="wingsuite",
        product="trips", client_name="colun", timestamp=123,
    )

    asyncio.run(store.mark_done("11111111-1111-1111-1111-111111111111", result))

    update_call = pool.execute.call_args
    assert "status = 'done'" in update_call.args[0]
    assert "completed_at" in update_call.args[0]


def test_mark_failed_stores_error_message():
    pool = make_pool()
    store = JobStore(pool)

    asyncio.run(store.mark_failed("11111111-1111-1111-1111-111111111111", "boom"))

    update_call = pool.execute.call_args
    assert "boom" in update_call.args  # pasado como parámetro, no interpolado en el SQL


def test_try_claim_slot_succeeds_when_under_limit():
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 0  # nadie corriendo
    store = JobStore(pool)

    claimed = asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1, job_timeout_ms=600_000))

    assert claimed is True
    update_call = conn.execute.call_args
    assert "status = 'running'" in update_call.args[0]


def test_try_claim_slot_fails_when_at_limit():
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 1  # ya hay 1 corriendo, límite=1
    store = JobStore(pool)

    claimed = asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1, job_timeout_ms=600_000))

    assert claimed is False
    # No debe intentar el UPDATE a running si no hay slot
    for call in conn.execute.call_args_list:
        assert "status = 'running'" not in call.args[0]


def test_try_claim_slot_uses_advisory_lock_before_counting():
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 0
    store = JobStore(pool)

    asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1, job_timeout_ms=600_000))

    lock_call = conn.execute.call_args_list[0]
    assert "pg_advisory_xact_lock" in lock_call.args[0]


def test_try_claim_slot_respects_limit_under_simulated_concurrent_attempts():
    """Simula 3 intentos 'concurrentes' contra el mismo estado de conteo —
    ninguno debe pasar de max_concurrent=1 reclamado a la vez. Cada llamada
    usa su propio pool/conn mockeado con un `running_count` compartido que
    se actualiza manualmente entre llamadas, imitando lo que vería cada
    instancia real tras el COUNT transaccional."""
    running_count = {"value": 0}
    claimed_total = 0

    for _ in range(3):
        pool, conn = make_pool_with_conn()
        conn.fetchval.return_value = running_count["value"]
        store = JobStore(pool)
        claimed = asyncio.run(store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=600_000))
        if claimed:
            claimed_total += 1
            running_count["value"] += 1

    assert claimed_total == 1


# ── Recuperación de slots huérfanos (incidente 2026-08-19) ───────────────────
#
# Un despliegue de Cloud Run migró el tráfico con un job en vuelo; su instancia
# desapareció y la fila quedó en 'running' para siempre, bloqueando el único
# slot 58 minutos. Los tres scrapers fallaron con "Timeout esperando un slot
# libre" y la ingestión se detuvo por completo.

JOB_TIMEOUT = 600_000
UMBRAL_ESPERADO = JOB_TIMEOUT + JobStore.ORPHAN_GRACE_MS


def _sql_de_recuperacion(conn):
    """La sentencia que marca 'failed' a los running vencidos, si se emitió."""
    for call in conn.fetch.call_args_list:
        if "status = 'running'" in call.args[0] and "started_at <" in call.args[0]:
            return call
    return None


def test_recupera_el_slot_de_un_job_sin_proceso_detras():
    pool, conn = make_pool_with_conn()
    conn.fetch.return_value = [{"job_id": uuid.uuid4()}]  # un huérfano encontrado
    conn.fetchval.return_value = 0  # tras recuperarlo, nadie corriendo
    store = JobStore(pool)

    claimed = asyncio.run(
        store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=JOB_TIMEOUT)
    )

    assert claimed is True, "con el slot huérfano liberado, el job nuevo debe entrar"
    assert _sql_de_recuperacion(conn) is not None


def test_la_recuperacion_ocurre_dentro_del_advisory_lock():
    """Si se hiciera fuera del lock, dos instancias podrían recuperar el mismo
    slot y ambas reclamarlo — justo la carrera que el lock existe para evitar."""
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 0
    store = JobStore(pool)

    asyncio.run(
        store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=JOB_TIMEOUT)
    )

    assert "pg_advisory_xact_lock" in conn.execute.call_args_list[0].args[0]
    assert _sql_de_recuperacion(conn) is not None, "la recuperación debe emitirse"


def test_el_umbral_es_el_timeout_del_job_mas_la_gracia():
    """El invariante: un job no puede correr más de JOB_TIMEOUT_MS porque su
    propio proceso lo mata. La gracia cubre esa escritura final y el desfase de
    reloj — sin ella se podría matar un job vivo a punto de terminar."""
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 0
    store = JobStore(pool)

    asyncio.run(
        store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=JOB_TIMEOUT)
    )

    call = _sql_de_recuperacion(conn)
    assert call.args[1] == UMBRAL_ESPERADO
    assert JobStore.ORPHAN_GRACE_MS > 0, "sin gracia se puede matar un job vivo"


def test_un_job_dentro_del_plazo_sigue_ocupando_su_slot():
    """La recuperación no debe convertirse en una barrida de todo lo running:
    si el que corre está dentro del plazo, el nuevo job espera, como siempre."""
    pool, conn = make_pool_with_conn()
    conn.fetch.return_value = []      # ninguno vencido
    conn.fetchval.return_value = 1    # el que corre sigue vivo, límite=1
    store = JobStore(pool)

    claimed = asyncio.run(
        store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=JOB_TIMEOUT)
    )

    assert claimed is False
    for call in conn.execute.call_args_list:
        assert "SET status = 'running'" not in call.args[0]


def test_el_huerfano_queda_marcado_failed_no_solo_ignorado():
    """Ignorarlo dejaría la tabla mintiendo: un job 'running' eterno que nadie
    corre. Marcarlo failed deja el incidente visible y el estado consistente."""
    pool, conn = make_pool_with_conn()
    conn.fetchval.return_value = 0
    store = JobStore(pool)

    asyncio.run(
        store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1, job_timeout_ms=JOB_TIMEOUT)
    )

    sql = _sql_de_recuperacion(conn).args[0]
    assert "status = 'failed'" in sql
    assert "completed_at = now()" in sql
    assert "error =" in sql, "debe dejar dicho por qué murió"
