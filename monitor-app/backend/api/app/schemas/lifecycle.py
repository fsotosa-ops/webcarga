"""Los cuerpos de las acciones del ciclo de vida (services/lifecycle.py)."""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .carrier import _clean_tax_id_value


class LifecycleReasonBody(BaseModel):
    """Dar de baja o reactivar: el motivo (app.status_taxonomies) y, con «Otro», el comentario."""
    model_config = ConfigDict(extra="forbid")

    reason_id: str
    note: Optional[str] = Field(default=None, max_length=500)


class CarrierReactivateBody(LifecycleReasonBody):
    """P3: al reactivar una empresa se elige qué conductores y equipos vuelven con ella."""
    driver_ids: list[str] = []
    asset_ids: list[str] = []


class CarrierActivateBody(BaseModel):
    """Activar una empresa nueva (ONBOARDING): completa su alta, no pide motivo. Si
    todavía no tiene RUT, se manda aquí."""
    model_config = ConfigDict(extra="forbid")

    tax_id: Optional[str] = None

    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return _clean_tax_id_value(v)
