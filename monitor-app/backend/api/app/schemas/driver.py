"""Pydantic schemas para public.drivers (H2.2 — routers/drivers.py)."""
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

OperationalStatus = Literal["ACTIVE", "INACTIVE"]


class DriverCreateBody(BaseModel):
    tax_id: str
    country_code: str = "CL"
    full_name: str
    operational_status: OperationalStatus = "ACTIVE"

    @field_validator("full_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    # Sólo limpieza de bordes. La CANONIZACIÓN (quitar puntos, validar dígito
    # verificador, dejarlo en NNNNNNNN-D) NO vive acá a propósito: la hace
    # `public.canonical_rut()` en routers/drivers.py, que es la misma función
    # que usa el CHECK `drivers_tax_id_is_canonical` de la tabla. Reescribirla
    # en Python daría dos definiciones de la misma regla, y se separan el día
    # que alguien toca una sola.
    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class DriverPatchBody(BaseModel):
    full_name: Optional[str] = None
    operational_status: Optional[OperationalStatus] = None

    @field_validator("full_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v
