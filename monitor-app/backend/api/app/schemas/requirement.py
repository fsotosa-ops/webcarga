"""Pydantic schemas para el catálogo de requisitos y su recálculo
(app/routers/requirements.py). Ver app/services/requirement_conditions.py
para la regla de aplicabilidad que estos endpoints exponen."""
from typing import Literal, Optional

from pydantic import BaseModel

ManagementType = Literal["TRACTOREO", "EQUIPO_COMPLETO"]


class RequirementConditionsPatchBody(BaseModel):
    """Todo opcional: se puede tocar la vigencia sin tocar las condiciones."""
    is_active: Optional[bool] = None
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None

    def sent_fields(self) -> list[str]:
        return [f for f in (
            "is_active", "applies_to_fleet_service_type_ids", "applies_to_management_types",
        ) if getattr(self, f) is not None]


class RecalcPreview(BaseModel):
    crear: int
    quitar: int
    bloqueados: int


class RecalcResult(BaseModel):
    creados: int
    quitados: int
    bloqueados: int
