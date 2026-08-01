import asyncio
import logging
import os

from fastapi import APIRouter, Depends, HTTPException

from app.api.schemas import ExtractionRequest, Job, JobRequest, JobResult
from app.core.config import settings
from app.db import get_pool
from app.jobs.store import JobStore
from app.tms.base import build_path
from app.tms.factory import get_adapter, list_sources
from app.utils.gcs_client import upload_file_to_gcs

logger = logging.getLogger(__name__)
router = APIRouter()


# Respuestas de error reutilizadas en la doc OpenAPI — mantienen un solo
# lugar de verdad para los shapes de error que expone el API.
ERROR_400 = {
    "description": "Combinación `(source, product)` no soportada. Consultar `GET /sources`.",
}
ERROR_404 = {"description": "Job no encontrado."}
ERROR_422 = {"description": "Body inválido: campos faltantes, fechas mal formadas o `date_from > date_to`."}


async def _run_job(
    job_id: str, source: str, product: str, request: ExtractionRequest, store: JobStore
) -> None:
    """
    Worker que corre la extracción y mantiene ops.extraction_jobs al día.

    Vive como una tarea de asyncio independiente del request HTTP que la
    creó — usamos `asyncio.create_task` (no `BackgroundTasks`) porque las
    extracciones tardan minutos y no queremos que el ciclo de vida del
    response las afecte.

    FIX 2026-07-31: el `asyncio.Semaphore` per-instancia se reemplaza por
    `try_claim_slot` (global, coordinado por Postgres) — con maxScale>1 el
    semáforo no evitaba que 2 instancias corrieran cada una "su propio 1"
    en paralelo sin saberlo. Un job que no consigue slot en QUEUE_TIMEOUT_MS
    falla con un error explícito de CONTENCIÓN, distinguible de un timeout
    real del scraper (JOB_TIMEOUT_MS, envuelve solo extractor.extract()).
    """
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
        # Hard timeout por job: si el scraper se cuelga, el job muere
        # FAILED y el slot se libera (deja de contar como 'running'). Sin
        # esto, un job zombie bloquea el slot hasta que Cloud Run recicle
        # la instancia.
        artifact = await asyncio.wait_for(
            extractor.extract(
                client_name=request.client_name,
                date_from=request.date_from,
                date_to=request.date_to,
                timeout_ms=request.timeout_ms,
            ),
            timeout=settings.JOB_TIMEOUT_MS / 1000,
        )

        # Subida a GCS best-effort: si falla, dejamos gcs_uri=None pero el
        # job queda DONE con local_path válido. El pipeline puede reintentar
        # la subida o leer del filesystem si conoce el path.
        #
        # IMPORTANTE: el blob_name se arma con el MISMO `build_path` que usó
        # el scraper para el archivo local — misma fuente de verdad, así el
        # path de GCS y el local son trazables uno con el otro.
        gcs_uri = None
        try:
            # Respetamos la extensión real del artifact — cada TMS produce un
            # formato distinto (qanalytics=.xls, wingsuite=.csv).
            ext = os.path.splitext(artifact.local_path)[1] or ".bin"
            blob_name = build_path(
                source=artifact.source,
                product=artifact.product,
                client=artifact.client_name,
                timestamp=artifact.timestamp,
                date_from=artifact.date_from,
                date_to=artifact.date_to,
                extension=ext,
            )
            gcs_uri = upload_file_to_gcs(
                local_file_path=artifact.local_path,
                bucket_name=settings.GCS_BUCKET_NAME,
                destination_blob_name=blob_name,
            )
        except Exception as gcs_err:
            logger.error(f"[job {job_id}] Falló subida a GCS: {gcs_err}")

        await store.mark_done(
            job_id,
            JobResult(
                local_path=artifact.local_path,
                gcs_uri=gcs_uri,
                source=artifact.source,
                product=artifact.product,
                client_name=artifact.client_name,
                timestamp=artifact.timestamp,
                date_from=artifact.date_from,
                date_to=artifact.date_to,
            ),
        )
    except asyncio.TimeoutError:
        logger.error(
            f"[job {job_id}] Timeout ({settings.JOB_TIMEOUT_MS}ms) — "
            "el scraper no terminó a tiempo."
        )
        await store.mark_failed(
            job_id, f"Job timeout after {settings.JOB_TIMEOUT_MS}ms"
        )
    except Exception as e:
        logger.exception(f"[job {job_id}] Falló la extracción")
        await store.mark_failed(job_id, str(e))


@router.post(
    "/jobs",
    status_code=202,
    response_model=Job,
    tags=["Jobs"],
    summary="Disparar una extracción",
    response_description="Job creado en estado `queued`. El worker arranca de inmediato en background.",
    responses={400: ERROR_400, 422: ERROR_422},
)
async def create_job(job_request: JobRequest, pool=Depends(get_pool)) -> Job:
    """
    Crea un job que extrae `product` desde `source` para el `client_name`
    y rango `[date_from, date_to]` indicados.

    La respuesta es inmediata (202) con un `job_id` para hacer poll en
    `GET /jobs/{job_id}`. La combinación `(source, product)` se valida
    antes de encolar — si no existe, se devuelve 400 al instante en vez
    de crear un job que fallaría minutos después.
    """
    get_adapter(job_request.source, job_request.product)

    store = JobStore(pool)
    request = ExtractionRequest(
        client_name=job_request.client_name,
        date_from=job_request.date_from,
        date_to=job_request.date_to,
        timeout_ms=job_request.timeout_ms,
    )
    job = await store.create(
        source=job_request.source,
        product=job_request.product,
        request=request,
    )
    asyncio.create_task(
        _run_job(job.job_id, job_request.source, job_request.product, request, store)
    )
    return job


@router.get(
    "/jobs/{job_id}",
    response_model=Job,
    tags=["Jobs"],
    summary="Consultar el estado de un job",
    response_description="Estado actual del job y, si terminó exitosamente, el resultado.",
    responses={404: ERROR_404},
)
async def get_job(job_id: str, pool=Depends(get_pool)) -> Job:
    """Devuelve el job completo. Típicamente usado en polling hasta que
    `status` entra en un estado terminal (`done` o `failed`). Funciona
    igual sin importar qué instancia de Cloud Run atienda la request —
    el estado vive en ops.extraction_jobs (Postgres), no en memoria."""
    store = JobStore(pool)
    job = await store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} no encontrado.")
    return job


@router.get(
    "/sources",
    tags=["Catalog"],
    summary="Listar TMS y productos soportados",
    response_description="Catálogo de combinaciones `(source, product)` válidas para `POST /jobs`.",
)
def get_sources():
    """Catálogo actualizado de TMS y productos que expone el servicio.
    Úselo antes de llamar `POST /jobs` para validar combinaciones."""
    return {"sources": list_sources()}


@router.get(
    "/health",
    tags=["Ops"],
    summary="Health check",
    response_description="Estado del servicio y versión.",
)
async def health_check():
    """Health check liviano — usado por Cloud Run para readiness. No
    consulta ops.extraction_jobs (Cloud Run lo pollea seguido, no vale la
    pena una query por chequeo) — para ver jobs en curso usar
    GET /jobs/{job_id} o consultar la tabla directo."""
    return {
        "status": "ok",
        "version": settings.API_VERSION,
    }
