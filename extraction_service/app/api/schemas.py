from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, model_validator


class ExtractionRequest(BaseModel):
    """
    Request body para disparar una extracción.

    Diseñado para consumo desde un data pipeline: el cliente SIEMPRE pasa
    fechas explícitas en formato ISO `YYYY-MM-DD`. Sin defaults, sin atajos
    relativos, sin formatos alternativos. Esto elimina por construcción los
    422 ambiguos que surgían cuando había múltiples caminos de validación.
    """

    client_name: str = Field(
        ...,
        min_length=1,
        description="Nombre del cliente para la extracción (ej: 'walmart').",
    )
    date_from: date = Field(
        ...,
        description="Fecha desde, ISO YYYY-MM-DD (inclusive).",
    )
    date_to: date = Field(
        ...,
        description="Fecha hasta, ISO YYYY-MM-DD (inclusive).",
    )
    timeout_ms: int = Field(
        90_000,
        ge=1_000,
        description="Timeout por operación de Playwright, en milisegundos.",
    )

    @model_validator(mode="after")
    def _check_range(self) -> "ExtractionRequest":
        if self.date_from > self.date_to:
            raise ValueError("'date_from' no puede ser posterior a 'date_to'.")
        return self


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobResult(BaseModel):
    """Resultado final de una corrida exitosa."""

    local_path: str = Field(..., description="Ruta local del archivo descargado.")
    gcs_uri: Optional[str] = Field(
        None,
        description=(
            "URI GCS del archivo subido. Puede ser None si la subida falló "
            "pero el archivo local existe — el pipeline puede reintentar."
        ),
    )
    source: str = Field(..., description="Nombre del TMS de origen (ej: 'qanalytics').")
    product: str = Field(..., description="Producto de datos (ej: 'monitor-trips').")
    client_name: str
    extracted_at: date = Field(
        ...,
        description=(
            "Fecha en que se ejecutó la extracción (no confundir con el rango "
            "de los datos). Particiona los artefactos en el datalake."
        ),
    )
    date_from: date
    date_to: date


class Job(BaseModel):
    """Representación pública de un job de extracción."""

    job_id: str
    source_name: str
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    request: ExtractionRequest
    result: Optional[JobResult] = None
    error: Optional[str] = None
