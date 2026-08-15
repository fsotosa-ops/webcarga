"""Pydantic schemas para el catálogo de requisitos y su recálculo
(app/routers/requirements.py). Ver app/services/requirement_conditions.py
para la regla de aplicabilidad que estos endpoints exponen."""
from typing import Optional

from pydantic import BaseModel, field_validator

from .common import ManagementType, normalize_management_types, normalize_nonempty_list


class RequirementConditionsPatchBody(BaseModel):
    """Todo opcional: se puede tocar la vigencia sin tocar las condiciones.

    `[]` es una forma legítima de decir "sin restricción" (vuelve la
    condición a NULL) — no una omisión. Por eso `sent_fields()` NO mira si el
    valor final quedó en `None`: usa `model_fields_set`, que registra qué
    claves llegaron en el body, independientemente de en qué se normalicen.
    Con eso "no lo mandaron" (ausente del body) y "lo mandaron vacío"
    (normalizado a NULL) dejan de compartir la misma representación — la
    trampa de null-con-dos-significados que ya apareció dos veces en este
    módulo (D#, ver Ronda de arreglo 1)."""
    is_active: Optional[bool] = None
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None

    @field_validator("applies_to_management_types", mode="before")
    @classmethod
    def _normalize_management(cls, v):
        return normalize_management_types(v)

    @field_validator("applies_to_fleet_service_type_ids", mode="before")
    @classmethod
    def _normalize_fleet_service_types(cls, v):
        # No tiene CHECK de cardinalidad en la base: un [] silencioso se
        # guardaría tal cual y dejaría la regla sin matchear ningún asset.
        return normalize_nonempty_list(v)

    def sent_fields(self) -> list[str]:
        fields = (
            "is_active", "applies_to_fleet_service_type_ids", "applies_to_management_types",
        )
        return [f for f in fields if f in self.model_fields_set]


class RecalcPreview(BaseModel):
    crear: int
    quitar: int
    bloqueados: int


class RecalcResult(BaseModel):
    creados: int
    quitados: int
    bloqueados: int
