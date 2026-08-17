# extraction_service — job_store compartido + concurrencia global Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el `JobStore` en memoria de `extraction_service` (roto entre las 3 instancias de Cloud Run — causa confirmada de un `KeyError: 'status'` en producción) por un store en Postgres compartido, con un límite de concurrencia global real coordinado por advisory lock.

**Architecture:** Nueva tabla `ops.extraction_jobs` en el mismo Supabase del proyecto. `extraction_service` gana su primera dependencia de Postgres (pool `asyncpg`, mismo patrón que `monitor-app/backend/api`). El `asyncio.Semaphore` per-instancia se reemplaza por un reclamo de "slot" transaccional (`pg_advisory_xact_lock` + `COUNT(status='running')`).

**Tech Stack:** FastAPI, asyncpg, Postgres (Supabase), pytest + AsyncMock (mismo patrón que `monitor-app/backend/api/tests`).

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md` — cualquier duda de alcance se resuelve ahí, no expandir.
- Fuera de alcance (explícito en el spec): screenshots/HTML de fallos a GCS, cambios a los scrapers de QAnalytics/Wingsuite/Sodimac.
- Mismo cliente Postgres que el resto del proyecto: `asyncpg`, pool vía `asyncpg.create_pool(dsn, min_size=2, max_size=10)` (`monitor-app/backend/api/app/db.py`).
- Migraciones del proyecto viven en `monitor-app/backend/supabase/migrations/` (un solo directorio para todo el Supabase del proyecto, aunque el owner de la tabla sea `extraction_service`).
- `ops.extraction_jobs` NO se expone nunca al cliente Supabase público (anon/authenticated) — RLS habilitado sin policies, solo el rol de servicio de `extraction_service` la toca.
- `extraction_service/Dockerfile` instala deps con `pip install .` leyendo `pyproject.toml` directo — no hay lista hardcodeada que sincronizar aparte (a diferencia de `monitor-app/backend`).

---

### Task 1: Migración — tabla `ops.extraction_jobs`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260731200000_extraction_jobs.sql`

**Interfaces:**
- Produces: tabla `ops.extraction_jobs` con columnas `job_id, source, product, client_name, status, request, result, error, queued_at, started_at, completed_at` — usada por todas las tareas siguientes.

- [ ] **Step 1: Escribir la migración**

```sql
-- 20260731200000_extraction_jobs.sql
-- Job store compartido de extraction_service — reemplaza el dict en memoria
-- por-instancia (bug real 2026-07-31: KeyError en producción con maxScale=3,
-- ver docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md).
-- Nunca se expone al cliente Supabase público — RLS sin policies, solo el
-- rol de servicio de extraction_service la toca vía conexión directa.

CREATE TABLE IF NOT EXISTS ops.extraction_jobs (
    job_id        uuid PRIMARY KEY,
    source        text NOT NULL,
    product       text NOT NULL,
    client_name   text NOT NULL,
    status        text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
    request       jsonb NOT NULL,
    result        jsonb,
    error         text,
    queued_at     timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_extraction_jobs_status ON ops.extraction_jobs (status);

ALTER TABLE ops.extraction_jobs ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Aplicar la migración**

Aplicarla contra el proyecto Supabase (`viclzoftiudkepqnhekv`) — usar `mcp__claude_ai_Supabase__apply_migration` (nombre `extraction_jobs`, mismo contenido de arriba) o el flujo de migraciones que ya use el proyecto para `monitor-app/backend/supabase/migrations/`.

- [ ] **Step 3: Verificar**

```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'ops' AND table_name = 'extraction_jobs';
SELECT * FROM ops.extraction_jobs LIMIT 1;  -- debe devolver 0 filas, sin error
```

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260731200000_extraction_jobs.sql
git commit -m "feat(extraction_service): migración ops.extraction_jobs"
```

---

### Task 2: Settings — `database_url` y `QUEUE_TIMEOUT_MS`

**Files:**
- Modify: `extraction_service/app/core/config.py`
- Modify: `extraction_service/.env.example`

