"""Pydantic schemas para public.carriers (H2.2 — routers/carriers.py).
Reemplaza schemas/transporter_relational.py: internacionalizado (tax_id +
country_code en vez de rut/dv), sin los sub-recursos jsonb legacy."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

# Verificado contra datos reales (2026-07-16): public.carriers.operational_status
# no tiene CHECK constraint, y los valores en uso hoy son 'ACTIVE' (38) y
# 'LEGACY_INACTIVE' (208 — carriers heredados del sistema viejo, nunca
# migrados a cuenta operativa real). 'INACTIVE' se agrega para la baja
# manual de una empresa que sí llegó a estar ACTIVE (distinto de "nunca
# migrada") — todavía no hay datos reales con ese valor.
OperationalStatus = Literal["ACTIVE", "INACTIVE", "LEGACY_INACTIVE"]


class CarrierCreateBody(BaseModel):
    """Onboarding manual de UNA empresa nueva (POST /carriers) — distinto del
    bulk-load de Mage desde el Excel EETT. Ver context_carriers.md §4.1: el
    endpoint debe además sembrar compliance_records MISSING en la misma
    transacción (H2.2)."""
    tax_id: str
    country_code: str = "CL"
    business_name: str
    operational_status: OperationalStatus = "ACTIVE"

    @field_validator("business_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return v.strip().upper() if isinstance(v, str) else v

    @field_validator("country_code", mode="before")
    @classmethod
    def _upper_country(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class CarrierPatchBody(BaseModel):
    business_name: Optional[str] = None
    operational_status: Optional[OperationalStatus] = None
    expected_updated_at: Optional[datetime] = None  # optimistic lock, mismo patrón que transporter_relational

    @field_validator("business_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    def sent_fields(self) -> list[str]:
        touched = []
        if self.business_name is not None:
            touched.append("business_name")
        if self.operational_status is not None:
            touched.append("operational_status")
        return touched


class CarrierListFacets(BaseModel):
    """Conteos por compliance_health sobre el universo filtrado por `q` +
    `operational_status` (sin aplicar el filtro `health` activo) — alimenta
    los tabs de alertas del listado de Empresas sin que cambiar de tab
    reordene los otros conteos."""
    pending: int
    ok: int
    total: int


class CarrierListResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int
    facets: CarrierListFacets
