"""Catálogo de requisitos de cumplimiento (public.compliance_requirements).

Router aparte de compliance.py: el catálogo describe QUÉ se exige, no el
estado de un compliance_record concreto, así que no cuelga de
/compliance-records. Extraído de compliance.py (que ya tenía 982 líneas)
para poder crecer con la configuración de condiciones y el recálculo sin
seguir engordando ese archivo.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_admin
from ..db import get_pool
from ..schemas.compliance import RequirementOption
from ..schemas.requirement import RecalcPreview, RecalcResult, RequirementConditionsPatchBody
from ..services.audit import log_change
from ..services.requirement_conditions import calcular_diferencias

requirements_router = APIRouter(prefix="/compliance-requirements", tags=["compliance"])

# Lista blanca de columnas tocables por PATCH /conditions — nunca se
# interpolan nombres que vengan del request, solo estas tres literales.
# `sent_fields()` ya está acotado al mismo conjunto, pero se repite acá para
# que el cast SQL de cada columna quede a la vista de quien lea el router.
_CONDITION_COLUMN_CASTS: dict[str, Optional[str]] = {
    "is_active": None,
    "applies_to_fleet_service_type_ids": "uuid[]",
    "applies_to_management_types": "text[]",
}


@requirements_router.get("", response_model=list[RequirementOption])
async def list_compliance_requirements(
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Tipos de documento del catálogo, opcionalmente acotados a un tipo de
    entidad. Solo lectura: administrar el catálogo requiere migración (ver
    HU-05 de la épica Red de Transporte).

    Incluye is_active/applies_to_* (Tramo 3): la pantalla de condiciones
    (Task 5) los pinta directo desde esta lista, no hay un segundo endpoint
    "de detalle" para el catálogo."""
    rows = await pool.fetch(
        """
        SELECT id::text, target_entity, requirement_code, name,
               requirement_level, COALESCE(has_expiration, false) AS has_expiration,
               is_active, applies_to_fleet_service_type_ids::text[] AS applies_to_fleet_service_type_ids,
               applies_to_management_types
        FROM public.compliance_requirements
        WHERE ($1::text IS NULL OR target_entity = $1)
        ORDER BY target_entity, name
        """,
        target_entity,
    )
    return [dict(r) for r in rows]


@requirements_router.patch("/{requirement_id}/conditions")
async def patch_requirement_conditions(
    requirement_id: str, body: RequirementConditionsPatchBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    """Cambia la regla, NO los registros. Aplicarla es un acto aparte
    (POST /recalc): guardar y aplicar son dos decisiones distintas.

    Admin, no editor: esto redefine a quién se le exige cada documento del
    catálogo — la misma altura de permiso que el resto de la configuración
    de catálogo del backend (app/routers/config.py, status_taxonomies.py)."""
    touched = body.sent_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                """
                SELECT id, is_active, applies_to_fleet_service_type_ids,
                       applies_to_management_types
                FROM public.compliance_requirements WHERE id = $1
                """,
                requirement_id,
            )
            if not current:
                raise HTTPException(404, "Requisito no encontrado")

            # UPDATE de ancho variable: solo entran las columnas efectivamente
            # enviadas, cada una con SU valor por placeholder — nunca COALESCE.
            # Con COALESCE, NULL solo puede significar "no lo mandaron", y
            # "lo mandaron NULL/[] a propósito" queda inexpresable. Los nombres
            # de columna salen únicamente de _CONDITION_COLUMN_CASTS (whitelist
            # fija); jamás del request.
            values: list = [requirement_id]
            set_parts = []
            for field in touched:
                values.append(getattr(body, field))
                cast = _CONDITION_COLUMN_CASTS[field]
                placeholder = f"${len(values)}" + (f"::{cast}" if cast else "")
                set_parts.append(f"{field} = {placeholder}")

            row = await conn.fetchrow(
                f"""
                UPDATE public.compliance_requirements SET
                    {", ".join(set_parts)}
                WHERE id = $1
                RETURNING id, requirement_code, is_active,
                          applies_to_fleet_service_type_ids, applies_to_management_types
                """,
                *values,
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                    action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
    return dict(row)


@requirements_router.get("/{requirement_id}/recalc-preview", response_model=RecalcPreview)
async def recalc_preview(
    requirement_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Sólo lectura. Sin esto la configuración miente: se cambia la regla y la
    pantalla sigue mostrando lo viejo."""
    d = await calcular_diferencias(pool, requirement_id)
    if d["target_entity"] is None:
        raise HTTPException(404, "Requisito no encontrado")
    return {"crear": len(d["crear"]), "quitar": len(d["quitar"]), "bloqueados": len(d["bloqueados"])}


@requirements_router.post("/{requirement_id}/recalc", response_model=RecalcResult)
async def recalc(
    requirement_id: str, pool=Depends(get_pool), user=Depends(require_admin),
):
    """Admin, no editor: puede disparar un DELETE masivo sobre
    compliance_records (ver docstring de patch_requirement_conditions)."""
    d = await calcular_diferencias(pool, requirement_id)
    if d["target_entity"] is None:
        raise HTTPException(404, "Requisito no encontrado")

    creados_ids: list = []
    quitados_ids: list = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            if d["crear"]:
                creados_rows = await conn.fetch(
                    """
                    INSERT INTO public.compliance_records
                        (entity_id, entity_type, requirement_id, status, is_current)
                    SELECT unnest($1::uuid[]), $2, $3, 'MISSING', true
                    ON CONFLICT (entity_id, requirement_id) DO NOTHING
                    RETURNING id
                    """,
                    d["crear"], d["target_entity"], requirement_id,
                )
                creados_ids = [str(r["id"]) for r in creados_rows]
            if d["quitar"]:
                # D13, sin depender del reloj: la vista previa se calculó
                # fuera de esta transacción, así que el DELETE vuelve a
                # comprobar el predicado en vez de confiar ciegamente en los
                # IDs que trajo `calcular_diferencias`. Si alguien subió un
                # archivo entre el cálculo y acá, la fila ya no matchea y
                # sobrevive. `quitados` reporta lo efectivamente borrado
                # (RETURNING), no lo planeado.
                quitados_rows = await conn.fetch(
                    """
                    DELETE FROM public.compliance_records
                     WHERE id = ANY($1::uuid[])
                       AND file_url IS NULL AND NOT is_manual_override
                       AND status IS NOT DISTINCT FROM 'MISSING'
                    RETURNING id
                    """,
                    d["quitar"],
                )
                quitados_ids = [str(r["id"]) for r in quitados_rows]
            # Rastro forense único: compliance_records no tiene tabla de
            # historial y el DELETE es físico — lo que no quede acá en
            # audit_log no se puede reconstruir nunca.
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="recalc", field="compliance_records",
                old_value=quitados_ids, new_value=creados_ids, source="api",
            )
    return {"creados": len(creados_ids), "quitados": len(quitados_ids),
            "bloqueados": len(d["bloqueados"])}