**Interfaces:**
- Produces: `settings.database_url: str`, `settings.QUEUE_TIMEOUT_MS: int` — usados por Task 3 (pool) y Task 7 (claim loop).

- [ ] **Step 1: Agregar los settings**

En `extraction_service/app/core/config.py`, dentro de `class Settings(BaseSettings)`, agregar junto a `MAX_CONCURRENT_JOBS`/`JOB_TIMEOUT_MS`:

```python
    # DSN de Postgres (Supabase) para el job_store compartido — mismo
    # proyecto que usa monitor-app/backend/api. Ver
    # docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md.
    database_url: str

    # Tope de espera en cola antes de reclamar un slot (MAX_CONCURRENT_JOBS
    # ya ocupado por otros jobs). Distinto de JOB_TIMEOUT_MS: ese envuelve
    # SOLO el scraping en sí, este envuelve el tiempo en 'queued'. Separarlos
    # permite distinguir "contención" de "el scraper se colgó" en el error.
    QUEUE_TIMEOUT_MS: int = 300_000
```

- [ ] **Step 2: Documentar en `.env.example`**

Agregar a `extraction_service/.env.example`:

```
DATABASE_URL=postgresql://...
QUEUE_TIMEOUT_MS=300000
```

- [ ] **Step 3: Verificar que carga**

```bash
cd extraction_service
python -c "from app.core.config import settings; print(settings.QUEUE_TIMEOUT_MS)"
```
Expected: `300000` (o el valor real de `.env` si `DATABASE_URL` está seteado — si falta, `pydantic-settings` tira `ValidationError` señalando el campo faltante, esperado hasta que se complete el `.env` local).

- [ ] **Step 4: Commit**

```bash
git add extraction_service/app/core/config.py extraction_service/.env.example
git commit -m "feat(extraction_service): agregar database_url y QUEUE_TIMEOUT_MS a settings"
```

---

### Task 3: Pool de Postgres (`app/db.py`)

**Files:**
- Create: `extraction_service/app/db.py`
- Modify: `extraction_service/pyproject.toml`

**Interfaces:**
- Consumes: `settings.database_url` (Task 2).
- Produces: `init_pool(dsn: str) -> asyncpg.Pool`, `close_pool() -> None`, `get_pool(request: Request) -> asyncpg.Pool` — usados por Task 4/5 (store) y Task 6 (lifespan).

- [ ] **Step 1: Agregar `asyncpg` a las dependencias**

En `extraction_service/pyproject.toml`, dentro de `dependencies`:

```toml
    "asyncpg==0.29.0",
```

- [ ] **Step 2: Crear `app/db.py`**

Mismo patrón que `monitor-app/backend/api/app/db.py` (ya probado en producción):

```python
import asyncpg
from fastapi import Request

_pool: asyncpg.Pool | None = None


async def init_pool(dsn: str) -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(dsn, min_size=2, max_size=10)
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def get_pool(request: Request) -> asyncpg.Pool:
    return request.app.state.pool
```

- [ ] **Step 3: Instalar y verificar el import**

```bash
cd extraction_service
pip install -e .
python -c "from app.db import init_pool, close_pool, get_pool; print('ok')"
```
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add extraction_service/app/db.py extraction_service/pyproject.toml
git commit -m "feat(extraction_service): pool asyncpg (app/db.py)"
```

---

### Task 4: `JobStore` respaldado en Postgres

**Files:**
- Modify: `extraction_service/app/jobs/store.py`
- Test: `extraction_service/tests/test_job_store.py`

**Interfaces:**
- Consumes: `asyncpg.Pool` (Task 3), `ExtractionRequest`/`Job`/`JobResult`/`JobStatus` (`app/api/schemas.py`, sin cambios).
- Produces: `JobStore(pool)` con `async create(*, source, product, request) -> Job`, `async get(job_id) -> Optional[Job]`, `async mark_running(job_id)`, `async mark_done(job_id, result)`, `async mark_failed(job_id, error)` — misma firma pública que la versión en memoria (consumida por `routes.py`, Task 7). `job_store` singleton global se elimina — cada instancia de `JobStore` ahora requiere el pool, se crea en Task 6 (lifespan).

- [ ] **Step 1: Escribir los tests (fallando)**

Nota de convención: este proyecto **no** usa `pytest-asyncio` (no está en `pyproject.toml`, ningún test existente lo usa) — todos los tests async del repo llaman `asyncio.run(...)` directo dentro de una función sync (ver `tests/test_qanalytics_adapter.py`/`test_sodimac_adapter.py`). Seguir ese mismo patrón acá, no agregar la dependencia nueva.

```python
# extraction_service/tests/test_job_store.py
import asyncio
import json
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock

