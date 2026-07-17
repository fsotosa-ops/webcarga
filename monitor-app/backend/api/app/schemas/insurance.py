"""Pydantic schemas para el módulo de Seguros (public.insurance_* — H2.3,
routers/policies.py). Reemplaza el schemas/insurance.py de Checkpoint A-E
(columnas planas coverage/plate, sin M:N)."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

PolicyStatus = Literal["ACTIVE", "EXPIRED", "CANCELLED"]
PaymentStatus = Literal["PENDING", "PAID", "OVERDUE"]


class InsurancePolicyCreateBody(BaseModel):
    carrier_id: str
    insurance_company: str
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    expiration_alert_days: int = 30


class InsurancePolicyPatchBody(BaseModel):
    insurance_company: Optional[str] = None
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    status: Optional[PolicyStatus] = None
    expiration_alert_days: Optional[int] = None
    external_portal_url: Optional[str] = None
    expected_updated_at: Optional[datetime] = None


class PolicyCoverageLinkBody(BaseModel):
    coverage_type_id: str


class PolicyAssetLinkBody(BaseModel):
    asset_id: str


class InstallmentPatchBody(BaseModel):
    payment_status: Optional[PaymentStatus] = None
    paid_at: Optional[datetime] = None


class InsuranceOverviewFacets(BaseModel):
    """Conteos por worst_policy_health sobre el universo filtrado por `q`
    (sin aplicar el filtro `health` activo) — alimenta los tabs de la
    landing de Seguros sin que cambiar de tab reordene los otros conteos."""
    expired: int
    expiring_soon: int
    valid: int
    cancelled: int
    no_policy: int
    total: int


class CarrierInsuranceOverviewResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int
    facets: InsuranceOverviewFacets
