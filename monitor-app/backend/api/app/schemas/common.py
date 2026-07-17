"""Tipos compartidos por los schemas del modelo nuevo (public.*, H0/H1).
Reemplaza el PaginatedResponse de transporter_relational.py — mismo shape,
sin depender de un módulo que se borra en H2."""
from typing import Literal

from pydantic import BaseModel

EntityType = Literal["CARRIER", "DRIVER", "ASSET"]


class PaginatedResponse(BaseModel):
    data: list
    count: int
    page: int
    limit: int
