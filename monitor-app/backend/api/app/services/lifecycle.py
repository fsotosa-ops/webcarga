"""El ciclo de vida de empresas, conductores y equipos (plan 2026-10-21).

El único lugar que cambia `operational_status`, salvo el alta (que fija el estado
inicial). La regla de cada acción —desde qué estado vale, qué permiso exige, qué
motivo pide— está en `schemas/states.LIFECYCLE_TRANSITIONS`; aquí se aplica:

  1. bloquea la fila y valida que la acción corresponde a su estado (409 si no);
  2. valida el motivo: del vocabulario de la acción, activo y aplicable a la entidad
     (su `group_id` es `all` o la entidad); con el código OTHER, el comentario es
     obligatorio. Mismo criterio que los motivos de anulación (anular_viajes);
  3. escribe el estado con su fecha de vigencia por app.set_lifecycle_status (el
     período en app.lifecycle_status_periods y, si ya rige, la fila), y lo deja en
     audit_log;
  4. al reactivar una empresa, la flota que no se eligió sale de su roster hoy
     (P3), con historial.

Reactivar es volver a certificar: el estado vuelve a ACTIVE y la habilitación se
calcula (services/fleet_compliance.py), así que quien vuelve con documentos vencidos
queda No habilitado hasta regularizar. Ningún paso de aquí lo decide.
"""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta

import asyncpg
from fastapi import HTTPException

from ..schemas.states import LIFECYCLE_TRANSITIONS, LifecycleAction, LifecycleEntity, LifecycleTransition
from . import fleet_assignments
from .fleet_assignments import closed_day_as_409
from .fleet_compliance import carrier_compliance_cte
from ..utils.identity import same_rut_sql
from .audit import log_change, record_manual_edit

OTHER_REASON_CODE = "OTHER"


@dataclass(frozen=True)
class _Subject:
    table: str
    #: Cómo se nombra en un mensaje ("La empresa está activa").
    noun: str
    not_found: str
    state_words: dict[str, str]


_SUBJECTS: dict[str, _Subject] = {
    "CARRIER": _Subject("carriers", "La empresa", "Empresa no encontrada",
                        {"ACTIVE": "activa", "ONBOARDING": "en onboarding", "INACTIVE": "dada de baja"}),
    "DRIVER": _Subject("drivers", "El conductor", "Conductor no encontrado",
                       {"ACTIVE": "activo", "INACTIVE": "dado de baja"}),
    "ASSET": _Subject("assets", "El equipo", "Activo no encontrado",
                      {"ACTIVE": "activo", "INACTIVE": "dado de baja"}),
}
_ACTION_WORDS = {"activate": "activar", "deactivate": "dar de baja", "reactivate": "reactivar",
                 "return_to_onboarding": "volver a onboarding"}
EXCEPTION_EXPIRED_REASON_CODE = "EXCEPTION_EXPIRED"


async def first_open_day(conn, day: date | None = None) -> date:
    """El primer día que un cambio puede regir: desde `day` (hoy si no se manda), el
    primero que no está firmado en el Cierre."""
    return await conn.fetchval(
        "SELECT app.first_unclosed_day(COALESCE($1::date, public.hoy_chile()))", day)


async def _effective_date(conn, rule: LifecycleTransition, requested: date | None) -> date:
    """La fecha desde la que rige el cambio. Nunca antes de hoy: un estado no reescribe
    días pasados (E, 28/10)."""
    today = await conn.fetchval("SELECT public.hoy_chile()")
    if requested is not None:
        if requested < today:
            raise HTTPException(422, "La fecha desde la que rige no puede ser anterior a hoy")
        return requested
    return await first_open_day(conn, today + timedelta(days=1) if rule.default_effective == "tomorrow" else today)


def transition_for(entity: LifecycleEntity, action: LifecycleAction) -> LifecycleTransition:
    return LIFECYCLE_TRANSITIONS[(entity, action)]


