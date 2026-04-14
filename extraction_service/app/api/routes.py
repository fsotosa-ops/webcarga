import asyncio
import logging
import os

from fastapi import APIRouter, HTTPException

from app.api.schemas import ExtractionRequest, Job, JobRequest, JobResult
from app.core.config import settings
from app.jobs.store import job_store
from app.tms.base import build_path
from app.tms.factory import get_adapter, get_tms_extractor, list_sources
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
    job_id: str, source: str, product: str, request: ExtractionRequest
) -> None:
    """
    Worker que corre la extracción y mantiene el job_store al día.

    Vive como una tarea de asyncio independiente del request HTTP que la
    creó — usamos `asyncio.create_task` (no `BackgroundTasks`) porque las
    extracciones tardan minutos y no queremos que el ciclo de vida del
    response las afecte.
    """
    await job_store.mark_running(job_id)
    try:
        extractor = get_adapter(source, product)
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

        await job_store.mark_done(
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
    except Exception as e:
        logger.exception(f"[job {job_id}] Falló la extracción")
        await job_store.mark_failed(job_id, str(e))


# ──────────────────────────────────────────────────────────────────────────────
# API unificada — jobs como recurso de primera clase.
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/jobs",
    status_code=202,
    response_model=Job,
    tags=["Jobs"],
    summary="Disparar una extracción",
    response_description="Job creado en estado `queued`. El worker arranca de inmediato en background.",
    responses={400: ERROR_400, 422: ERROR_422},
)
async def create_job(job_request: JobRequest) -> Job:
    """
    Crea un job que extrae `product` desde `source` para el `client_name`
    y rango `[date_from, date_to]` indicados.

    La respuesta es inmediata (202) con un `job_id` para hacer poll en
    `GET /jobs/{job_id}`. La combinación `(source, product)` se valida
    antes de encolar — si no existe, se devuelve 400 al instante en vez
    de crear un job que fallaría minutos después.
    """
    get_adapter(job_request.source, job_request.product)

    request = ExtractionRequest(
        client_name=job_request.client_name,
        date_from=job_request.date_from,
        date_to=job_request.date_to,
        timeout_ms=job_request.timeout_ms,
    )
    job = await job_store.create(
        source=job_request.source,
        product=job_request.product,
        request=request,
    )
    asyncio.create_task(
        _run_job(job.job_id, job_request.source, job_request.product, request)
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
async def get_job(job_id: str) -> Job:
    """Devuelve el job completo. Típicamente usado en polling hasta que
    `status` entra en un estado terminal (`done` o `failed`)."""
    job = await job_store.get(job_id)
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
    response_description="Estado del servicio, versión y jobs en memoria.",
)
async def health_check():
    """Health check liviano — usado por Cloud Run para readiness y por
    dashboards operacionales."""
    return {
        "status": "ok",
        "version": settings.API_VERSION,
        "jobs_in_memory": len(job_store._jobs),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints legacy — mantenidos como alias deprecados para no romper
# pipelines que aún apuntan al contrato viejo. Eliminar cuando todos los
# consumidores migren a `/jobs` y `/sources`.
# ──────────────────────────────────────────────────────────────────────────────


@router.post(
    "/extract/{source_name}",
    status_code=202,
    response_model=Job,
    deprecated=True,
    tags=["Legacy"],
    summary="[DEPRECATED] Disparar extracción",
    response_description="Job creado. Alias a `POST /jobs`.",
)
async def trigger_extraction_legacy(
    source_name: str, request: ExtractionRequest
) -> Job:
    """**Deprecado** — migrar a `POST /jobs` con `{source, product}` en el body.

    Infere `product` desde el único producto que expone el TMS. Se vuelve
    ambiguo cuando un TMS soporte múltiples productos; eliminar cuando los
    consumidores terminen de migrar.
    """
    extractor = get_tms_extractor(source_name)
    logger.warning(
        f"[deprecated] POST /extract/{source_name} — migrar a POST /jobs "
        f"con {{'source': '{source_name}', 'product': '{extractor.PRODUCT_NAME}', ...}}"
    )
    job = await job_store.create(
        source=source_name,
        product=extractor.PRODUCT_NAME,
        request=request,
    )
    asyncio.create_task(
        _run_job(job.job_id, source_name, extractor.PRODUCT_NAME, request)
    )
    return job


@router.get(
    "/extract/jobs/{job_id}",
    response_model=Job,
    deprecated=True,
    tags=["Legacy"],
    summary="[DEPRECATED] Consultar job",
    response_description="Alias a `GET /jobs/{job_id}`.",
)
async def get_job_legacy(job_id: str) -> Job:
    """**Deprecado** — migrar a `GET /jobs/{job_id}`."""
    return await get_job(job_id)


@router.get(
    "/extract/sources",
    deprecated=True,
    tags=["Legacy"],
    summary="[DEPRECATED] Listar sources",
    response_description="Alias a `GET /sources`.",
)
def list_sources_legacy():
    """**Deprecado** — migrar a `GET /sources`."""
    return get_sources()
