"""Pydantic schemas para public.assets (H2.2 — routers/assets.py). Sin
tax_id/country_code — un vehículo/rampla no tributa, se identifica por
patente (ver migración init_compliance_engine)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

OperationalStatus = Literal["ACTIVE", "INACTIVE"]
AssetType = Literal["TRACTOCAMION", "RAMPLA", "CAMION", "FURGON", "OTRO"]


class AssetCreateBody(BaseModel):
    license_plate: str
    asset_type: AssetType
    operational_status: OperationalStatus = "ACTIVE"
    manufacture_year: Optional[int] = Field(default=None, ge=1950, le=2100)

    @field_validator("license_plate", mode="before")
    @classmethod
    def _upper_plate(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class AssetPatchBody(BaseModel):
    asset_type: Optional[AssetType] = None
    operational_status: Optional[OperationalStatus] = None
    manufacture_year: Optional[int] = Field(default=None, ge=1950, le=2100)
