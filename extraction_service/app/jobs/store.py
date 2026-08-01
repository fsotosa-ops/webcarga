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
