"""Pydantic schemas para app.equipment_day_status/equipment_closures
(Fase 4, HU-03 — cierre por tracto/equipo, no por conductor)."""
from typing import Optional

from pydantic import BaseModel, field_validator


class EquipmentBatchReasonBody(BaseModel):
    """BLOQUE 1 de HU-03: selección masiva con checkbox — un solo motivo
    para varios tractos en un clic."""
    asset_ids: list[str]
    unassigned_reason_id: str

    @field_validator("asset_ids")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("asset_ids no puede estar vacío")
        return v


class CloseEquipmentDayBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None