def _pending_phrase(own: int, fleet: int) -> str:
    """"3 obligatorios de la empresa y 2 de su flota", con las palabras de la ficha."""
    word = lambda n: "obligatorio" if n == 1 else "obligatorios"  # noqa: E731
    if own and fleet:
        return f"{own} {word(own)} de la empresa y {fleet} de su flota"
    return f"{own} {word(own)} de la empresa" if own else f"{fleet} {word(fleet)} de su flota"


async def requirements_pending(conn, carrier_id: str) -> tuple[int, int] | None:
    """Lo que le falta a una empresa para activarla: (propios, de su flota) que la
    bloquean, o None si cumple. Es `requirements_met` del resumen de documentos, el
    mismo cálculo de la habilitación (services/fleet_compliance.py): no hay otra regla."""
    row = await conn.fetchrow(
        f"WITH {carrier_compliance_cte()} "
        "SELECT requirements_met, blocking_own, blocking_fleet FROM carrier_compliance WHERE carrier_id = $1::uuid",
        carrier_id)
    if row is None or row["requirements_met"]:
        return None
    return int(row["blocking_own"] or 0), int(row["blocking_fleet"] or 0)


class _WhatIf(Exception):
    def __init__(self, pending):
        self.pending = pending


async def requirements_pending_in_certification(conn, carrier_id: str) -> tuple[int, int] | None:
    """`requirements_pending` como si la empresa estuviera en certificación. Para una
    dada de baja el resumen no evalúa nada (ruling D1-R1: su carpeta es historial), así
    que la pregunta "¿cumple para volver?" se hace con la fila en onboarding, dentro de
    un savepoint que se deshace: el mismo cálculo, sin escribir nada."""
    try:
        async with conn.transaction():
            await conn.execute("SELECT set_config('app.lifecycle_writer', 'on', true)")
            await conn.execute("UPDATE public.carriers SET operational_status = 'ONBOARDING' WHERE id = $1",
                               carrier_id)
            raise _WhatIf(await requirements_pending(conn, carrier_id))
    except _WhatIf as what_if:
        return what_if.pending


def status_reason_columns_sql(alias: str) -> str:
    """Las columnas del motivo vigente que devuelve una ficha (empresa, conductor o
    equipo): la etiqueta del motivo, el comentario y cuándo cambió el estado."""
    return (f"(SELECT label FROM app.status_taxonomies WHERE id = {alias}.status_reason_id) AS status_reason, "
            f"{alias}.status_note, {alias}.status_changed_at")


async def _reason(conn, domain: str, entity: str, reason_id: str | None,
                  note: str | None) -> tuple[str, str, str | None]:
    """(id, etiqueta, comentario limpio) del motivo, o 422."""
    if not reason_id:
        raise HTTPException(422, "Elige un motivo")
    try:
        row = await conn.fetchrow(
            "SELECT id::text AS id, label, code FROM app.status_taxonomies "
            "WHERE id = $1::uuid AND domain = $2 AND active "
            "AND COALESCE(group_id, 'all') IN ('all', $3)",
            reason_id, domain, entity.lower(),
        )
    except (asyncpg.DataError, ValueError):
        row = None
    if row is None:
        raise HTTPException(422, "Motivo inválido")
    clean_note = (note or "").strip() or None
    if row["code"] == OTHER_REASON_CODE and clean_note is None:
        raise HTTPException(422, "Con «Otro» escribe un comentario que diga por qué")
    return row["id"], row["label"], clean_note


async def _set_tax_id(conn, carrier_id: str, tax_id: str) -> None:
    """El RUT que se manda al activar una empresa nueva. "76.123.456-7" y
    "761234567" son el mismo RUT (utils/identity.same_rut_sql)."""
    dup = await conn.fetchval(
        f"SELECT id FROM public.carriers WHERE {same_rut_sql('tax_id', '$1')} AND id != $2", tax_id, carrier_id,
    )
    if dup:
        raise HTTPException(409, f"Ya existe una empresa con tax_id {tax_id}")
    await conn.execute("UPDATE public.carriers SET tax_id = $2 WHERE id = $1", carrier_id, tax_id)


