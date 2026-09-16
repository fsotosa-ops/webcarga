"""Pydantic schemas para app.equipment_day_status/equipment_closures
(Fase 4, HU-03 — cierre por tracto/equipo, no por conductor)."""
from datetime import date
from typing import Optional

from pydantic import BaseModel, field_validator


class EquipmentDayStatusPatchBody(BaseModel):
    """Captura el motivo de no asignación para UN equipo (paridad con
    DriverDayStatusPatchBody de daily_closures.py — pedido explícito del
    usuario 2026-08-04: "Flota del día" necesita la misma funcionalidad de
    edición fila-por-fila para Equipo Completo que ya tiene Tractoreo)."""
    unassigned_reason_id: Optional[str] = None
    """El motivo, ahora opcional: distingue "no mande la clave" de "quiero
    que quede vacia", igual que `comentario`.

    Se volvio opcional el 14/09 para que un PATCH pueda traer SOLO el
    comentario. Antes el motivo era obligatorio, asi que no habia forma de
    comentar una fila sin motivo -ni una fila con carga-, y el frontend ni
    siquiera dibujaba el campo: 0 comentarios guardados en 4.540 filas.
    """
    valid_until: Optional[date] = None
    """Hasta qué día sigue vigente el motivo (Vacaciones, Licencia). Los días
    siguientes lo heredan mientras no tengan carga. Sólo para motivos de
    "no trabajó"; lo valida services/cierre_lineas.poner_motivo."""

    @field_validator("unassigned_reason_id")
    @classmethod
    def vacio_es_sin_motivo(cls, v: Optional[str]) -> Optional[str]:
        # "— Sin especificar —" manda "": es quitar el motivo, no un uuid.
        return v or None

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
    unassigned_reason_id: Optional[str] = None
    valid_until: Optional[date] = None
    """Hasta qué día sigue vigente el motivo (Vacaciones, Licencia). Los días
    siguientes lo heredan mientras no tengan carga. Sólo para motivos de
    "no trabajó"; lo valida services/cierre_lineas.poner_motivo."""

    @field_validator("unassigned_reason_id")
    @classmethod
    def vacio_es_sin_motivo(cls, v: Optional[str]) -> Optional[str]:
        # "— Sin especificar —" manda "": es quitar el motivo, no un uuid.
        return v or None

    comentario: Optional[str] = None

    @field_validator("asset_ids")
    @classmethod
    def at_least_one(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("asset_ids no puede estar vacío")
        return v
