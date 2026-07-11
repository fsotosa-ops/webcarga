from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

InstallmentStatus = Literal['pagada', 'pendiente', 'vencida']
PolicyType = Literal['rc_vehicular', 'rc_eett', 'carga', 'otro']


class InstallmentPatchBody(BaseModel):
    status:               Optional[InstallmentStatus] = None
    paid_at:              Optional[date] = None
    payment_url:          Optional[str] = None
    expected_updated_at:  Optional[datetime] = None


class PolicyPatchBody(BaseModel):
    payment_url: Optional[str] = None
    file_url:    Optional[str] = None
    policy_type: Optional[PolicyType] = None


class InsuranceDocumentPatchBody(BaseModel):
    status:          Optional[Literal['ok', 'pendiente', 'actualizar', 'n_a', 'factible']] = None
    expiry_date:     Optional[date] = None
    file_url:        Optional[str] = None
    notes:           Optional[str] = None
    manual_override: Optional[bool] = None


class RevertInstallmentBody(BaseModel):
    expected_updated_at: Optional[datetime] = None
