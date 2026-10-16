"""Pydantic schemas para el módulo de Seguros (public.insurance_* — H2.3,
routers/policies.py). Reemplaza el schemas/insurance.py de Checkpoint A-E
(columnas planas coverage/plate, sin M:N)."""
from datetime import date, datetime
from typing import Literal, Optional

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field



class InsurancePolicyCreateBody(BaseModel):
    # Un campo retirado (el plazo de aviso por póliza) se rechaza, no se descarta en silencio.
    model_config = ConfigDict(extra="forbid")

    carrier_id: str
    insurance_company: str
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    has_endorsement: bool = False
    endorsement_number: Optional[str] = None


class InsurancePolicyPatchBody(BaseModel):
    # Los campos retirados (el estado y el plazo de aviso) se rechazan; cancelar es POST /cancel.
    model_config = ConfigDict(extra="forbid")

    insurance_company: Optional[str] = None
    policy_number: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    has_endorsement: Optional[bool] = None
    endorsement_number: Optional[str] = None
    external_portal_url: Optional[str] = None
    expected_updated_at: Optional[datetime] = None


class PolicyCoverageLinkBody(BaseModel):
    coverage_type_id: str


class PolicyAssetLinkBody(BaseModel):
    asset_id: str


class InstallmentsPayBody(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=500)
    paid_on: date


class InstallmentsUnpayBody(BaseModel):
    ids: list[UUID] = Field(min_length=1, max_length=500)


class PolicyCancelBody(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class PolicyRenewBody(BaseModel):
    valid_from: date
    valid_to: date
    policy_number: Optional[str] = None
    insurance_company: Optional[str] = None


class PolicyRenewedByBody(BaseModel):
    successor_id: str


class PolicyExtendBody(BaseModel):
    valid_to: date
    endorsement_number: Optional[str] = None
    endorsement_date: Optional[date] = None


class InstallmentsAppendBody(BaseModel):
    count: int = Field(ge=1, le=60)
    amount_uf: float = Field(gt=0)
    first_due_date: date
