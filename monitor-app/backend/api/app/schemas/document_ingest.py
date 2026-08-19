"""Schemas de la bandeja de documentos sin clasificar (HU-01).

Un item es un archivo que ya está en storage pero todavía no pertenece a
ningún compliance_record. Los campos de match (`confidence`, `match_evidence`,
`candidates`) quedan vacíos en esta etapa: son los que llenará el agente de
clasificación automática cuando llegue, sobre este mismo modelo.
"""
from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel

MatchStatus = Literal["AUTO", "SUGGESTED", "AMBIGUOUS", "UNMATCHED", "COMMITTED", "DISCARDED"]
EntityType = Literal["CARRIER", "DRIVER", "ASSET"]

# Un archivo deja de estar "sin clasificar" sólo cuando alguien lo confirmó
# (COMMITTED) o lo descartó (DISCARDED). AUTO, SUGGESTED y AMBIGUOUS son
# trabajo pendiente: el clasificador los resolvió pero nadie los confirmó.
_CLASSIFIED_MATCH_STATUSES: tuple[str, ...] = ("COMMITTED", "DISCARDED")


def unclassified_predicate(alias: str = "i") -> str:
    """El predicado de "sin clasificar", en un solo lugar.

    Lo usan la cola de la bandeja (`GET /document-ingest/items`) y el conteo
    por empresa de `GET /compliance-records/status`. Tenerlo escrito dos veces
    ya había divergido: la cola miraba `NOT IN ('COMMITTED','DISCARDED')` y el
    conteo seguía en `= 'UNMATCHED'`. Hoy coinciden sólo porque nadie escribe
    AUTO/SUGGESTED todavía; el día que se conecte `document_matcher.py` la
    pestaña Empresas diría "0 sin clasificar" para una empresa cuya bandeja
    muestra 12.
    """
    lista = ", ".join(f"'{s}'" for s in _CLASSIFIED_MATCH_STATUSES)
    return f"{alias}.match_status NOT IN ({lista})"


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


class QueueRow(BaseModel):
    """Fila de la cola global de sin clasificar.

    Trae su empresa porque la cola las mezcla y la tabla se agrupa por ese
    valor. Trae los campos de sugerencia porque el agente de clasificación los
    va a llenar sobre este mismo contrato: la columna existe desde ahora para
    no rehacer la pantalla cuando llegue.

    NO trae `preview_url`: firmarla es una llamada HTTP a Storage por archivo
    y el listado devuelve cientos. Se pide en /items/{id}/preview-url.
    """
    id: str
    file_name: str
    mime_type: Optional[str] = None
    size_bytes: Optional[int] = None
    storage_path: str
    match_status: MatchStatus
    created_at: datetime
    carrier_id: Optional[str] = None
    carrier_name: Optional[str] = None
    confidence: Optional[float] = None
    suggested_requirement_name: Optional[str] = None
    candidate_count: int = 0
    # Cuántos items pendientes comparten este destino / este contenido,
    # incluyéndose a sí mismo. 1 = sin colisión.
    #
    # Son DOS señales y no una aunque compartan forma, porque piden acciones
    # distintas: mismo contenido -> "este archivo ya está en la cola, borra
    # uno"; mismo destino -> "dos archivos distintos reclaman el casillero,
    # elige cuál".
    mismo_casillero: int = 1
    mismo_contenido: int = 1


class TrayPage(BaseModel):
    total: int
    rows: list[QueueRow]


class IngestUploadError(BaseModel):
    file_name: str
    error: str


class IngestUploadResult(BaseModel):
    batch_id: str
    items: list[IngestItem]
    errors: list[IngestUploadError]


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


class UndoClassifyBody(BaseModel):
    """Revierte una clasificación en lote.

    Se identifica por los mismos item_ids que devolvió `classify-batch` en
    `applied`. No hace falta un registro de operaciones: quien deshace es
    quien acaba de aplicar, y tiene los ids a mano.
    """
    item_ids: list[str]


class UndoClassifyItemError(BaseModel):
    item_id: str
    error: str


class UndoClassifyResult(BaseModel):
    reverted: list[str]
    errors: list[UndoClassifyItemError]
