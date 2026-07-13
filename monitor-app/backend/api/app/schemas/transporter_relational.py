"""Pydantic request bodies para app/routers/transporters.py (backend relacional
— TRANSPORTERS_BACKEND=relational). Los modelos jsonb legacy siguen en
app/schemas/transporter.py, usados por app/routers/transporters_legacy.py.

Nota de diseño: las respuestas (GET) se devuelven como dict ensamblado a mano
(mismo patrón que trips.py / transporters_legacy.py) en vez de response_model
estricto — el contrato a preservar mezcla campos jsonb legacy (contactability)
con relacional nuevo y varía por sub-recurso (drivers/vehicles/documents).
"""
import re
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator

ComplianceStatus = Literal['ok', 'pendiente', 'actualizar', 'n_a', 'factible']
VehicleKind = Literal['tracto', 'rampla', 'camion', 'furgon', 'otro']


def split_rut(raw: str) -> tuple[str, Optional[str]]:
    """'12.345.678-9' -> ('12345678', '9'). Sin guión -> (cuerpo, None)."""
    cleaned = re.sub(r"[.\s]", "", raw or "").upper()
    if "-" in cleaned:
        body, dv = cleaned.rsplit("-", 1)
        return body, dv or None
    return cleaned, None


class ContactabilityBody(BaseModel):
    emails: list[str] = []
    phones: list[str] = []


class TransporterPatchBody(BaseModel):
    business_name:       Optional[str] = None
    rut:                 Optional[str] = None
    account_stage:       Optional[str] = None
    contactability:      Optional[ContactabilityBody] = None
    expected_updated_at: Optional[datetime] = None

    @field_validator("business_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    def sent_top_level_fields(self) -> list[str]:
        touched = []
        if self.business_name is not None:
            touched.append("business_name")
        if self.rut is not None:
            touched.append("rut")
        if self.account_stage is not None:
            touched.append("account_stage")
        if self.contactability is not None:
            touched.append("contactability")
        return touched


class ContactPatchBody(BaseModel):
    role:  Literal['rep_legal', 'operacional', 'finanzas', 'documentos']
    name:  Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None


# ── Drivers ──────────────────────────────────────────────────────────────────

class DriverGovernancePatch(BaseModel):
    id_expiry:          Optional[date] = None
    license_expiry:     Optional[date] = None
    anexo_3_gc:         Optional[ComplianceStatus] = None
    epp:                Optional[ComplianceStatus] = None
    das_odi:            Optional[ComplianceStatus] = None
    hoja_de_vida:       Optional[ComplianceStatus] = None
    cert_antecedentes:  Optional[ComplianceStatus] = None
    validado_gc_driver: Optional[ComplianceStatus] = None
    contrato_trabajo:   Optional[ComplianceStatus] = None
    creacion_gc_driver: Optional[ComplianceStatus] = None


class AddDriverBody(BaseModel):
    rut:  str
    name: str


class PatchDriverBody(BaseModel):
    rut:        Optional[str] = None
    name:       Optional[str] = None
    governance: Optional[DriverGovernancePatch] = None


class TransferBody(BaseModel):
    to_transporter_id: str


# ── Vehicles / Trailers ────────────────────────────────────────────────────

class VehicleGovernancePatch(BaseModel):
    year:                   Optional[int] = None
    circ_permit_expiry:     Optional[date] = None
    tech_inspection_expiry: Optional[date] = None
    gas_emissions_expiry:   Optional[date] = None
    soap_insurance_expiry:  Optional[date] = None
    padron:                 Optional[ComplianceStatus] = None
    poliza_rc:              Optional[ComplianceStatus] = None
    gps:                    Optional[ComplianceStatus] = None
    seguro_carga:           Optional[ComplianceStatus] = None
    mantencion_camara_frio: Optional[ComplianceStatus] = None
    creacion_gc_vehicle:    Optional[ComplianceStatus] = None


class AddVehicleBody(BaseModel):
    plate:      str
    kind:       VehicleKind = 'tracto'
    type_label: Optional[str] = None


class PatchVehicleBody(BaseModel):
    plate:      Optional[str] = None
    type_label: Optional[str] = None
    governance: Optional[VehicleGovernancePatch] = None


class AddTrailerBody(BaseModel):
    plate:      str
    type_label: Optional[str] = None


# ── Documentos ───────────────────────────────────────────────────────────────

class DocumentPatchBody(BaseModel):
    status:          Optional[ComplianceStatus] = None
    expiry_date:      Optional[date] = None
    file_url:         Optional[str] = None
    notes:            Optional[str] = None
    manual_override:  Optional[bool] = None


class PaginatedResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int


# ── Alta/baja manual (transporter/driver/vehicle) ─────────────────────────────

class BajaBody(BaseModel):
    reason: Literal['documentacion_vencida', 'termino_mutuo_acuerdo', 'termino_penalizacion', 'otro']
    notes: Optional[str] = None
