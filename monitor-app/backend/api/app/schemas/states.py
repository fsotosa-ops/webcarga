"""El glosario de estados, en código (spec 2026-10-12-directory-d1-one-answer-design.md §3 y §6.4).

Tres capas que no se mezclan:
  - ciclo de vida de la entidad (dato: operational_status);
  - estado de un documento (lo calcula services/vencimientos.document_state_sql);
  - resumen de quien debe los documentos y su habilitación (lo calcula
    services/fleet_compliance.py).

Ningún otro módulo escribe estos valores a mano. El espejo del frontend es
lib/states.ts."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel

CarrierLifecycle = Literal["ACTIVE", "ONBOARDING", "INACTIVE", "LEGACY_INACTIVE"]
FleetLifecycle = Literal["ACTIVE", "INACTIVE"]
DocumentState = Literal["UP_TO_DATE", "EXPIRING", "OVERDUE", "MISSING", "NOT_REQUIRED"]
AlertSeverity = Literal["warning", "critical"]

# Peor primero. NOT_REQUIRED no participa del resumen (§3).
SEVERITY_ORDER: tuple[str, ...] = ("OVERDUE", "MISSING", "EXPIRING", "UP_TO_DATE")
# Lo que quita la habilitación cuando es LEGAL_MANDATORY. Por vencer no bloquea (E-c).
BLOCKING_STATES: tuple[str, ...] = ("OVERDUE", "MISSING")


class StateCounts(BaseModel):
    overdue: int = 0
    expiring: int = 0
    missing: int = 0


class ComplianceSummary(BaseModel):
    worst_state: DocumentState          # el peor entre los OBLIGATORIOS pendientes (A-R5); UP_TO_DATE si no hay
    own: StateCounts                    # documentos de la propia entidad
    fleet: StateCounts | None = None    # solo empresas: lo de su flota activa
    can_operate: bool                   # §5 de la spec; regla en services/fleet_compliance.py
