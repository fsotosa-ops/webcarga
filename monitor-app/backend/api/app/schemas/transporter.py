import re
from datetime import date
from typing import Literal, Optional
from pydantic import BaseModel, field_validator

ComplianceStatus = Literal['ok', 'pendiente', 'actualizar', 'n_a']


class DriverGovernance(BaseModel):
    id_expiry:          Optional[date] = None
    license_expiry:     Optional[date] = None
    anexo_3_walmart:    Optional[ComplianceStatus] = None
    epp:                Optional[ComplianceStatus] = None
    das_odi:            Optional[ComplianceStatus] = None
    hoja_de_vida:       Optional[ComplianceStatus] = None
    cert_antecedentes:  Optional[ComplianceStatus] = None
    validado_walmart:   Optional[ComplianceStatus] = None
    contrato_trabajo:   Optional[ComplianceStatus] = None
    creacion_walmart:   Optional[ComplianceStatus] = None
    avance_total:       Optional[float] = None


class VehicleGovernance(BaseModel):
    year:                   Optional[int] = None
    circ_permit_expiry:     Optional[date] = None
    tech_inspection_expiry: Optional[date] = None
    gas_emissions_expiry:   Optional[date] = None
    soap_insurance_expiry:  Optional[date] = None
    poliza_rc:              Optional[ComplianceStatus] = None
    gps:                    Optional[ComplianceStatus] = None
    seguro_carga:           Optional[ComplianceStatus] = None
    mantencion_camara_frio: Optional[ComplianceStatus] = None
    creacion_walmart:       Optional[ComplianceStatus] = None


class CompanyGovernance(BaseModel):
    rol_sii:            Optional[ComplianceStatus] = None
    copia_ci_rep_legal: Optional[ComplianceStatus] = None
    anexo_2_walmart:    Optional[ComplianceStatus] = None
    contrato_webcarga:  Optional[ComplianceStatus] = None
    f30_multas:         Optional[ComplianceStatus] = None
    f43:                Optional[ComplianceStatus] = None
    politica_seguridad: Optional[ComplianceStatus] = None
    cert_mutual:        Optional[ComplianceStatus] = None
    riohs_timbrado:     Optional[ComplianceStatus] = None
    creacion_walmart:   Optional[ComplianceStatus] = None
    carpeta_tributaria: Optional[ComplianceStatus] = None
    cuenta_empresa:     Optional[ComplianceStatus] = None
    avance_8020:        Optional[float] = None
    avance_total:       Optional[float] = None


class Driver(BaseModel):
    id: str
    rut: str
    name: str
    governance: Optional[DriverGovernance] = None


class Vehicle(BaseModel):
    id: str
    type: str
    plate: str
    governance: Optional[VehicleGovernance] = None


class Trailer(BaseModel):
    id: str
    plate: str


class Contactability(BaseModel):
    emails: list[str] = []
    phones: list[str] = []


class TransporterOut(BaseModel):
    id: str
    business_name:          Optional[str] = None
    rut:                    Optional[str] = None
    account_stage:          Optional[str] = None
    contactability:         Optional[Contactability] = None
    drivers:                list[Driver] = []
    vehicles:               list[Vehicle] = []
    trailers:               list[Trailer] = []
    company_governance:     Optional[CompanyGovernance] = None
    manually_edited_fields: list[str] = []
    edited_at:              Optional[str] = None
    updated_at:             Optional[str] = None


class TransporterListItem(BaseModel):
    id: str
    business_name:      Optional[str] = None
    rut:                Optional[str] = None
    account_stage:      Optional[str] = None
    driver_count:       int = 0
    vehicle_count:      int = 0
    trailer_count:      int = 0
    has_manual_edits:   bool = False
    has_active_alerts:  bool = False


class TransporterPatch(BaseModel):
    business_name:      Optional[str] = None
    rut:                Optional[str] = None
    account_stage:      Optional[str] = None
    contactability:     Optional[Contactability] = None
    drivers:            Optional[list[Driver]] = None
    vehicles:           Optional[list[Vehicle]] = None
    trailers:           Optional[list[Trailer]] = None
    company_governance: Optional[CompanyGovernance] = None

    @field_validator("rut", mode="before")
    @classmethod
    def normalize_rut(cls, v: Optional[str]) -> Optional[str]:
        if not v:
            return v
        v = re.sub(r"[.\s]", "", v).upper()
        if "-" not in v and len(v) > 1:
            v = v[:-1] + "-" + v[-1]
        return v

    @field_validator("business_name", mode="before")
    @classmethod
    def normalize_name(cls, v: Optional[str]) -> Optional[str]:
        return v.strip().title() if v else v

    def sent_fields(self) -> list[str]:
        return [k for k, val in self.model_dump().items() if val is not None]


class AddDriverReq(BaseModel):
    rut: str
    name: str


class PatchDriverReq(BaseModel):
    rut:        Optional[str] = None
    name:       Optional[str] = None
    governance: Optional[DriverGovernance] = None


class AddVehicleReq(BaseModel):
    type: str
    plate: str


class PatchVehicleReq(BaseModel):
    type:       Optional[str] = None
    plate:      Optional[str] = None
    governance: Optional[VehicleGovernance] = None


class AddTrailerReq(BaseModel):
    plate: str


class ComplianceAlertSummary(BaseModel):
    driver_ruts:         dict[str, str]
    plates:              dict[str, str]
    total_expired:       int
    total_expiring_soon: int


class PaginatedResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int
