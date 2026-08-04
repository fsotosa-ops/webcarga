"""Pydantic schemas para public.compliance_records (H2.2/H2.4 —
routers/compliance.py). Status y valores tomados del CHECK constraint real
de la tabla (init_compliance_engine.sql)."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

ComplianceStatus = Literal[
    "MISSING", "PENDING_REVIEW", "APPROVED_MANUAL", "APPROVED",
    "REJECTED", "EXPIRED", "ARCHIVED",
]


class ComplianceRecordPatchBody(BaseModel):
    """Override manual de un compliance_record (ej. un admin aprueba a mano
    sin subir archivo). El upload de archivo real usa un endpoint separado
    (H2.4) que fuerza status='APPROVED_MANUAL', no este PATCH libre."""
    status: Optional[ComplianceStatus] = None
    expiration_date: Optional[date] = None


class PendingComplianceRow(BaseModel):
    """Módulo Documentos (sábana) — un compliance_record pendiente por fila,
    con la empresa/sujeto ya resueltos. Ver GET /compliance-records/pending."""
    id: str
    carrier_id: str
    carrier_name: str
    carrier_tax_id: str
    carrier_operation_types: list[str]
    certification_type: Literal["BASICA", "ADICIONAL"]
    category: Literal["EMPRESA", "CHOFER", "EQUIPO"]
    entity_type: str
    entity_id: str
    subject_name: Optional[str] = None
    requirement_code: str
    document_name: str
    status: ComplianceStatus
    expiration_date: Optional[date] = None


class PendingComplianceListResponse(BaseModel):
    total: int
    rows: list[PendingComplianceRow]
