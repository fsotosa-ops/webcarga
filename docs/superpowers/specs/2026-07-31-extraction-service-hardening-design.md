# Design: extraction_service — job_store compartido + concurrencia global
**Date:** 2026-07-31
**Status:** Approved

---

## Context

Durante la Ronda 61 (ver `AGENTLOG.md`), al corregir el acoplamiento del pipeline `batch_tms_monitor_trips` (un TMS fallando ya no cancela a los demás) y volver a disparar los 5 scrapers casi simultáneos, se confirmó en vivo un bug real de `extraction_service`: `qanalytics_endpoint_sap` recibió `KeyError: 'status'` al hacer `GET /jobs/{job_id}`.

Causa raíz encontrada en el código: `app/jobs/store.py` implementa un `JobStore` **en memoria, por proceso** — el propio docstring ya lo advertía ("V1: un solo proceso uvicorn, dict en memoria... migrar a Redis/DB cuando se necesite multi-worker"). Pero `webcarga-extraction` en Cloud Run ya corre con `maxScale=3` — 3 instancias reales, cada una con su propio diccionario. Un `POST /jobs` que cae en la instancia A y un `GET /jobs/{id}` que cae en la B o C nunca se encuentran: la instancia sin ese `job_id` devuelve una respuesta sin el shape esperado, de ahí el `KeyError`.

El límite de concurrencia (`MAX_CONCURRENT_JOBS=1`, vía `asyncio.Semaphore`) tiene el mismo problema — es por-instancia. Con `maxScale=3`, hoy pueden correr 3 scrapers a la vez sin que ninguna instancia lo sepa (funciona por casualidad, no por diseño). Si se disparan más scrapers que instancias disponibles (el caso real: 5 scrapers de un mismo pipeline), los que quedan en cola no tienen forma de saber si están esperando un slot o si genuinamente fallaron — ambigüedad que costó tiempo real de diagnóstico esta noche.

Este spec cubre el fix de ambos problemas. Explícitamente **no** cubre: captura de screenshots/HTML de fallos a GCS (se evaluó y se descartó para esta ronda), ni cambios a los scrapers de QAnalytics/Wingsuite/Sodimac en sí.

---

## Decisiones de arquitectura

| Decisión | Elección | Alternativa descartada |
|----------|----------|----------------------|
| Backend del job_store | Postgres (Supabase, mismo proyecto `viclzoftiudkepqnhekv`) | Redis/Memorystore — infra nueva, sin historial persistente, VPC connector adicional |
| Esquema/tabla | `ops.extraction_jobs` (tabla nueva) | Reusar `ops.pipeline_runs` — semántica distinta (esa tabla es de corridas de pipeline Mage, no de jobs de scraping) |
| Coordinación de concurrencia global | `pg_advisory_xact_lock()` + `COUNT(status='running') < N` transaccional | Tabla de "slots" fijos con `SELECT FOR UPDATE SKIP LOCKED` — mismo resultado, más infraestructura a mantener sin necesidad hoy |
| Alcance de "logs y fallos" | Solo estado/error estructurado y consultable por SQL | Screenshots/HTML de fallos a GCS en producción — alcance mayor, fuera de esta ronda |
| Cliente Postgres | `asyncpg` (mismo que usa `monitor-app/backend/api`) | Sin alternativa evaluada — es el patrón ya establecido en el proyecto |

---

## Arquitectura

`extraction_service` pasa a depender de Postgres por primera vez — hoy solo sube archivos a GCS (Mage es quien lee de ahí y escribe a `bronze.*`). El `JobStore` en memoria se reemplaza por un store respaldado en `ops.extraction_jobs`, compartido por las 3 (o más) instancias de Cloud Run.

```
POST /jobs → INSERT ops.extraction_jobs (status='queued')
           → worker intenta reclamar slot (advisory lock + count + UPDATE a 'running',
             una sola transacción) — si no hay slot libre, reintenta con backoff acotado
           → extractor.extract() corre
           → UPDATE status='done'|'failed', result/error, completed_at

GET /jobs/{id} → SELECT — funciona igual sin importar qué instancia atienda la request
```

