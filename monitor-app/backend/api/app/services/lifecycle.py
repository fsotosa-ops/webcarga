"""El ciclo de vida de empresas, conductores y equipos (plan 2026-10-21).

El único lugar que cambia `operational_status`, salvo el alta (que fija el estado
inicial). La regla de cada acción —desde qué estado vale, qué permiso exige, qué
motivo pide— está en `schemas/states.LIFECYCLE_TRANSITIONS`; aquí se aplica:

  1. bloquea la fila y valida que la acción corresponde a su estado (409 si no);
  2. valida el motivo: del vocabulario de la acción, activo y aplicable a la entidad
     (su `group_id` es `all` o la entidad); con el código OTHER, el comentario es
     obligatorio. Mismo criterio que los motivos de anulación (anular_viajes);
  3. escribe el estado, el motivo vigente y la fecha, y lo deja en audit_log;
  4. al reactivar una empresa, la flota que no se eligió sale de su roster hoy
     (P3), con historial.

Reactivar es volver a certificar: el estado vuelve a ACTIVE y la habilitación se
calcula (services/fleet_compliance.py), así que quien vuelve con documentos vencidos
queda No habilitado hasta regularizar. Ningún paso de aquí lo decide.
"""
from __future__ import annotations

from dataclasses import dataclass

import asyncpg
from fastapi import HTTPException

from ..schemas.states import LIFECYCLE_TRANSITIONS, LifecycleAction, LifecycleEntity, LifecycleTransition
from . import fleet_assignments
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
_ACTION_WORDS = {"activate": "activar", "deactivate": "dar de baja", "reactivate": "reactivar"}


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
) -> dict:
    """Aplica la acción. Debe correr dentro de una transacción; el permiso lo exige
    la ruta con `transition_for(entity, action).permission`."""
    rule = transition_for(entity, action)
    subject = _SUBJECTS[entity]
    columns = "operational_status, tax_id" if entity == "CARRIER" else "operational_status"
    current = await conn.fetchrow(
        f"SELECT {columns} FROM public.{subject.table} WHERE id = $1 FOR UPDATE", entity_id)
    if not current:
        raise HTTPException(404, subject.not_found)
    old_state = current["operational_status"]
    if old_state not in rule.from_states:
        word = subject.state_words.get(old_state, old_state)
        raise HTTPException(409, f"{subject.noun} está {word}: no se puede {_ACTION_WORDS[action]}")

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

    # Salir del onboarding exige lo mismo que la habilitación (21/10). Sin cumplirlo,
    # solo como excepción: con motivo (el permiso de la excepción lo exige la ruta).
    exception = False
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

    touch_updated_at = ", updated_at = NOW()" if entity == "CARRIER" else ""
    await conn.execute(
        f"""
        UPDATE public.{subject.table}
           SET operational_status = $2, status_reason_id = $3::uuid, status_note = $4,
               status_changed_at = NOW(){touch_updated_at}
         WHERE id = $1
        """,
        entity_id, rule.to_state, reason_id, note,
    )
    await record_manual_edit(
        conn, table=subject.table, where={"id": entity_id}, actor=actor, entity_type=entity,
        entity_id=entity_id, action="update", field="operational_status",
        old_value=old_state, new_value=rule.to_state,
    )

    result: dict = {"operational_status": rule.to_state}
    if entity == "CARRIER" and action == "reactivate":
        result |= await _release_unchosen_fleet(conn, entity_id, driver_ids or [], asset_ids or [], actor)

    await log_change(
        conn, actor=actor, entity_type=entity, entity_id=entity_id, action=action,
        new_value={
            "reason_id": reason_id, "reason": reason_label, "note": note,
            **({"exception": True} if exception else {}),
            **({"drivers": sorted(driver_ids or []), "assets": sorted(asset_ids or [])}
               if entity == "CARRIER" and action == "reactivate" else {}),
        },
    )
    return result
