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

# Las empresas cuya carpeta trabaja Certificación (21/10): las que operan y las que
# están entrando. Toda empresa nueva nace en onboarding y se le arma la carpeta; las
# dos pasan por el mismo cálculo de documentos (services/fleet_compliance.py) y la
# misma cola de Pendientes (services/vencimientos.in_scope_sql). Una dada de baja es
# historial: sus cifras se ven, pero no bloquean ni entran a la cola.
CARRIER_STATUSES_IN_CERTIFICATION: tuple[str, ...] = ("ACTIVE", "ONBOARDING")

# ── Transiciones del ciclo de vida (plan 2026-10-21) ──────────────────────────
# El estado no se edita como un campo: cambia con una acción, y cada acción dice
# desde qué estados vale, quién puede hacerla y qué motivo pide. La regla vive
# aquí, una vez; la aplica services/lifecycle.py y las rutas de acción leen su
# permiso de esta misma tabla.
LifecycleEntity = Literal["CARRIER", "DRIVER", "ASSET"]
LifecycleAction = Literal["activate", "deactivate", "reactivate", "return_to_onboarding"]
DEACTIVATION_REASON = "DEACTIVATION_REASON"
REACTIVATION_REASON = "REACTIVATION_REASON"
ACTIVATION_EXCEPTION_REASON = "ACTIVATION_EXCEPTION_REASON"
RETURN_TO_ONBOARDING_REASON = "RETURN_TO_ONBOARDING_REASON"


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
    #: Salir del onboarding exige lo mismo que la habilitación: ningún obligatorio
    #: exigible vencido o faltante, propio o de su flota activa (`requirements_met`
    #: del resumen de documentos, el mismo cálculo).
    requires_requirements_met: bool = False
    #: Sin cumplirlo se puede igual, como excepción: con este permiso y un motivo de
    #: este vocabulario. None = no hay excepción.
    exception_permission: Permission | None = None
    exception_reason_domain: str | None = None
    #: Desde cuándo rige si no se manda fecha (plan 2026-10-28): "today" es el primer día
    #: no firmado; "tomorrow", el siguiente. Activar rige desde mañana: así una empresa
    #: habilitada a media tarde no entra al Cierre de hoy con flota que nunca pudo salir.
    default_effective: Literal["today", "tomorrow"] = "today"
    #: A qué estado va si la carpeta no cumple, en vez de `to_state` (28/10): una
    #: empresa dada de baja que vuelve con la carpeta incompleta se recalifica en
    #: onboarding. None = la carpeta no decide el destino.
    to_state_if_pending: str | None = None
    #: La acción revierte una baja: un motivo con `blocks_reactivation` (baja
    #: definitiva) exige además `directory.reinstate`.
    reverts_deactivation: bool = False


LIFECYCLE_TRANSITIONS: dict[tuple[str, str], LifecycleTransition] = {
    # Activar, dar de baja, reactivar o volver a onboarding una empresa es de Certificación
    # (directory.delete): habilita quien califica, no quien despacha (28/10; antes Operaciones
    # activaba desde el pre-cierre). Sin que nadie lo haga, la empresa que cumple se activa
    # sola (lifecycle.activate_ready_carriers).
    ("CARRIER", "activate"): LifecycleTransition(
        frozenset({"ONBOARDING"}), "ACTIVE", Permission.DIRECTORY_DELETE, None, requires_tax_id=True,
        requires_requirements_met=True,
        # Sin la carpeta completa es una excepción provisoria: motivo y fecha de compromiso.
        exception_permission=Permission.DIRECTORY_DELETE, exception_reason_domain=ACTIVATION_EXCEPTION_REASON,
        default_effective="tomorrow"),
    # La salida inversa: una empresa activada antes de tiempo, o una baja que vuelve a
    # certificarse, no se da de baja "por mientras" (mezclaba dos estados, 22/10).
    ("CARRIER", "return_to_onboarding"): LifecycleTransition(
        frozenset({"ACTIVE"}), "ONBOARDING", Permission.DIRECTORY_DELETE, RETURN_TO_ONBOARDING_REASON),
    ("CARRIER", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE", "ONBOARDING"}), "INACTIVE", Permission.DIRECTORY_DELETE, DEACTIVATION_REASON),
    # Una dada de baja vuelve por la misma puerta que una nueva (28/10): con la carpeta
    # completa, activa (reincorporación); incompleta, onboarding (recalificación).
    ("CARRIER", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_DELETE, REACTIVATION_REASON, requires_tax_id=True,
        to_state_if_pending="ONBOARDING", reverts_deactivation=True),
    # Conductores y equipos: los da de baja y reactiva Operaciones (bloque 0, D-e).
    ("DRIVER", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE"}), "INACTIVE", Permission.DIRECTORY_FLEET_STATUS, DEACTIVATION_REASON),
    ("DRIVER", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_FLEET_STATUS, REACTIVATION_REASON,
        reverts_deactivation=True),
    ("ASSET", "deactivate"): LifecycleTransition(
        frozenset({"ACTIVE"}), "INACTIVE", Permission.DIRECTORY_FLEET_STATUS, DEACTIVATION_REASON),
    ("ASSET", "reactivate"): LifecycleTransition(
        frozenset({"INACTIVE"}), "ACTIVE", Permission.DIRECTORY_FLEET_STATUS, REACTIVATION_REASON,
        reverts_deactivation=True),
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
    # Ningún obligatorio que bloquee, sin mirar el ciclo de vida: es can_operate antes de
    # pedir que esté activa. Para una empresa en onboarding es el criterio para activarla
    # (21/10); para una dada de baja es siempre False (su carpeta es historial).
    requirements_met: bool