## Componentes

**`ops.extraction_jobs`** (tabla nueva en Supabase):
```
job_id        uuid PK
source        text        -- 'qanalytics' | 'wingsuite' | 'sodimac'
product       text
client_name   text
status        text        -- 'queued' | 'running' | 'done' | 'failed'
request       jsonb        -- ExtractionRequest serializado
result        jsonb        -- JobResult serializado (null hasta 'done')
error         text         -- null salvo 'failed'
queued_at     timestamptz
started_at    timestamptz  -- null hasta reclamar slot — separa "esperando cola" de "corriendo"
completed_at  timestamptz
```

**`app/jobs/store.py`** — reescrito sobre un pool `asyncpg` en vez del dict. Misma interfaz pública (`create`, `get`, `mark_running`, `mark_done`, `mark_failed`) para minimizar el blast radius en `routes.py`.

**`_run_job` (`routes.py`)** — el `async with self._job_semaphore:` actual se reemplaza por un loop que intenta reclamar un slot global:
```python
async def _try_claim_slot(pool, job_id) -> bool:
    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext('extraction_jobs_slot'))")
            running = await conn.fetchval(
                "SELECT count(*) FROM ops.extraction_jobs WHERE status = 'running'"
            )
            if running >= settings.MAX_CONCURRENT_JOBS:
                return False
            await conn.execute(
                "UPDATE ops.extraction_jobs SET status='running', started_at=now() WHERE job_id=$1",
                job_id,
            )
            return True
```
Si no consigue slot, reintenta con backoff corto (ej. cada 5s) hasta un tope propio de espera en cola (ej. 5 minutos) — distinto del timeout de scraping (`JOB_TIMEOUT_MS`, sigue envolviendo solo `extractor.extract()`). Si se agota el tope de cola, el job pasa a `failed` con un error explícito ("timeout esperando un slot libre — X jobs corriendo") distinguible de un timeout real del scraper.

**`MAX_CONCURRENT_JOBS`** cambia de semántica: de "por instancia" a límite **global** real. El valor actual (1) probablemente deba subir una vez que el límite sea de verdad global y coordinado — se decide al implementar, no bloqueante para el diseño.

**Secret nuevo**: connection string de Postgres para `extraction_service`, vía GCP Secret Manager (mismo mecanismo que ya usan `monitor-api`/Mage), no en `.env` plano para producción.

## Manejo de errores

`error` (string) se persiste igual que hoy (`job_store.mark_failed(job_id, str(e))`), pero ahora es consultable por SQL desde cualquier lado sin depender de `gcloud logging` ni de que Mage capture el output — exactamente lo que faltó para diagnosticar el `KeyError` de esta noche en minutos en vez de media hora.

`started_at` separado de `queued_at` responde directamente la pregunta que no se pudo responder en vivo: ¿el job se cayó por contención (mucho tiempo en cola) o porque el scraping en sí se colgó?

## Testing

- Unit: `store.py` con pool `asyncpg` mockeado — verificar que `create`/`mark_running`/`mark_done`/`mark_failed` arman el SQL esperado.
- Unit: lógica de reclamo de slot — simular `N` intentos "concurrentes" (llamadas secuenciales que mockean el mismo estado de conteo) y confirmar que nunca se supera `MAX_CONCURRENT_JOBS` corridos a la vez.
- Integración liviana (si el entorno de test tiene Postgres real disponible, ej. vía el mismo patrón que ya use `monitor-app/backend/api/tests`): dos `JobStore` apuntando a la misma DB de test no pueden reclamar el mismo slot cuando el límite es 1.

## Rollout

Cambio de infraestructura de producción (nueva tabla, nuevo secret, nueva dependencia de red desde `extraction_service` a Supabase). Se implementa y prueba en `dev` primero (`webcarga-extraction-dev` si existe, o validado localmente contra un job real antes de deploy a `main`), mismo criterio que el resto del proyecto — no autoasumir promoción a producción sin confirmación explícita.
