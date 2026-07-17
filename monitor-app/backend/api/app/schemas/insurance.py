"""Pydantic schemas para el módulo de Seguros (public.insurance_* — H2.3,
routers/policies.py). Reemplaza el schemas/insurance.py de Checkpoint A-E
(columnas planas coverage/plate, sin M:N)."""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

PolicyStatus = Literal["ACTIVE", "EXPIRED", "CANCELLED"]
PaymentStatus = Literal["PENDING", "PAID", "OVERDUE"]


class InsurancePolicyCreateBody(BaseModel):
    carrier_id: str
    insurance_company: str
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    expiration_alert_days: int = 30
    has_endorsement: bool = False
    endorsement_number: Optional[str] = None


class InsurancePolicyPatchBody(BaseModel):
    insurance_company: Optional[str] = None
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    status: Optional[PolicyStatus] = None
    expiration_alert_days: Optional[int] = None
    has_endorsement: Optional[bool] = None
    endorsement_number: Optional[str] = None
    external_portal_url: Optional[str] = None
    expected_updated_at: Optional[datetime] = None


class PolicyCoverageLinkBody(BaseModel):
    coverage_type_id: str


class PolicyAssetLinkBody(BaseModel):
    asset_id: str


class InstallmentPatchBody(BaseModel):
    payment_status: Optional[PaymentStatus] = None
    paid_at: Optional[datetime] = None


class InstallmentScheduleGenerateBody(BaseModel):
    """Genera el plan de cuotas completo de una póliza de una sola vez
    (mensual, monto fijo por cuota) — no hay endpoint para crear cuotas
    sueltas: total_installments es un valor denormalizado por fila
    (ver public.insurance_installments), generarlas todas juntas evita
    que quede inconsistente entre filas."""
    total_installments: int = Field(ge=1, le=60)
    amount_uf: float = Field(gt=0)
    first_due_date: date


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