from app.api.schemas import ExtractionRequest, JobResult, JobStatus
from app.jobs.store import JobStore


def make_pool():
    """Pool falso: acquire() devuelve un connection mock reusable, con
    transaction() como async context manager no-op (mismo patrón que
    monitor-app/backend/api/tests para pool.acquire/transaction)."""
    conn = AsyncMock()
    conn.transaction.return_value.__aenter__.return_value = None
    conn.transaction.return_value.__aexit__.return_value = None
    pool = AsyncMock()
    pool.acquire.return_value.__aenter__.return_value = conn
    pool.acquire.return_value.__aexit__.return_value = None
    return pool, conn


def test_create_inserts_queued_job_and_returns_it():
    pool, conn = make_pool()
    store = JobStore(pool)
    request = ExtractionRequest(client_name="walmart", timeout_ms=180000)

    job = asyncio.run(store.create(source="qanalytics", product="trips", request=request))

    assert job.status == JobStatus.QUEUED
    assert job.source == "qanalytics"
    insert_call = conn.execute.call_args
    assert "INSERT INTO ops.extraction_jobs" in insert_call.args[0]
    assert insert_call.args[1] == uuid.UUID(job.job_id)  # $1 = job_id


def test_get_returns_none_when_job_missing():
    pool, conn = make_pool()
    conn.fetchrow.return_value = None
    store = JobStore(pool)

    result = asyncio.run(store.get("00000000-0000-0000-0000-000000000000"))

    assert result is None


