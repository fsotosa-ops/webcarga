"""Pydantic schemas para app.driver_day_status/daily_closures (Fase 1 del
plan de refinamiento del backlog de 17 HU, 2026-07-21 — ver AGENTLOG.md)."""
from typing import Optional

from pydantic import BaseModel, field_validator


class DriverDayStatusPatchBody(BaseModel):
    """Captura el motivo de no asignación (HU-02) — único campo editable a
    mano de app.driver_day_status, el resto se recalcula."""
    unassigned_reason_id: str


class DriverBatchReasonBody(BaseModel):
    """BLOQUE 1 de HU-03 (conductor): selección masiva con checkbox — un
    solo motivo para varios conductores en un clic (Tarea 7, plan 2.4;
    mismo patrón que EquipmentBatchReasonBody en schemas/equipment_closures.py)."""
    driver_ids: list[str]
    unassigned_reason_id: str

    @field_validator("driver_ids")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("driver_ids no puede estar vacío")
        return v


class CloseDayBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None
