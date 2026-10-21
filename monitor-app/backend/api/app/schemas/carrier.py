"""Pydantic schemas para public.carriers (H2.2 — routers/carriers.py).
Reemplaza schemas/transporter_relational.py: internacionalizado (tax_id +
country_code en vez de rut/dv), sin los sub-recursos jsonb legacy."""
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from ..authz.permissions import Permission

from .common import ManagementType, normalize_management_types
from .states import CARRIER_STATUSES_IN_CERTIFICATION, CarrierLifecycle, ComplianceSummary

# Los valores viven en el glosario (D1, app/schemas/states.py). 'ONBOARDING' es la
# etapa del alta: toda empresa nueva nace ahí y se le arma la carpeta (no recibe
# viajes, no entra en cierres; se activa al cumplir los obligatorios, 21/10); 'INACTIVE', la
# dada de baja, venga de donde venga: las ~200 heredadas del padrón viejo eran un
# cuarto valor (LEGACY_INACTIVE) y desde el 21/10 son INACTIVE con el motivo
# LEGACY_IMPORT (migración 20261028090000).
OperationalStatus = CarrierLifecycle

# Única fuente de verdad para "empresa activa" en filtros que deben excluir
# inactivas/legacy/onboarding (ej. Certificación, bug 5.4) — evita duplicar
# el literal 'ACTIVE' como texto SQL en múltiples routers.
ACTIVE_OPERATIONAL_STATUS: OperationalStatus = "ACTIVE"

# Los estados que el embudo considera "en juego": las empresas en certificación
# (glosario). ONBOARDING es la que está entrando: pertenece a su pestaña, no al
# catálogo del fondo. Vive aquí y no en el router: el reconocedor de
# documentos (services/matcher_io.py) también la usa, y un servicio no importa de
# un router (era un ciclo latente que la Entrega D destapó).
FUNNEL_ACTIVE_STATUSES = CARRIER_STATUSES_IN_CERTIFICATION

# ManagementType, su orden canónico y su normalización viven en
# app/schemas/common.py — public.compliance_requirements comparte el mismo
# dominio (applies_to_management_types) y no hay razón para tener el Literal
# ni la función de normalización duplicados en dos schemas.


def _clean_tax_id_value(v):
    """Normaliza tax_id: recorta espacios y pasa a mayúsculas; un string
    vacío o solo espacios se normaliza a None en vez de quedar como ''."""
    if not isinstance(v, str):
        return v
    cleaned = v.strip().upper()
    return cleaned or None


class CarrierCreateBody(BaseModel):
    """Onboarding manual de UNA empresa nueva (POST /carriers) — distinto del
    bulk-load de Mage desde el Excel EETT. Ver context_carriers.md §4.1: el
    endpoint debe además sembrar compliance_records MISSING en la misma
    transacción (H2.2).

    Toda empresa nueva nace En onboarding, tenga o no RUT (21/10): se le arma la
    carpeta y se activa con "Activar" cuando cumple lo mismo que la habilitación
    (services/lifecycle.py). El estado no se elige al crear."""
    model_config = ConfigDict(extra="forbid")

    tax_id: Optional[str] = None
    country_code: str = "CL"
    business_name: str
    management_types: Optional[list[ManagementType]] = None

    @field_validator("management_types", mode="after")
    @classmethod
    def _normalize_management(cls, v):
        return normalize_management_types(v)

    @field_validator("business_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return _clean_tax_id_value(v)

    @field_validator("country_code", mode="before")
    @classmethod
    def _upper_country(cls, v):
        return v.strip().upper() if isinstance(v, str) else v

    @property
    def initial_status(self) -> OperationalStatus:
        return "ONBOARDING"


class CarrierPatchBody(BaseModel):
    """Los datos de la empresa. El estado no se edita aquí: cambia con una acción
    (activate / deactivate / reactivate), que pide su permiso y su motivo."""
    model_config = ConfigDict(extra="forbid")

    business_name: Optional[str] = None
    tax_id: Optional[str] = None
    management_types: Optional[list[ManagementType]] = None
    expected_updated_at: Optional[datetime] = None  # optimistic lock, mismo patrón que transporter_relational

    @field_validator("management_types", mode="after")
    @classmethod
    def _normalize_management(cls, v):
        return normalize_management_types(v)

    @field_validator("business_name", mode="before")
    @classmethod
    def _normalize_name(cls, v):
        return v.strip().title() if isinstance(v, str) and v else v

    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return _clean_tax_id_value(v)

    def sent_fields(self) -> list[str]:
        touched = []
        if self.business_name is not None:
            touched.append("business_name")
        if self.tax_id is not None:
            touched.append("tax_id")
        if self.management_types is not None:
            touched.append("management_types")
        return touched


# Permiso por campo del PATCH (bloque 0 del Directorio, 0.3). El estado no está:
# sus permisos van por acción en schemas/states.LIFECYCLE_TRANSITIONS.
CARRIER_FIELD_PERMISSIONS: dict[str, Permission] = {
    "business_name": Permission.DIRECTORY_EDIT,
    "tax_id": Permission.DIRECTORY_EDIT,
    "management_types": Permission.DIRECTORY_EDIT,
    "expected_updated_at": Permission.DIRECTORY_EDIT,
}


class CarrierListFacets(BaseModel):
    """Conteos de habilitación sobre el universo filtrado por `q` +
    `operational_status` (sin aplicar el filtro `enablement` activo) — alimenta
    las pestañas del Directorio sin que cambiar de pestaña reordene los otros
    conteos. `enabled`/`not_enabled`: habilitación calculada (D1, R-B14); una
    empresa no activa no cuenta en ninguna."""
    enabled: int
    not_enabled: int
    total: int


class CarrierListItem(BaseModel):
    """Una fila del Directorio. `compliance_summary` es la respuesta única
    (D1): cuánto debe la empresa, propio y de su flota, y si puede operar."""
    id: UUID | str
    tax_id: Optional[str] = None
    country_code: Optional[str] = None
    business_name: str
    operational_status: CarrierLifecycle
    total_requirements: int
    last_document_update: Optional[datetime] = None
    compliance_summary: ComplianceSummary


class CarrierListResponse(BaseModel):
    data: list[CarrierListItem]
    count: int
    page: int
    limit: int
    facets: CarrierListFacets
