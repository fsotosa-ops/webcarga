"""Pydantic schemas para app.driver_day_status/daily_closures (Fase 1 del
plan de refinamiento del backlog de 17 HU, 2026-07-21 — ver AGENTLOG.md)."""
from typing import Optional

from pydantic import BaseModel


class DriverDayStatusPatchBody(BaseModel):
    """Captura el motivo de no asignación (HU-02) — único campo editable a
    mano de app.driver_day_status, el resto se recalcula."""
    unassigned_reason_id: str


class CloseDayBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None
