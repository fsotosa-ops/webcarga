"""Los cuerpos de las acciones del ciclo de vida (services/lifecycle.py)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .carrier import _clean_tax_id_value


class LifecycleReasonBody(BaseModel):
    """Dar de baja o reactivar: el motivo (app.status_taxonomies) y, con «Otro», el comentario."""
    model_config = ConfigDict(extra="forbid")

    reason_id: str
    note: Optional[str] = Field(default=None, max_length=500)
    #: Desde qué día rige (plan 2026-10-28). Sin fecha: el primer día no firmado.
    effective_date: Optional[date] = None


class CarrierReactivateBody(LifecycleReasonBody):
    """P3: al reactivar una empresa se elige qué conductores y equipos vuelven con ella."""
    driver_ids: list[str] = []
    asset_ids: list[str] = []


class CarrierActivateBody(BaseModel):
    """Activar una empresa en onboarding (Certificación): sale cuando cumple lo mismo
    que la habilitación, sin motivo. Si todavía no tiene RUT, se manda aquí. Sin
    cumplirlo, solo como excepción provisoria: `reason_id` (ACTIVATION_EXCEPTION_REASON)
    y `exception_until` (schemas/states.LIFECYCLE_TRANSITIONS)."""
    model_config = ConfigDict(extra="forbid")

    tax_id: Optional[str] = None
    reason_id: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=500)
    #: Desde qué día rige; sin fecha, desde mañana (28/10).
    effective_date: Optional[date] = None
    #: Solo en una excepción: hasta qué día la carpeta tiene que quedar completa.
    exception_until: Optional[date] = None

    @field_validator("tax_id", mode="before")
    @classmethod
    def _clean_tax_id(cls, v):
        return _clean_tax_id_value(v)
