"""Pydantic schemas para public.locations (H2.6, fase "catálogo de
locales"). entity_type solo soporta 'SHIPPER' por ahora — enum abierto,
mismo criterio que public.contacts (que hoy solo usa CARRIER/DRIVER/ASSET
porque son los únicos casos reales, no porque estén hardcodeados a 3)."""
from datetime import time
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

LocationEntityType = Literal["SHIPPER"]
OperationType = Literal["RM", "Z0", "Region Norte", "Region Sur"]
LocationOperationalStatus = Literal["ACTIVE", "INACTIVE"]


class LocationCreateBody(BaseModel):
    entity_type: LocationEntityType
    entity_id: str
    name: str
    country_code: str = "CL"
    site_number: Optional[str] = None
    format: Optional[str] = None
    address: Optional[str] = None
    region_name: Optional[str] = None
    region_number: Optional[int] = None
    opens_at: Optional[time] = None
    closes_at: Optional[time] = None
    operation_type: Optional[OperationType] = None

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("country_code", mode="before")
    @classmethod
    def _upper_country(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class LocationPatchBody(BaseModel):
    name: Optional[str] = None
    country_code: Optional[str] = None
    site_number: Optional[str] = None
    format: Optional[str] = None
    address: Optional[str] = None
    region_name: Optional[str] = None
    region_number: Optional[int] = None
    opens_at: Optional[time] = None
    closes_at: Optional[time] = None
    operation_type: Optional[OperationType] = None
    operational_status: Optional[LocationOperationalStatus] = None

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, v):
        return v.strip() if isinstance(v, str) else v

    def sent_fields(self) -> list[str]:
        return [f for f in type(self).model_fields if getattr(self, f) is not None]
