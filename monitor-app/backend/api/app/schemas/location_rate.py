"""Pydantic schemas para public.location_rates — historial de tarifas por
local (Fase 5, Tarifario 1.0). `tarifa` es texto libre a propósito: la
tarifa real depende de contexto de viaje (tipo de carga, condiciones
negociadas) que este proyecto no modela — imponerle una estructura
numérica sería falsa precisión (decisión explícita del usuario, ver
docs/superpowers/specs/2026-07-22-tarifario-design.md)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, Field


class LocationRateCreateBody(BaseModel):
    tarifa: str
    valid_from: date = Field(default_factory=date.today)
    valid_to: Optional[date] = None


class LocationRatePatchBody(BaseModel):
    tarifa: Optional[str] = None
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None

    def sent_fields(self) -> list[str]:
        return [f for f in type(self).model_fields if getattr(self, f) is not None]