async def _release_unchosen_fleet(conn, carrier_id: str, driver_ids: list[str], asset_ids: list[str],
                                  actor: str) -> dict[str, int]:
    """P3: la flota que no vuelve con la empresa sale de su roster hoy, con historial."""
    kept = {"DRIVER": set(driver_ids), "ASSET": set(asset_ids)}
    released = {"DRIVER": 0, "ASSET": 0}
    for rel in (fleet_assignments.DRIVER, fleet_assignments.ASSET):
        roster = await conn.fetch(
            f"SELECT {rel.subject_col}::text AS id FROM public.{rel.table} "
            f"WHERE {rel.counterpart_col} = $1 AND status = 'ACTIVE'", carrier_id)
        for row in roster:
            if row["id"] not in kept[rel.entity_type]:
                await fleet_assignments.end(conn, rel, row["id"], carrier_id, actor=actor)
                released[rel.entity_type] += 1
    return {"released_drivers": released["DRIVER"], "released_assets": released["ASSET"]}


async def transition(
    conn, *, entity: LifecycleEntity, entity_id: str, action: LifecycleAction, actor: str,
    reason_id: str | None = None, note: str | None = None, tax_id: str | None = None,
    driver_ids: list[str] | None = None, asset_ids: list[str] | None = None,
    effective_date: date | None = None, exception_until: date | None = None, source: str = "app",
    reinstate_check: Callable[[], None] | None = None,
) -> dict:
    """Aplica la acción. Debe correr dentro de una transacción; el permiso lo exige
    la ruta con `transition_for(entity, action).permission`. `actor` es None solo en
    lo que hace el sistema (`source="auto"`). `reinstate_check` exige directory.reinstate
    (lo arma la ruta con `exigir`); se llama solo si la acción revierte una baja
    definitiva, y sin él esa reactivación se niega."""
    rule = transition_for(entity, action)
    subject = _SUBJECTS[entity]
    columns = ("operational_status, status_reason_id, tax_id" if entity == "CARRIER"
               else "operational_status, status_reason_id")
    current = await conn.fetchrow(
        f"SELECT {columns} FROM public.{subject.table} WHERE id = $1 FOR UPDATE", entity_id)
    if not current:
        raise HTTPException(404, subject.not_found)
    old_state = current["operational_status"]
    if old_state not in rule.from_states:
        word = subject.state_words.get(old_state, old_state)
        raise HTTPException(409, f"{subject.noun} está {word}: no se puede {_ACTION_WORDS[action]}")

    if rule.reverts_deactivation and await conn.fetchval(
            "SELECT blocks_reactivation FROM app.status_taxonomies WHERE id = $1", current["status_reason_id"]):
        if reinstate_check is None:
            raise HTTPException(403, {"code": "DEFINITIVE_DEACTIVATION",
                                      "message": f"{subject.noun} se dio de baja en forma definitiva: "
                                                 "solo Administración puede reactivarla."})
        reinstate_check()

    reason_label = None
    if rule.reason_domain:
        reason_id, reason_label, note = await _reason(conn, rule.reason_domain, entity, reason_id, note)
    elif not rule.exception_reason_domain:
        reason_id, note = None, None

    if tax_id and action != "activate":
        raise HTTPException(422, "El RUT solo se manda al activar una empresa nueva")
    if tax_id and current["tax_id"] and tax_id != current["tax_id"]:
        raise HTTPException(422, "La empresa ya tiene RUT: se corrige en sus datos, no al activarla")
    if rule.requires_tax_id and not current["tax_id"]:
        if action == "activate" and tax_id:
            await _set_tax_id(conn, entity_id, tax_id)
            await record_manual_edit(
                conn, table=subject.table, where={"id": entity_id}, actor=actor, entity_type=entity,
                entity_id=entity_id, action="update", field="tax_id", old_value=None, new_value=tax_id,
            )
        else:
            raise HTTPException(422, "No se puede activar una empresa sin RUT/tax_id")

    effective = await _effective_date(conn, rule, effective_date)

    # Salir del onboarding exige lo mismo que la habilitación (21/10). Sin cumplirlo,
    # solo como excepción: con motivo y fecha de compromiso (el permiso de la excepción
    # lo exige la ruta).
    exception = False
    to_state = rule.to_state
    result: dict = {}
    if entity == "CARRIER" and action == "reactivate":
        # Primero la flota que no vuelve (P3): su carpeta ya no cuenta para la empresa.
        result |= await _release_unchosen_fleet(conn, entity_id, driver_ids or [], asset_ids or [], actor)
    if rule.to_state_if_pending and await requirements_pending_in_certification(conn, entity_id) is not None:
        # Vuelve con la carpeta incompleta: se recalifica en onboarding (28/10).
        to_state = rule.to_state_if_pending
    if rule.requires_requirements_met:
        pending = await requirements_pending(conn, entity_id)
        if pending is None:
            reason_id, note = None, None
        elif not reason_id:
            raise HTTPException(409, {
                "code": "ONBOARDING_INCOMPLETE",
                "message": (f"Faltan {_pending_phrase(*pending)} para activarla. "
                            "Certificación puede activarla como excepción, con motivo."),
                "own": pending[0], "fleet": pending[1],
            })
        else:
            reason_id, reason_label, note = await _reason(
                conn, rule.exception_reason_domain, entity, reason_id, note)
            exception = True
    if exception and (exception_until is None or exception_until < effective):
        raise HTTPException(422, "Una activación como excepción pide la fecha en que la carpeta "
                                 "estará completa, desde el día en que rige")
    if not exception and exception_until is not None:
        raise HTTPException(422, "La fecha de compromiso es solo para una activación como excepción")

    async with closed_day_as_409():
        await conn.execute(
            "SELECT app.set_lifecycle_status($1, $2::uuid, $3, $4, $5, $6::uuid, $7, $8, $9::uuid)",
            entity, entity_id, to_state, effective, source, reason_id, note, exception_until, actor,
        )
    now_effective = effective <= await conn.fetchval("SELECT public.hoy_chile()")
    if now_effective and actor:
        # La fila cambió hoy: la marca de edición manual y la línea de la bitácora.
        await record_manual_edit(
            conn, table=subject.table, where={"id": entity_id}, actor=actor, entity_type=entity,
            entity_id=entity_id, action="update", field="operational_status",
            old_value=old_state, new_value=to_state,
        )

    result = {"operational_status": to_state if now_effective else old_state,
              "effective_date": effective.isoformat(), **result}

    await log_change(
        conn, actor=actor, entity_type=entity, entity_id=entity_id, action=action,
        source="api" if source == "app" else source,
        new_value={
            "reason_id": reason_id, "reason": reason_label, "note": note,
            "effective_date": effective.isoformat(), "to_state": to_state,
            **({"exception": True, "exception_until": exception_until.isoformat()} if exception else {}),
            **({"drivers": sorted(driver_ids or []), "assets": sorted(asset_ids or [])}
               if entity == "CARRIER" and action == "reactivate" else {}),
        },
    )
    return result


