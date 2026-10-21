"""Pydantic schemas para driver_assignments/asset_assignments/carrier_shippers
(H2.2). "Alta" = INSERT status=ACTIVE (desactiva la asignación previa del
mismo driver/asset en otra empresa, mismo criterio que los loaders de Mage
corregidos en Checkpoint M.5). "Baja" no tiene body — es un PATCH a INACTIVE."""
from datetime import date

from pydantic import BaseModel


class DriverAssignmentCreateBody(BaseModel):
    driver_id: str
    carrier_id: str
    # D2: día efectivo; por defecto, hoy en Chile. La base rechaza un día cerrado.
    effective_date: date | None = None


class AssetAssignmentCreateBody(BaseModel):
    asset_id: str
    carrier_id: str
    effective_date: date | None = None


class CarrierShipperCreateBody(BaseModel):
    carrier_id: str
    shipper_id: str


class CarrierShipperLinkBody(BaseModel):
    shipper_id: str
    effective_date: date | None = None
