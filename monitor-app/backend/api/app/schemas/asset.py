"""Pydantic schemas para public.assets (H2.2 — routers/assets.py). Sin
tax_id/country_code — un vehículo/rampla no tributa, se identifica por
patente (ver migración init_compliance_engine)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

OperationalStatus = Literal["ACTIVE", "INACTIVE"]
# Los dos tipos que existen de verdad. CAMION, FURGON y OTRO eran
# placeholders del commit 5955c5f (Empresas/Seguros), ANTERIORES a la taxonomía
# real de vehículos (migraciones 20260802–20260804): nunca describieron el
# negocio y cero de los 118 vehículos los usa. Se retiran antes de poner el
# CHECK en la base — al revés, elegir "Camión" en un selector todavía vivo
# habría dado un 500 en vez de un 422.
AssetType = Literal["TRACTOCAMION", "RAMPLA"]


class AssetCreateBody(BaseModel):
    """Alta de vehículo.

    `fleet_service_type_id` (subtipo físico) y `webcarga_operation_type_id`
    (tipo de gestión) son **conceptos hermanos, no lo mismo**: la migración
    20260803050000 los separó a propósito — 37 tractocamiones tienen gestión
    "Equipo Completo" aunque el vehículo en sí sea un tracto. Se declaran por
    separado y ninguno se deduce del otro.

    Hasta el Tramo 2 salían sólo de la ingesta de Mage, así que un vehículo
    creado en la app nacía sin clasificar. Declararlos acá es seguro porque la
    ingesta respeta `is_manual_override` — verificado contra producción."""
    license_plate: str
    asset_type: AssetType
    operational_status: OperationalStatus = "ACTIVE"
    manufacture_year: Optional[int] = Field(default=None, ge=1950, le=2100)
    fleet_service_type_id: Optional[str] = None
    webcarga_operation_type_id: Optional[str] = None

    def declara_clasificacion(self) -> bool:
        """Si una persona clasificó el vehículo, hay algo que proteger de la
        ingesta. Si no, el flag NO se marca: marcarlo siempre dejaría a Mage
        sin poder clasificar los vehículos que nadie clasificó."""
        return bool(self.fleet_service_type_id or self.webcarga_operation_type_id)

    @field_validator("license_plate", mode="before")
    @classmethod
    def _upper_plate(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class AssetPatchBody(BaseModel):
    asset_type: Optional[AssetType] = None
    operational_status: Optional[OperationalStatus] = None
    manufacture_year: Optional[int] = Field(default=None, ge=1950, le=2100)
    fleet_service_type_id: Optional[str] = None
    webcarga_operation_type_id: Optional[str] = None
