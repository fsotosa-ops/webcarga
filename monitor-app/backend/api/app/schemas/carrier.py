"""Pydantic schemas para public.carriers (H2.2 — routers/carriers.py).
Reemplaza schemas/transporter_relational.py: internacionalizado (tax_id +
country_code en vez de rut/dv), sin los sub-recursos jsonb legacy."""
from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, field_validator, model_validator

# Verificado contra datos reales (2026-07-16): public.carriers.operational_status
# no tiene CHECK constraint, y los valores en uso hoy son 'ACTIVE' (38) y
# 'LEGACY_INACTIVE' (208 — carriers heredados del sistema viejo, nunca
# migrados a cuenta operativa real). 'INACTIVE' se agrega para la baja
# manual de una empresa que sí llegó a estar ACTIVE (distinto de "nunca
# migrada") — todavía no hay datos reales con ese valor.
# 'ONBOARDING' (Tarea 2, plan Cierre del Día 4.1): empresa recién creada sin
# RUT todavía, no operativa, no entra en cierres — distinta de 'INACTIVE'
# (fue ACTIVE y se dio de baja) y de 'LEGACY_INACTIVE' (dato heredado nunca
# migrado).
OperationalStatus = Literal["ACTIVE", "INACTIVE", "LEGACY_INACTIVE", "ONBOARDING"]

# Única fuente de verdad para "empresa activa" en filtros que deben excluir
# inactivas/legacy/onboarding (ej. Certificación, bug 5.4) — evita duplicar
# el literal 'ACTIVE' como texto SQL en múltiples routers.
ACTIVE_OPERATIONAL_STATUS: OperationalStatus = "ACTIVE"

# Tipo de gestión DECLARADO en el alta (D7/D9). Códigos propios, no las
# etiquetas de app.status_taxonomies: ésas se renombraron dos veces en dos días
# (20260803060000, 20260804000000) y una FK textual se habría roto en silencio.
#
# Es un CONJUNTO, no un escalar con un tercer valor 'AMBAS': marcar los dos ES
# el caso mixto. 'AMBAS' obligaría a que toda consulta futura recuerde
# IN ('TRACTOREO','AMBAS') y olvidarlo deja afuera a la empresa mixta sin dar
# error. Espeja la columna public.carriers.management_types (20260815160000).
ManagementType = Literal["TRACTOREO", "EQUIPO_COMPLETO"]

# Orden canónico de escritura: el CHECK de la base acepta cualquier orden, así
# que sin normalizar dos filas equivalentes no son iguales por `=`.
_MANAGEMENT_TYPE_ORDER = ["TRACTOREO", "EQUIPO_COMPLETO"]


def _normalize_management_types(v):
    """Ordena y quita duplicados; el arreglo vacío se vuelve None.

    NULL y [] no pueden significar los dos "no declarado" — la base rechaza el
    vacío justamente para que exista una sola representación."""
    if not isinstance(v, list):
        return v
    if not v:
        return None
    vistos = [t for t in _MANAGEMENT_TYPE_ORDER if t in v]
    # Lo que no esté en el orden canónico se deja pasar tal cual para que lo
    # rechace el Literal con un error legible, en vez de desaparecer acá.
    desconocidos = [t for t in v if t not in _MANAGEMENT_TYPE_ORDER]
    return vistos + desconocidos


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
    transacción (H2.2)."""
    tax_id: Optional[str] = None
    country_code: str = "CL"
    business_name: str
    operational_status: Optional[OperationalStatus] = None
    management_types: Optional[list[ManagementType]] = None

    @field_validator("management_types", mode="before")
    @classmethod
    def _normalize_management(cls, v):
        return _normalize_management_types(v)

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

    @model_validator(mode="after")
    def _default_status_from_tax_id(self):
        if self.operational_status is None:
            self.operational_status = "ACTIVE" if self.tax_id is not None else "ONBOARDING"
        elif self.operational_status == "ACTIVE" and self.tax_id is None:
            raise ValueError("No se puede crear una empresa ACTIVA sin RUT/tax_id — use ONBOARDING")
        return self


class CarrierPatchBody(BaseModel):
    business_name: Optional[str] = None
    operational_status: Optional[OperationalStatus] = None
    tax_id: Optional[str] = None
    management_types: Optional[list[ManagementType]] = None
    expected_updated_at: Optional[datetime] = None  # optimistic lock, mismo patrón que transporter_relational

    @field_validator("management_types", mode="before")
    @classmethod
    def _normalize_management(cls, v):
        return _normalize_management_types(v)

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
        if self.operational_status is not None:
            touched.append("operational_status")
        if self.tax_id is not None:
            touched.append("tax_id")
        if self.management_types is not None:
            touched.append("management_types")
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
