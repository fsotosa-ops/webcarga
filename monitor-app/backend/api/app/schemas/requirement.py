"""Pydantic schemas para el catálogo de requisitos y su recálculo
(app/routers/requirements.py). Ver app/services/requirement_conditions.py
para la regla de aplicabilidad que estos endpoints exponen."""
from typing import Optional

from pydantic import BaseModel, field_validator, model_validator

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
    módulo (D#, ver Ronda de arreglo 1).

    `is_active` es la excepción a propósito: la columna es NOT NULL, así que
    ahí `null` explícito no es "sacar la restricción" — no significa nada, y
    se rechaza con 422 en vez de dejar que reviente como 500 en la base
    (Ronda de arreglo 2)."""
    is_active: Optional[bool] = None
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None

    # mode="after", no "before": para cuando estos corren, Pydantic ya
    # validó cada elemento contra su tipo declarado (list[str] /
    # list[ManagementType]) y devolvió un 422 legible si no matcheaba. Con
    # "before" reciben la lista cruda sin tipar — `normalize_nonempty_list`
    # crasheaba con `TypeError` (500, no 422) ante una lista de tipos
    # mixtos, porque `sorted()` no sabe comparar `int` con `str` (Ronda de
    # arreglo 2, hallazgo real).
    @field_validator("applies_to_management_types", mode="after")
    @classmethod
    def _normalize_management(cls, v):
        return normalize_management_types(v)

    @field_validator("applies_to_fleet_service_type_ids", mode="after")
    @classmethod
    def _normalize_fleet_service_types(cls, v):
        # No tiene CHECK de cardinalidad en la base: un [] silencioso se
        # guardaría tal cual y dejaría la regla sin matchear ningún asset.
        return normalize_nonempty_list(v)

    @model_validator(mode="after")
    def _is_active_rejects_explicit_null(self):
        # Mismo mecanismo que permite [] -> NULL en los otros dos campos
        # (model_fields_set, no "value is None") aplicado al caso donde NULL
        # es un valor inexistente para la columna, no una instrucción válida.
        # Sin esto, `{"is_active": null}` llega a
        # `SET is_active = $2` con None y explota como not_null_violation
        # (500) en vez de un 422 legible.
        if "is_active" in self.model_fields_set and self.is_active is None:
            raise ValueError(
                "is_active no admite null explícito: la columna no permite NULL"
            )
        return self

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
