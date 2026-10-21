"""Pydantic schemas para public.assets (H2.2 — routers/assets.py). Sin
tax_id/country_code — un vehículo/rampla no tributa, se identifica por
patente (ver migración init_compliance_engine)."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..authz.permissions import Permission

# El código de public.asset_types (Entrega C, 14/10). La lista vive en la base,
# no acá: un tipo desconocido lo rechaza la FK y la API responde 422.
AssetType = str


class AssetCreateBody(BaseModel):
    """Alta de vehículo.

    `fleet_service_type_id` (subtipo físico) y `webcarga_operation_type_id`
    (tipo de gestión) son **conceptos hermanos, no lo mismo**: la migración
    20260803050000 los separó a propósito — 37 tractocamiones tienen gestión
    "Equipo Completo" aunque el vehículo en sí sea un tracto. Se declaran por
    separado y ninguno se deduce del otro.

    Hasta el Tramo 2 salían sólo de la ingesta de Mage, así que un vehículo
    creado en la app nacía sin clasificar. Declararlos acá es seguro porque la
    ingesta respeta `is_manual_override` — verificado contra producción.

    Un equipo nace activo; la baja es una acción con motivo (services/lifecycle.py)."""
    model_config = ConfigDict(extra="forbid")

    license_plate: str
    asset_type: AssetType
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
    """Los datos del equipo. El estado cambia con deactivate / reactivate."""
    model_config = ConfigDict(extra="forbid")

    asset_type: Optional[AssetType] = None
    manufacture_year: Optional[int] = Field(default=None, ge=1950, le=2100)
    fleet_service_type_id: Optional[str] = None
    webcarga_operation_type_id: Optional[str] = None


# Permiso por campo del PATCH (mismo patrón que DRIVER_FIELD_PERMISSIONS):
# dar de baja o reactivar va por acción (schemas/states.LIFECYCLE_TRANSITIONS).
ASSET_FIELD_PERMISSIONS: dict[str, Permission] = {
    "asset_type": Permission.DIRECTORY_EDIT,
    "manufacture_year": Permission.DIRECTORY_EDIT,
    "fleet_service_type_id": Permission.DIRECTORY_EDIT,
    "webcarga_operation_type_id": Permission.DIRECTORY_EDIT,
}
