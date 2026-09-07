"""Pydantic schemas para app.driver_day_status/daily_closures (Fase 1 del
plan de refinamiento del backlog de 17 HU, 2026-07-21 — ver AGENTLOG.md)."""
from typing import Optional

from pydantic import BaseModel, field_validator


class DriverDayStatusPatchBody(BaseModel):
    """Captura el motivo de no asignación (HU-02) y su comentario — los únicos
    campos editables a mano de app.driver_day_status, el resto se recalcula."""
    unassigned_reason_id: str
    comentario: Optional[str] = None
    """El comentario de texto libre, opcional.

    El motivo dice la categoria —"Panne"— y no dice el caso: cual panne, desde
    cuando, que se hizo. Pedido del usuario (07/09): quien cierra el dia tiene
    que poder escribirlo con sus palabras.

    Un texto en blanco y un comentario ausente son lo mismo, y los dos se
    guardan como NULL: dos maneras de decir "no escribio nada" es la clase de
    ambiguedad que despues nadie sabe leer.
    """

    @field_validator("comentario")
    @classmethod
    def vacio_es_nulo(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        limpio = v.strip()
        return limpio or None



class DriverBatchReasonBody(BaseModel):
    """BLOQUE 1 de HU-03 (conductor): selección masiva con checkbox — un
    solo motivo para varios conductores en un clic (Tarea 7, plan 2.4;
    mismo patrón que EquipmentBatchReasonBody en schemas/equipment_closures.py)."""
    driver_ids: list[str]
    unassigned_reason_id: str
    comentario: Optional[str] = None

    @field_validator("driver_ids")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("driver_ids no puede estar vacío")
        return v


class CloseDayBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None
