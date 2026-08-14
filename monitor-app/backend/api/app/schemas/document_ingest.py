"""Schemas de la bandeja de documentos sin clasificar (HU-01).

Un item es un archivo que ya está en storage pero todavía no pertenece a
ningún compliance_record. Los campos de match (`confidence`, `match_evidence`,
`candidates`) quedan vacíos en esta etapa: son los que llenará el agente de
clasificación automática cuando llegue, sobre este mismo modelo.
"""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

MatchStatus = Literal["AUTO", "SUGGESTED", "AMBIGUOUS", "UNMATCHED", "COMMITTED", "DISCARDED"]
EntityType = Literal["CARRIER", "DRIVER", "ASSET"]


class IngestItem(BaseModel):
    id: str
    file_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    storage_path: str
    match_status: MatchStatus


class TrayItem(IngestItem):
    """Item de la bandeja con su URL firmada para la vista previa.

    La vista previa no es un adorno: de 24 documentos reales, solo 1 traía un
    identificador en el nombre. Es el mecanismo por el que la persona decide
    qué es cada archivo.
    """
    preview_url: Optional[str] = None


class IngestUploadError(BaseModel):
    file_name: str
    error: str


class IngestUploadResult(BaseModel):
    batch_id: str
    items: list[IngestItem]
    errors: list[IngestUploadError]


class ClassifyBody(BaseModel):
    entity_type: EntityType
    entity_id: str
    requirement_id: str
    expiration_date: Optional[date] = None


class ClassifyBatchBody(BaseModel):
    """Aplica el mismo requisito a N archivos de la bandeja.

    Con un item equivale a clasificar de a uno; con quince ahorra catorce
    repeticiones de la misma elección.
    """
    item_ids: list[str]
    entity_type: EntityType
    entity_id: str
    requirement_id: str
    expiration_date: Optional[date] = None


class MoveItemsBody(BaseModel):
    """Reasigna archivos sin clasificar a otra empresa."""
    item_ids: list[str]
    carrier_id: str