# ── Lo que el sistema hace solo (lo llama el ejecutor del Cierre) ────────────

# Una empresa en onboarding sin un cambio ya programado, con RUT y la carpeta completa
# (propia y de la flota): `requirements_met`, el mismo cálculo de la habilitación.
_SQL_READY = f"""
WITH {carrier_compliance_cte()}
SELECT c.id::text AS carrier_id
FROM public.carriers c
JOIN app.lifecycle_status_periods p
  ON p.entity_type = 'CARRIER' AND p.entity_id = c.id AND p.valid_during @> $1::date
 AND p.status = 'ONBOARDING' AND upper_inf(p.valid_during)
JOIN carrier_compliance cc ON cc.carrier_id = c.id AND cc.requirements_met
WHERE c.tax_id IS NOT NULL
"""

# Excepciones con fecha de compromiso: las que ya se cumplieron dejan de ser excepción
# (después, un documento que vence la deja "no habilitada", no en onboarding: A, 28/10);
# las vencidas sin cumplir vuelven a onboarding desde el día siguiente al compromiso.
_SQL_EXCEPTIONS = f"""
WITH {carrier_compliance_cte()}
SELECT p.id::text AS period_id, p.entity_id::text AS carrier_id, p.exception_until,
       COALESCE(cc.requirements_met, false) AS met
FROM app.lifecycle_status_periods p
LEFT JOIN carrier_compliance cc ON cc.carrier_id = p.entity_id
WHERE p.entity_type = 'CARRIER' AND p.status = 'ACTIVE' AND p.exception_until IS NOT NULL
  AND p.valid_during @> $1::date AND upper_inf(p.valid_during)
"""