def test_get_reconstructs_job_from_row():
    pool, conn = make_pool()
    now = datetime.now(timezone.utc)
    conn.fetchrow.return_value = {
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
    pool, conn = make_pool()
    store = JobStore(pool)
    result = JobResult(
        local_path="/tmp/x.csv", gcs_uri="gs://b/x.csv", source="wingsuite",
        product="trips", client_name="colun", timestamp=123,
    )

    asyncio.run(store.mark_done("11111111-1111-1111-1111-111111111111", result))

    update_call = conn.execute.call_args
    assert "status = 'done'" in update_call.args[0] or "status='done'" in update_call.args[0]
    assert "completed_at" in update_call.args[0]


def test_mark_failed_stores_error_message():
    pool, conn = make_pool()
    store = JobStore(pool)

    asyncio.run(store.mark_failed("11111111-1111-1111-1111-111111111111", "boom"))

    update_call = conn.execute.call_args
    assert "boom" in update_call.args  # pasado como parámetro, no interpolado en el SQL
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

```bash
cd extraction_service
python -m pytest tests/test_job_store.py -v
```
Expected: `ModuleNotFoundError` o `ImportError` — `JobStore` todavía no acepta `pool` en el constructor / no existe.

- [ ] **Step 3: Reescribir `app/jobs/store.py`**

```python
"""
JobStore respaldado en Postgres (ops.extraction_jobs) — compartido entre
todas las instancias de Cloud Run.

FIX 2026-07-31: la versión anterior (dict en memoria por proceso) se rompía
con maxScale > 1 — un POST /jobs en la instancia A y un GET /jobs/{id} en
la B nunca se encontraban (KeyError: 'status' confirmado en producción).
Ver docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg

from app.api.schemas import ExtractionRequest, Job, JobResult, JobStatus


class JobStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self._pool = pool

    async def create(
        self,
        *,
        source: str,
        product: str,
        request: ExtractionRequest,
    ) -> Job:
        job_id = uuid.uuid4()
        now = datetime.now(timezone.utc)
        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO ops.extraction_jobs
                    (job_id, source, product, client_name, status, request, queued_at)
                VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6)
                """,
                job_id, source, product, request.client_name,
                request.model_dump_json(), now,
            )
        return Job(
            job_id=str(job_id),
            source=source,
            product=product,
            status=JobStatus.QUEUED,
            created_at=now,
            updated_at=now,
            request=request,
        )

    async def get(self, job_id: str) -> Optional[Job]:
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM ops.extraction_jobs WHERE job_id = $1",
                uuid.UUID(job_id),
            )
        if row is None:
            return None
        return self._row_to_job(row)

    async def mark_running(self, job_id: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ops.extraction_jobs SET status = 'running', started_at = now() "
                "WHERE job_id = $1",
                uuid.UUID(job_id),
            )

    async def mark_done(self, job_id: str, result: JobResult) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ops.extraction_jobs SET status = 'done', result = $2::jsonb, "
                "completed_at = now() WHERE job_id = $1",
                uuid.UUID(job_id), result.model_dump_json(),
            )

    async def mark_failed(self, job_id: str, error: str) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute(
                "UPDATE ops.extraction_jobs SET status = 'failed', error = $2, "
                "completed_at = now() WHERE job_id = $1",
                uuid.UUID(job_id), error,
            )

    @staticmethod
    def _row_to_job(row) -> Job:
        request_data = row["request"]
        if isinstance(request_data, str):
            request_data = json.loads(request_data)
        result_data = row["result"]
        if isinstance(result_data, str):
            result_data = json.loads(result_data)
        return Job(
            job_id=str(row["job_id"]),
            source=row["source"],
            product=row["product"],
            status=JobStatus(row["status"]),
            created_at=row["queued_at"],
            updated_at=row["completed_at"] or row["started_at"] or row["queued_at"],
            request=ExtractionRequest(**request_data),
            result=JobResult(**result_data) if result_data else None,
            error=row["error"],
        )
```

**Nota**: se elimina el singleton `job_store = JobStore()` del final del archivo — ahora `JobStore` se instancia una vez en el `lifespan` de `main.py` (Task 6) con el pool real, igual que `app.state.pool`.

- [ ] **Step 4: Correr los tests para confirmar que pasan**

```bash
cd extraction_service
python -m pytest tests/test_job_store.py -v
```
Expected: 5 passed

- [ ] **Step 5: Commit**

```bash
git add extraction_service/app/jobs/store.py extraction_service/tests/test_job_store.py
git commit -m "feat(extraction_service): JobStore respaldado en Postgres (TDD)"
```

---

### Task 5: Reclamo de slot global (`try_claim_slot`)

**Files:**
- Modify: `extraction_service/app/jobs/store.py`
- Test: `extraction_service/tests/test_job_store.py`

**Interfaces:**
- Consumes: `JobStore._pool` (Task 4).
- Produces: `JobStore.try_claim_slot(job_id: str, max_concurrent: int) -> bool` — usado por Task 7 (`_run_job`).

- [ ] **Step 1: Agregar los tests (fallando)**

Agregar a `extraction_service/tests/test_job_store.py`:

```python
def test_try_claim_slot_succeeds_when_under_limit():
    pool, conn = make_pool()
    conn.fetchval.return_value = 0  # nadie corriendo
    store = JobStore(pool)

    claimed = asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1))

    assert claimed is True
    update_call = conn.execute.call_args
    assert "status = 'running'" in update_call.args[0]


def test_try_claim_slot_fails_when_at_limit():
    pool, conn = make_pool()
    conn.fetchval.return_value = 1  # ya hay 1 corriendo, límite=1
    store = JobStore(pool)

    claimed = asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1))

    assert claimed is False
    # No debe intentar el UPDATE a running si no hay slot
    for call in conn.execute.call_args_list:
        assert "status = 'running'" not in call.args[0]


def test_try_claim_slot_uses_advisory_lock_before_counting():
    pool, conn = make_pool()
    conn.fetchval.return_value = 0
    store = JobStore(pool)

    asyncio.run(store.try_claim_slot("11111111-1111-1111-1111-111111111111", max_concurrent=1))

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
        pool, conn = make_pool()
        conn.fetchval.return_value = running_count["value"]
        store = JobStore(pool)
        claimed = asyncio.run(store.try_claim_slot(str(uuid.uuid4()), max_concurrent=1))
        if claimed:
            claimed_total += 1
            running_count["value"] += 1

    assert claimed_total == 1
```

- [ ] **Step 2: Correr para confirmar que fallan**

```bash
cd extraction_service
python -m pytest tests/test_job_store.py -k try_claim_slot -v
```
Expected: `AttributeError: 'JobStore' object has no attribute 'try_claim_slot'`

- [ ] **Step 3: Implementar `try_claim_slot`**

Agregar como método de `JobStore` en `extraction_service/app/jobs/store.py`:

```python
    async def try_claim_slot(self, job_id: str, max_concurrent: int) -> bool:
        """Reclama un slot de ejecución global (todas las instancias de
        Cloud Run comparten el conteo). El advisory lock serializa el
        check-then-act entre instancias concurrentes — sin él, dos
        instancias podrían leer el mismo COUNT antes de que ninguna
        incremente, y ambas pasarían el límite."""
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtext('extraction_jobs_slot'))"
                )
                running = await conn.fetchval(
                    "SELECT count(*) FROM ops.extraction_jobs WHERE status = 'running'"
                )
                if running >= max_concurrent:
                    return False
                await conn.execute(
                    "UPDATE ops.extraction_jobs SET status = 'running', started_at = now() "
                    "WHERE job_id = $1",
                    uuid.UUID(job_id),
                )
                return True
```

Nota: `mark_running` (Task 4) queda sin uso una vez que `_run_job` se reescriba en Task 7 para usar `try_claim_slot` en su lugar — no se borra en este task (lo usa el test de Task 4), se retira en Task 7 si ya no tiene llamadores.

- [ ] **Step 4: Correr todos los tests del store**

```bash
cd extraction_service
python -m pytest tests/test_job_store.py -v
```
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add extraction_service/app/jobs/store.py extraction_service/tests/test_job_store.py
git commit -m "feat(extraction_service): try_claim_slot — concurrencia global vía advisory lock (TDD)"
```

---

### Task 6: Wiring del pool en `main.py`

**Files:**
- Modify: `extraction_service/app/main.py`

**Interfaces:**
- Consumes: `init_pool`/`close_pool` (Task 3), `settings.database_url` (Task 2).
- Produces: `app.state.pool` disponible para toda la app (consumido por Task 7 vía `Depends(get_pool)`).

- [ ] **Step 1: Agregar el lifespan**

En `extraction_service/app/main.py`, agregar el import y el lifespan (mismo patrón que `monitor-app/backend/api/app/main.py`):

```python
from contextlib import asynccontextmanager

from app.core.config import settings
from app.db import close_pool, init_pool


@asynccontextmanager
async def lifespan(app: FastAPI):
    pool = await init_pool(settings.database_url)
    app.state.pool = pool
    yield
    await close_pool()
```

Y agregar `lifespan=lifespan` a la construcción de `FastAPI(...)`.

- [ ] **Step 2: Verificar que el servidor arranca**

```bash
cd extraction_service
DATABASE_URL="postgresql://..." uvicorn app.main:app --port 8080 &
sleep 3
curl -s http://localhost:8080/api/v1/health
kill %1
```
Expected: respuesta 200 del health check, sin traceback de conexión en el arranque.

- [ ] **Step 3: Commit**

```bash
git add extraction_service/app/main.py
git commit -m "feat(extraction_service): wiring del pool Postgres en lifespan"
```

---

### Task 7: `routes.py` — DI del store + claim-loop con timeout de cola separado

**Files:**
- Modify: `extraction_service/app/api/routes.py`

**Interfaces:**
- Consumes: `get_pool` (Task 3), `JobStore` (Task 4/5), `settings.QUEUE_TIMEOUT_MS`/`settings.JOB_TIMEOUT_MS`/`settings.MAX_CONCURRENT_JOBS` (Task 2).
- Produces: `create_job`/`get_job` con el store vía DI en vez del singleton global.

- [ ] **Step 1: Reemplazar el semáforo por DI del pool**

En `extraction_service/app/api/routes.py`, quitar:
```python
_job_semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT_JOBS)
```
y el import de `job_store` (`from app.jobs.store import job_store`). Agregar:
```python
from fastapi import Depends
from app.db import get_pool
from app.jobs.store import JobStore
```

- [ ] **Step 2: Reescribir `_run_job` con el claim-loop**

Reemplazar el cuerpo de `_run_job` (hoy usa `async with _job_semaphore:`) por:

```python
async def _run_job(
    job_id: str, source: str, product: str, request: ExtractionRequest, store: JobStore
) -> None:
    """Worker que corre la extracción y mantiene ops.extraction_jobs al día.

    FIX 2026-07-31: el semáforo per-instancia se reemplaza por
    try_claim_slot (global, coordinado por Postgres). Un job que no consigue
    slot en QUEUE_TIMEOUT_MS falla con un error explícito de CONTENCIÓN,
    distinguible de un timeout real del scraper (JOB_TIMEOUT_MS, envuelve
    solo extractor.extract())."""
    queue_deadline = asyncio.get_event_loop().time() + settings.QUEUE_TIMEOUT_MS / 1000
    while not await store.try_claim_slot(job_id, settings.MAX_CONCURRENT_JOBS):
        if asyncio.get_event_loop().time() >= queue_deadline:
            await store.mark_failed(
                job_id,
                f"Timeout esperando un slot libre ({settings.QUEUE_TIMEOUT_MS}ms) — "
                f"{settings.MAX_CONCURRENT_JOBS} job(s) corriendo en otras instancias.",
            )
            return
        await asyncio.sleep(5)

    try:
        extractor = get_adapter(source, product)
        artifact = await asyncio.wait_for(
            extractor.extract(
                client_name=request.client_name,
                date_from=request.date_from,
                date_to=request.date_to,
                timeout_ms=request.timeout_ms,
            ),
            timeout=settings.JOB_TIMEOUT_MS / 1000,
        )

        gcs_uri = None
        try:
            ext = os.path.splitext(artifact.local_path)[1] or ".bin"
            blob_name = build_path(
                source=artifact.source, product=artifact.product, client=artifact.client_name,
                timestamp=artifact.timestamp, date_from=artifact.date_from, date_to=artifact.date_to,
                extension=ext,
            )
            gcs_uri = upload_file_to_gcs(
                local_file_path=artifact.local_path, bucket_name=settings.GCS_BUCKET_NAME,
                destination_blob_name=blob_name,
            )
        except Exception as gcs_err:
            logger.error(f"[job {job_id}] Falló subida a GCS: {gcs_err}")

        await store.mark_done(
            job_id,
            JobResult(
                local_path=artifact.local_path, gcs_uri=gcs_uri, source=artifact.source,
                product=artifact.product, client_name=artifact.client_name,
                timestamp=artifact.timestamp, date_from=artifact.date_from, date_to=artifact.date_to,
            ),
        )
    except asyncio.TimeoutError:
        logger.error(f"[job {job_id}] Timeout ({settings.JOB_TIMEOUT_MS}ms) — el scraper no terminó a tiempo.")
        await store.mark_failed(job_id, f"Job timeout after {settings.JOB_TIMEOUT_MS}ms")
    except Exception as e:
        logger.exception(f"[job {job_id}] Falló la extracción")
        await store.mark_failed(job_id, str(e))
