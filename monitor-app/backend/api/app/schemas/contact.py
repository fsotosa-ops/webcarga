"""Pydantic schemas para public.contacts (H2.2 — routers/contacts.py).
Polimórfico (entity_id/entity_type) — reemplaza app.transporter_contacts,
que solo cubría transporters. contact_role no tiene CHECK constraint en DB
(ver 20260716024709_public_carrier_contacts.sql) — valores documentados en
context_carriers.md ('LEGAL_REP', 'OPERATIONS', etc.) pero no cerramos el
enum acá para no romper si aparece un rol nuevo legítimo."""
from typing import Optional

from pydantic import BaseModel, field_validator

from .common import EntityType


class ContactCreateBody(BaseModel):
    entity_id: str
    entity_type: EntityType
    contact_role: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    job_title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_primary: bool = False

    @field_validator("contact_role", mode="before")
    @classmethod
    def _upper_role(cls, v):
        return v.strip().upper() if isinstance(v, str) else v


class ContactPatchBody(BaseModel):
    contact_role: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    job_title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    is_primary: Optional[bool] = None
    is_active: Optional[bool] = None

    @field_validator("contact_role", mode="before")
    @classmethod
    def _upper_role(cls, v):
        return v.strip().upper() if isinstance(v, str) else v