_SQL_ANY_CANDIDATE = """
SELECT EXISTS (
    SELECT 1 FROM app.lifecycle_status_periods p
    JOIN public.carriers c ON c.id = p.entity_id
    WHERE p.entity_type = 'CARRIER' AND p.valid_during @> $1::date AND upper_inf(p.valid_during)
      AND ((p.status = 'ONBOARDING' AND c.tax_id IS NOT NULL)
           OR (p.status = 'ACTIVE' AND p.exception_until IS NOT NULL))
)
"""


async def activate_ready_carriers(conn, *, today: date | None = None) -> dict:
    """La activación automática y el vencimiento de las excepciones. Es un barrido y no
    un gancho en cada escritura (documentos, flota, requisitos de Configuración): así
    ninguna ruta tiene que acordarse de llamarlo. Solo mira empresas en onboarding o
    activadas por excepción, que son pocas. `today` existe para los tests."""
    real_today = await conn.fetchval("SELECT public.hoy_chile()")
    day = today or real_today
    summary = {"activated": [], "exceptions_fulfilled": [], "returned_to_onboarding": []}
    # Corre cada minuto: el resumen de documentos se calcula solo si hay a quién mirar.
    if not await conn.fetchval(_SQL_ANY_CANDIDATE, day):
        return summary

    for row in await conn.fetch(_SQL_READY, day):
        await transition(conn, entity="CARRIER", entity_id=row["carrier_id"], action="activate", actor=None,
                         effective_date=await first_open_day(conn, day + timedelta(days=1)), source="auto")
        summary["activated"].append(row["carrier_id"])

    expired_reason = None
    for row in await conn.fetch(_SQL_EXCEPTIONS, day):
        if row["met"]:
            await conn.execute("UPDATE app.lifecycle_status_periods SET exception_until = NULL "
                               "WHERE id = $1::uuid", row["period_id"])
            await log_change(conn, actor=None, entity_type="CARRIER", entity_id=row["carrier_id"],
                             action="activation_exception_fulfilled", source="auto")
            summary["exceptions_fulfilled"].append(row["carrier_id"])
        elif row["exception_until"] < day:
            if expired_reason is None:
                expired_reason = await conn.fetchval(
                    "SELECT id::text FROM app.status_taxonomies WHERE domain = $1 AND code = $2",
                    transition_for("CARRIER", "return_to_onboarding").reason_domain, EXCEPTION_EXPIRED_REASON_CODE)
            await transition(conn, entity="CARRIER", entity_id=row["carrier_id"], action="return_to_onboarding",
                             actor=None, reason_id=expired_reason, source="auto",
                             # Si el barrido no corrió ese día, rige desde hoy: nunca reescribe el pasado.
                             effective_date=await first_open_day(
                                 conn, max(row["exception_until"] + timedelta(days=1), real_today)))
            summary["returned_to_onboarding"].append(row["carrier_id"])
    return summary
