import asyncio
import logging

from fastapi import APIRouter, HTTPException

from app.api.schemas import ExtractionRequest, Job, JobResult
from app.core.config import settings
from app.jobs.store import job_store
from app.tms.base import hive_path
from app.tms.factory import get_tms_extractor
from app.utils.gcs_client import upload_file_to_gcs

logger = logging.getLogger(__name__)
router = APIRouter()


async def _run_job(job_id: str, source_name: str, request: ExtractionRequest) -> None:
    """
    Worker que corre la extracción y mantiene el job_store al día.

    Vive como una tarea de asyncio independiente del request HTTP que la
    creó — usamos `asyncio.create_task` (no `BackgroundTasks`) porque las
    extracciones tardan minutos y no queremos que el ciclo de vida del
    response las afecte.
    """
    await job_store.mark_running(job_id)
    try:
        extractor = get_tms_extractor(source_name)
        artifact = await extractor.extract(
            client_name=request.client_name,
            date_from=request.date_from,
            date_to=request.date_to,
            timeout_ms=request.timeout_ms,
        )

        # Subida a GCS best-effort: si falla, dejamos gcs_uri=None pero el
        # job queda DONE con local_path válido. El pipeline puede reintentar
        # la subida o leer del filesystem si conoce el path.
        #
        # IMPORTANTE: el blob_name se arma con el MISMO `hive_path` que usó
        # el scraper para el archivo local — misma fuente de verdad, así el
        # path de GCS y el local son trazables uno con el otro.
        gcs_uri = None
        try:
            blob_name = hive_path(
                source=artifact.source,
                client=artifact.client_name,
                extracted_at=artifact.extracted_at,
                date_from=artifact.date_from,
                date_to=artifact.date_to,
            )
            gcs_uri = upload_file_to_gcs(
                local_file_path=artifact.local_path,
                bucket_name=settings.GCS_BUCKET_NAME,
                destination_blob_name=blob_name,
            )
        except Exception as gcs_err:
            logger.error(f"[job {job_id}] Falló subida a GCS: {gcs_err}")

        await job_store.mark_done(
            job_id,
            JobResult(
                local_path=artifact.local_path,
                gcs_uri=gcs_uri,
                source=artifact.source,
                client_name=artifact.client_name,
                extracted_at=artifact.extracted_at,
                date_from=artifact.date_from,
                date_to=artifact.date_to,
            ),
        )
    except Exception as e:
        logger.exception(f"[job {job_id}] Falló la extracción")
        await job_store.mark_failed(job_id, str(e))


@router.post("/extract/{source_name}", status_code=202, response_model=Job)
async def trigger_extraction(source_name: str, request: ExtractionRequest) -> Job:
    # Validar que el source exista antes de crear el job, así un cliente que
    # se equivoca de nombre recibe 400 inmediatamente en vez de un job FAILED.
    get_tms_extractor(source_name)
    job = await job_store.create(source_name, request)
    asyncio.create_task(_run_job(job.job_id, source_name, request))
    return job


@router.get("/extract/jobs/{job_id}", response_model=Job)
async def get_job(job_id: str) -> Job:
    job = await job_store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} no encontrado.")
    return job


@router.get("/health")
def health_check():
    return {"status": "ok"}
