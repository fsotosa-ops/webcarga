"""El glosario de estados, en código (spec 2026-10-12-directory-d1-one-answer-design.md §3 y §6.4).

Tres capas que no se mezclan:
  - ciclo de vida de la entidad (dato: operational_status);
  - estado de un documento (lo calcula services/vencimientos.document_state_sql);
  - resumen de quien debe los documentos y su habilitación (lo calcula
    services/fleet_compliance.py).

Ningún otro módulo escribe estos valores a mano. El espejo del frontend es
lib/states.ts."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel

from ..authz.permissions import Permission

# La baja es UN estado. De dónde vino (la app, el padrón viejo) es su motivo:
# status_reason_id, del vocabulario DEACTIVATION_REASON (plan 2026-10-21).
CarrierLifecycle = Literal["ACTIVE", "ONBOARDING", "INACTIVE"]
FleetLifecycle = Literal["ACTIVE", "INACTIVE"]

# ── Transiciones del ciclo de vida (plan 2026-10-21) ──────────────────────────
# El estado no se edita como un campo: cambia con una acción, y cada acción dice
# desde qué estados vale, quién puede hacerla y qué motivo pide. La regla vive
# aquí, una vez; la aplica services/lifecycle.py y las rutas de acción leen su
# permiso de esta misma tabla.
LifecycleEntity = Literal["CARRIER", "DRIVER", "ASSET"]
LifecycleAction = Literal["activate", "deactivate", "reactivate"]
DEACTIVATION_REASON = "DEACTIVATION_REASON"
REACTIVATION_REASON = "REACTIVATION_REASON"


@dataclass(frozen=True)
class LifecycleTransition:
    from_states: frozenset[str]
    to_state: str
    permission: Permission
    #: El vocabulario del motivo; None = la acción no pide motivo (activar una
    #: empresa nueva no es una decisión sobre su relación, es completar el alta).
    reason_domain: str | None
    #: Una empresa activa necesita RUT (se puede mandar al activarla).
    requires_tax_id: bool = False


LIFECYCLE_TRANSITIONS: dict[tuple[str, str], LifecycleTransition] = {
    # Activar una empresa nueva lo hace el Supervisor de Operaciones desde el
    # pre-cierre (R5): directory.edit. Dar de baja o reactivar una empresa es de
    # Certificación (D-e, 12/10): directory.delete.
    ("CARRIER", "activate"): LifecycleTransition(
        frozenset({"ONBOARDING"}), "ACTIVE", Permission.DIRECTORY_EDIT, None, requires_tax_id=True),
    ("CARRIER", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE", "ONBOARDING"}), "INACTIVE", Permission.DIRECTORY_DELETE, DEACTIVATION_REASON),
    ("CARRIER", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_DELETE, REACTIVATION_REASON, requires_tax_id=True),
    # Conductores y equipos: los da de baja y reactiva Operaciones (bloque 0, D-e).
    ("DRIVER", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE"}), "INACTIVE", Permission.DIRECTORY_FLEET_STATUS, DEACTIVATION_REASON),
    ("DRIVER", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_FLEET_STATUS, REACTIVATION_REASON),
    ("ASSET", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE"}), "INACTIVE", Permission.DIRECTORY_FLEET_STATUS, DEACTIVATION_REASON),
    ("ASSET", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_FLEET_STATUS, REACTIVATION_REASON),
}
DocumentState = Literal["UP_TO_DATE", "EXPIRING", "OVERDUE", "MISSING", "NOT_REQUIRED"]
AlertSeverity = Literal["warning", "critical"]
# Los baldes del embudo de Certificación (D1-R2). Salen de la escala del
# resumen, no del ciclo de vida: una empresa no activa no tiene balde (R-B4).
FunnelBucket = Literal["up_to_date", "expiring", "not_enabled"]

# Peor primero. NOT_REQUIRED no participa del resumen (§3).
SEVERITY_ORDER: tuple[str, ...] = ("OVERDUE", "MISSING", "EXPIRING", "UP_TO_DATE")
# Lo que quita la habilitación cuando es LEGAL_MANDATORY. Por vencer no bloquea (E-c).
BLOCKING_STATES: tuple[str, ...] = ("OVERDUE", "MISSING")


class StateCounts(BaseModel):
    overdue: int = 0
    expiring: int = 0
    missing: int = 0


class BlockingCounts(BaseModel):
    """Los obligatorios vencidos o faltantes: lo que bloquea la habilitación.
    Las cifras de `StateCounts` cuentan también los opcionales; con estas la
    ficha dice POR QUÉ alguien no está habilitado (fichas, 15/10)."""
    own: int = 0
    fleet: int | None = None            # solo empresas: los de su flota activa


class ComplianceSummary(BaseModel):
    worst_state: DocumentState          # el peor entre los OBLIGATORIOS pendientes (A-R5); UP_TO_DATE si no hay
    own: StateCounts                    # documentos de la propia entidad
    fleet: StateCounts | None = None    # solo empresas: lo de su flota activa
    can_operate: bool                   # §5 de la spec; regla en services/fleet_compliance.py
    blocking: BlockingCounts            # lo que hace falso a can_operate
