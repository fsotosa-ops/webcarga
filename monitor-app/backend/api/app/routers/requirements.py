"""Catálogo de requisitos de cumplimiento (public.compliance_requirements).

Router aparte de compliance.py: el catálogo describe QUÉ se exige, no el
estado de un compliance_record concreto, así que no cuelga de
/compliance-records. Extraído de compliance.py (que ya tenía 982 líneas)
para poder crecer con la configuración de condiciones y el recálculo sin
seguir engordando ese archivo.
"""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.compliance import RequirementOption
from ..schemas.requirement import RecalcPreview, RecalcResult, RequirementConditionsPatchBody
from ..services.audit import log_change
from ..services.requirement_conditions import calcular_diferencias

requirements_router = APIRouter(prefix="/compliance-requirements", tags=["compliance"])


@requirements_router.get("", response_model=list[RequirementOption])
async def list_compliance_requirements(
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Tipos de documento del catálogo, opcionalmente acotados a un tipo de
    entidad. Solo lectura: administrar el catálogo requiere migración (ver
    HU-05 de la épica Red de Transporte)."""
    rows = await pool.fetch(
        """
        SELECT id::text, target_entity, requirement_code, name,
               requirement_level, COALESCE(has_expiration, false) AS has_expiration
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
    pool=Depends(get_pool), user=Depends(require_editor),
):
    """Cambia la regla, NO los registros. Aplicarla es un acto aparte
    (POST /recalc): guardar y aplicar son dos decisiones distintas."""
    if not body.sent_fields():
        raise HTTPException(422, "Ningún campo enviado")
    async with pool.acquire() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """
                UPDATE public.compliance_requirements SET
                    is_active = COALESCE($2, is_active),
                    applies_to_fleet_service_type_ids =
                        COALESCE($3::uuid[], applies_to_fleet_service_type_ids),
                    applies_to_management_types =
                        COALESCE($4::text[], applies_to_management_types)
                WHERE id = $1
                RETURNING id, requirement_code, is_active,
                          applies_to_fleet_service_type_ids, applies_to_management_types
                """,
                requirement_id, body.is_active,
                body.applies_to_fleet_service_type_ids, body.applies_to_management_types,
            )
            if not row:
                raise HTTPException(404, "Requisito no encontrado")
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="update", source="api",
            )
    return dict(row)


@requirements_router.get("/{requirement_id}/recalc-preview", response_model=RecalcPreview)
async def recalc_preview(
    requirement_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Sólo lectura. Sin esto la configuración miente: se cambia la regla y la
    pantalla sigue mostrando lo viejo."""
    d = await calcular_diferencias(pool, requirement_id)
    return {"crear": len(d["crear"]), "quitar": len(d["quitar"]), "bloqueados": len(d["bloqueados"])}


@requirements_router.post("/{requirement_id}/recalc", response_model=RecalcResult)
async def recalc(
    requirement_id: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    d = await calcular_diferencias(pool, requirement_id)
    req = await pool.fetchrow(
        "SELECT target_entity FROM public.compliance_requirements WHERE id = $1", requirement_id)
    if not req:
        raise HTTPException(404, "Requisito no encontrado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            if d["crear"]:
                await conn.execute(
                    """
                    INSERT INTO public.compliance_records
                        (entity_id, entity_type, requirement_id, status, is_current)
                    SELECT unnest($1::uuid[]), $2, $3, 'MISSING', true
                    ON CONFLICT (entity_id, requirement_id) DO NOTHING
                    """,
                    d["crear"], req["target_entity"], requirement_id,
                )
            if d["quitar"]:
                # Sólo los que la vista previa marcó como quitables. Los
                # bloqueados NO se tocan: D13.
                await conn.execute(
                    "DELETE FROM public.compliance_records WHERE id = ANY($1::uuid[])",
                    d["quitar"],
                )
            await log_change(
                conn, actor=user["sub"], entity_type="REQUIREMENT", entity_id=requirement_id,
                action="recalc", source="api",
            )
    return {"creados": len(d["crear"]), "quitados": len(d["quitar"]),
            "bloqueados": len(d["bloqueados"])}
