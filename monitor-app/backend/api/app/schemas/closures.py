"""Pydantic schemas del cierre del día unificado (services/cierre_lineas.py)."""
from typing import Optional

from pydantic import BaseModel


class CerrarDiaBody(BaseModel):
    override: bool = False
    override_note: Optional[str] = None


class ReabrirDiaBody(BaseModel):
    nota: Optional[str] = None
