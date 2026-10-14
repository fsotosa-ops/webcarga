"""Corrección de RUT y patente (D3, Entrega B 14/10)."""
from pydantic import BaseModel


class IdentityCorrectionBody(BaseModel):
    """D3 (Entrega B): el valor nuevo y el motivo, obligatorio."""
    value: str
    reason: str
