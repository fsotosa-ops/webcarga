"""Pydantic schemas para app.equipment_day_status/equipment_closures
(Fase 4, HU-03 — cierre por tracto/equipo, no por conductor)."""
from typing import Optional

from pydantic import BaseModel, field_validator


class EquipmentDayStatusPatchBody(BaseModel):
    """Captura el motivo de no asignación para UN equipo (paridad con
    DriverDayStatusPatchBody de daily_closures.py — pedido explícito del
    usuario 2026-08-04: "Flota del día" necesita la misma funcionalidad de
    edición fila-por-fila para Equipo Completo que ya tiene Tractoreo)."""
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



class EquipmentBatchReasonBody(BaseModel):
    """BLOQUE 1 de HU-03: selección masiva con checkbox — un solo motivo
    para varios tractos en un clic."""
    asset_ids: list[str]
    unassigned_reason_id: str
    comentario: Optional[str] = None

    @field_validator("asset_ids")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("asset_ids no puede estar vacío")
        return v


class CloseEquipmentDayBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None
