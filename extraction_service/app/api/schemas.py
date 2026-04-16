from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ExtractionRequest(BaseModel):
    """Parámetros de la corrida — independientes del TMS y del producto.

    Queda almacenado en `Job.request`. En `POST /jobs` llega envuelto en
    `JobRequest` (que suma `source` y `product`).
    """

    client_name: str = Field(
        ...,
        min_length=1,
        description="Identificador del cliente en el TMS (login, mandante o tenant según el adapter).",
        examples=["walmart"],
    )
    date_from: Optional[date] = Field(
        None,
        description=(
            "Inicio del rango de datos (inclusive). Fecha de los datos, no de la corrida. "
            "Opcional: TMS sin filtro de rango (ej. sodimac) lo aceptan en `null`; "
            "wingsuite/qanalytics lo requieren y rechazan la corrida si falta."
        ),
        examples=["2026-04-01"],
    )
    date_to: Optional[date] = Field(
        None,
        description=(
            "Fin del rango de datos (inclusive). Debe ser ≥ `date_from` si ambos están presentes. "
            "Opcional: ver nota en `date_from`."
        ),
        examples=["2026-04-14"],
    )
    timeout_ms: int = Field(
        90_000,
        ge=1_000,
        description="Timeout por operación Playwright, en ms. Subir a `180000+` para rangos grandes o TMS lentos.",
        examples=[180000],
    )

    @field_validator("client_name", mode="before")
    @classmethod
    def _normalize_client_name(cls, v):
        # Normaliza a minúsculas + trim. Afecta filename, GCS blob y el
        # valor pasado al TMS — mantenemos un solo casing canónico para
        # evitar fragmentación del datalake (`WALMART_...` vs `walmart_...`).
        if isinstance(v, str):
            return v.strip().lower()
        return v

    @model_validator(mode="after")
    def _check_range(self) -> "ExtractionRequest":
        # Solo validamos el orden cuando ambos están presentes. Si uno solo
        # viene `None` es un input inválido para cualquier TMS con filtro de
        # fecha — ese error se levanta en el adapter con mensaje explícito.
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError("'date_from' no puede ser posterior a 'date_to'.")
        return self


class JobRequest(ExtractionRequest):
    """Body de `POST /jobs`. Extiende `ExtractionRequest` con las dos
    dimensiones que identifican qué se extrae y de dónde."""

    source: str = Field(
        ...,
        min_length=1,
        description="TMS del cual extraer. Ver `GET /sources` para la lista vigente.",
        examples=["wingsuite"],
    )
    product: str = Field(
        ...,
        min_length=1,
        description="Producto de datos canónico (vocabulario del servicio, no del proveedor).",
        examples=["trips"],
    )

    @field_validator("source", "product", mode="before")
    @classmethod
    def _normalize_source_product(cls, v):
        if isinstance(v, str):
            return v.strip().lower()
        return v

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "source": "wingsuite",
                "product": "trips",
                "client_name": "demo",
                "date_from": "2026-04-01",
                "date_to": "2026-04-14",
                "timeout_ms": 180000,
            }
        }
    )


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class JobResult(BaseModel):
    """Artefacto producido por una corrida exitosa."""

    local_path: str = Field(
        ...,
        description="Ruta del archivo en el contenedor. Efímero en Cloud Run; la fuente de verdad es `gcs_uri`.",
    )
    gcs_uri: Optional[str] = Field(
        None,
        description="URI del blob en GCS. `null` si la subida falló (el pipeline puede reintentar desde `local_path`).",
    )
    source: str = Field(..., description="TMS de origen (espejo del input).")
    product: str = Field(..., description="Producto extraído (espejo del input).")
    client_name: str = Field(..., description="Cliente solicitado (espejo del input).")
    timestamp: int = Field(
        ...,
        description="Unix epoch del arranque de la corrida. Sufijo del filename, identifica esta ejecución.",
    )
    date_from: Optional[date] = Field(
        None, description="Inicio del rango extraído (espejo del input). `null` si el TMS no soporta filtro de fecha."
    )
    date_to: Optional[date] = Field(
        None, description="Fin del rango extraído (espejo del input). `null` si el TMS no soporta filtro de fecha."
    )


class Job(BaseModel):
    """Representación pública de un job. Devuelto por `POST /jobs` y
    `GET /jobs/{job_id}` en cualquier estado."""

    job_id: str = Field(..., description="UUID asignado al crear el job. Usar con `GET /jobs/{job_id}`.")
    source: str = Field(..., description="TMS que ejecuta el job.")
    product: str = Field(..., description="Producto de datos solicitado.")
    status: JobStatus = Field(
        ...,
        description="`queued` → `running` → (`done` | `failed`).",
    )
    created_at: datetime = Field(..., description="Timestamp UTC de creación.")
    updated_at: datetime = Field(..., description="Timestamp UTC del último cambio de estado.")
    request: ExtractionRequest = Field(..., description="Parámetros originales del job.")
    result: Optional[JobResult] = Field(
        None,
        description="Poblado solo cuando `status=done`. `null` en los demás estados.",
    )
    error: Optional[str] = Field(
        None,
        description="Mensaje de error. Poblado solo cuando `status=failed`.",
    )
