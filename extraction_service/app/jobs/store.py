"""
JobStore in-memory para extracciones disparadas vía API.

V1: un solo proceso uvicorn, dict en memoria, asyncio.Lock para coordinar.
Si el proceso reinicia, los jobs en cola se pierden — aceptable para el caso
actual de un orquestador externo que reintenta. Migrar a Redis/DB cuando se
necesite multi-worker o persistencia entre deploys.
"""

import asyncio
import uuid
from datetime import datetime, timezone
from typing import Optional

from app.api.schemas import ExtractionRequest, Job, JobResult, JobStatus


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = asyncio.Lock()

    async def create(
        self,
        *,
        source: str,
        product: str,
        request: ExtractionRequest,
    ) -> Job:
        async with self._lock:
            now = datetime.now(timezone.utc)
            job = Job(
                job_id=str(uuid.uuid4()),
                source=source,
                product=product,
                status=JobStatus.QUEUED,
                created_at=now,
                updated_at=now,
                request=request,
            )
            self._jobs[job.job_id] = job
            return job

    async def get(self, job_id: str) -> Optional[Job]:
        async with self._lock:
            return self._jobs.get(job_id)

    async def mark_running(self, job_id: str) -> None:
        await self._patch(job_id, status=JobStatus.RUNNING)

    async def mark_done(self, job_id: str, result: JobResult) -> None:
        await self._patch(job_id, status=JobStatus.DONE, result=result)

    async def mark_failed(self, job_id: str, error: str) -> None:
        await self._patch(job_id, status=JobStatus.FAILED, error=error)

    async def _patch(self, job_id: str, **fields) -> None:
        async with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            updated = job.model_copy(
                update={**fields, "updated_at": datetime.now(timezone.utc)}
            )
            self._jobs[job_id] = updated


# Singleton compartido por el proceso uvicorn.
job_store = JobStore()
