"""
JobStore respaldado en Postgres (ops.extraction_jobs) — compartido entre
todas las instancias de Cloud Run.

FIX 2026-07-31: la versión anterior (dict en memoria por proceso) se rompía
con maxScale > 1 — un POST /jobs en la instancia A y un GET /jobs/{id} en
la B nunca se encontraban (KeyError: 'status' confirmado en producción).
Ver docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md.
"""

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import asyncpg

from app.api.schemas import ExtractionRequest, Job, JobResult, JobStatus

logger = logging.getLogger(__name__)


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
        await self._pool.execute(
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
        row = await self._pool.fetchrow(
            "SELECT * FROM ops.extraction_jobs WHERE job_id = $1",
            uuid.UUID(job_id),
        )
        if row is None:
            return None
        return self._row_to_job(row)

    async def mark_running(self, job_id: str) -> None:
        await self._pool.execute(
            "UPDATE ops.extraction_jobs SET status = 'running', started_at = now() "
            "WHERE job_id = $1",
            uuid.UUID(job_id),
        )

    async def mark_done(self, job_id: str, result: JobResult) -> None:
        await self._pool.execute(
            "UPDATE ops.extraction_jobs SET status = 'done', result = $2::jsonb, "
            "completed_at = now() WHERE job_id = $1",
            uuid.UUID(job_id), result.model_dump_json(),
        )

    async def mark_failed(self, job_id: str, error: str) -> None:
        await self._pool.execute(
            "UPDATE ops.extraction_jobs SET status = 'failed', error = $2, "
            "completed_at = now() WHERE job_id = $1",
            uuid.UUID(job_id), error,
        )

    # Margen sobre JOB_TIMEOUT_MS antes de dar por muerto un job 'running'.
    # El proceso dueño se mata solo al cumplirse JOB_TIMEOUT_MS
    # (asyncio.wait_for en routes.py) y recién ahí escribe 'failed'; el
    # margen cubre esa escritura y cualquier desfase de reloj entre la
    # instancia y Postgres. No hace falta que sea fino: lo único que cuesta
    # un margen amplio es tardar más en recuperar un slot ya perdido.
    ORPHAN_GRACE_MS = 60_000

    async def try_claim_slot(
        self, job_id: str, max_concurrent: int, job_timeout_ms: int
    ) -> bool:
        """Reclama un slot de ejecución global (todas las instancias de
        Cloud Run comparten el conteo). El advisory lock serializa el
        check-then-act entre instancias concurrentes — sin él, dos
        instancias podrían leer el mismo COUNT antes de que ninguna
        incremente, y ambas pasarían el límite.

        RECUPERACIÓN DE SLOTS HUÉRFANOS (incidente 2026-08-19): el slot se
        ocupa poniendo status='running' y se libera cuando el job pasa a
        done/failed. Si la INSTANCIA desaparece con el job en vuelo, nadie
        escribe ese estado final y la fila bloquea el slot para siempre.
        Pasó de verdad: un despliegue de Cloud Run migró el tráfico a las
        02:02:57Z, un job arrancó 3 segundos después, su instancia se fue, y
        el único slot quedó tomado 58 minutos. Los tres scrapers fallaron con
        'Timeout esperando un slot libre' y la ingestión se detuvo por
        completo — sin archivos nuevos, los bloques de Mage aguas abajo
        reventaron con errores que no tenían nada que ver con la causa.

        El riesgo no es exclusivo del despliegue: el job corre en un
        `asyncio.create_task` y Cloud Run no garantiza CPU ni vida de la
        instancia fuera del ciclo de una request.

        La recuperación se apoya en un invariante que el diseño YA asume: un
        job no puede estar 'running' más de JOB_TIMEOUT_MS, porque su propio
        proceso lo mata a esa altura. Una fila que lo supera no tiene proceso
        detrás — está muerta, y su slot debe volver al pool. Se marca 'failed'
        en vez de sólo ignorarla para que el estado quede consistente y el
        incidente sea visible en la tabla.
        """
        umbral_ms = job_timeout_ms + self.ORPHAN_GRACE_MS
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    "SELECT pg_advisory_xact_lock(hashtext('extraction_jobs_slot'))"
                )
                # Dentro del lock, para que el COUNT de abajo vea el efecto.
                huerfanos = await conn.fetch(
                    "UPDATE ops.extraction_jobs SET status = 'failed', completed_at = now(), "
                    "error = 'Slot huérfano recuperado: el job quedó en running sin proceso "
                    "detrás (instancia caída o reciclada). Ver JobStore.try_claim_slot.' "
                    "WHERE status = 'running' "
                    "  AND started_at < now() - ($1::bigint * interval '1 millisecond') "
                    "RETURNING job_id",
                    umbral_ms,
                )
                if huerfanos:
                    logger.warning(
                        "Recuperados %d slot(s) huérfanos (running > %dms sin proceso): %s",
                        len(huerfanos), umbral_ms,
                        ", ".join(str(r["job_id"]) for r in huerfanos),
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