```

(`mark_running` de Task 4 queda sin llamadores tras este cambio — se puede dejar en `store.py` como utilidad pública sin uso inmediato, no se borra en este plan.)

- [ ] **Step 3: Actualizar `create_job`/`get_job` para pasar el store**

```python
async def create_job(job_request: JobRequest, pool=Depends(get_pool)) -> Job:
    store = JobStore(pool)
    # ... validar source/product igual que hoy ...
    job = await store.create(source=job_request.source, product=job_request.product, request=extraction_request)
    asyncio.create_task(_run_job(job.job_id, job_request.source, job_request.product, extraction_request, store))
    return job


async def get_job(job_id: str, pool=Depends(get_pool)) -> Job:
    store = JobStore(pool)
    job = await store.get(job_id)
    if job is None:
        raise HTTPException(404, "Job no encontrado.")
    return job
```

- [ ] **Step 4: Smoke test manual end-to-end**

```bash
cd extraction_service
DATABASE_URL="postgresql://..." uvicorn app.main:app --port 8080 &
sleep 3
JOB=$(curl -s -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"source":"sodimac","product":"trips","client_name":"test"}')
echo $JOB | python3 -m json.tool
JOB_ID=$(echo $JOB | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
curl -s http://localhost:8080/api/v1/jobs/$JOB_ID | python3 -m json.tool
kill %1
```
Expected: el segundo `curl` devuelve el mismo job (status `queued` o `running`) — confirma que el estado sobrevive entre requests independientes de la conexión asyncio original (simula lo que antes fallaba entre instancias).

- [ ] **Step 5: Correr la suite completa de extraction_service**

```bash
cd extraction_service
python -m pytest tests/ -v
```
Expected: todos los tests existentes (`test_qanalytics_adapter.py`, `test_sodimac_adapter.py`) siguen en verde — no deberían haberse tocado.

- [ ] **Step 6: Commit**

```bash
git add extraction_service/app/api/routes.py
git commit -m "feat(extraction_service): claim-loop global con timeout de cola separado del timeout de scraping"
```

---

### Task 8: Deploy — secret + env var en Cloud Run

**Files:** (ninguno — checklist de infraestructura, no código)

- [ ] **Step 1: Crear el secret en Secret Manager**

```bash
echo -n "postgresql://<connection-string-real>" | \
  gcloud secrets create extraction-service-database-url \
    --project=webcarga-dev-493220 --data-file=-
```
(Si el secret ya existe, usar `gcloud secrets versions add` en su lugar.)

- [ ] **Step 2: Dar permiso a la service account de Cloud Run**

```bash
gcloud secrets add-iam-policy-binding extraction-service-database-url \
  --project=webcarga-dev-493220 \
  --member="serviceAccount:<service-account-de-webcarga-extraction>" \
  --role="roles/secretmanager.secretAccessor"
```

- [ ] **Step 3: Wire el secret como env var en el deploy**

Actualizar el workflow de deploy de `extraction_service` (`.github/workflows/deploy.yml` según `docs/superpowers/specs/2026-06-18-cicd-redis-bronze-cleanup-design.md`) agregando `--set-secrets=DATABASE_URL=extraction-service-database-url:latest` al comando `gcloud run deploy`, mismo patrón que ya usan `QANALYTICS_PASS`/`WINGSUITE_PASS`/`SODIMAC_PASS` si están en Secret Manager (confirmar convención real revisando ese workflow antes de editarlo — no asumir, ver `feedback_dockerfile_dependency_drift`-style gotcha de mantener infra y código sincronizados).

- [ ] **Step 4: Deploy a `dev` primero, verificar, luego `main`**

Seguir el flujo branch-based ya establecido (push a `dev` → `webcarga-extraction-dev`) — correr el smoke test del Task 7 Step 4 contra la URL real de `dev` antes de promover a `main`. No promover a producción sin confirmación explícita del usuario.

---

## Self-Review

**Cobertura del spec**: Postgres compartido (Task 1, 4) ✓, advisory lock + conteo transaccional (Task 5) ✓, `started_at`/`queued_at`/`completed_at` separados (Task 1, 4) ✓, timeout de cola distinto del de scraping (Task 2, 7) ✓, RLS sin exponer a anon (Task 1) ✓, Secret Manager (Task 8) ✓, fuera de alcance (screenshots, scrapers) — no se tocó en ningún task ✓.

**Placeholders**: ninguno — cada step tiene código real o comando real.

**Consistencia de tipos**: `JobStore.__init__(self, pool)` (Task 4) usado igual en Task 5 y Task 7; `try_claim_slot(job_id: str, max_concurrent: int) -> bool` (Task 5) con la misma firma en su único llamador (Task 7); `get_pool(request: Request) -> asyncpg.Pool` (Task 3) inyectado igual en Task 7 vía `Depends`.
