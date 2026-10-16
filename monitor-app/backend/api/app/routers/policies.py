"""Módulo Seguros — backend sobre public.insurance_* (H2.3). Reemplaza al
insurance.py de Checkpoint A-E (columnas planas coverage/plate, borrado
2026-07-16) con el modelo M:N real (policy_coverages/policy_assets). Prefix
/policies (recurso propio, consistente con /carriers /drivers /assets /contacts).
"""
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..auth import get_current_user, get_supabase
from ..authz import Permission, require
from ..db import get_pool
from ..schemas.insurance import (
    InsurancePolicyPatchBody,
    InstallmentsAppendBody, PolicyAssetLinkBody, PolicyCancelBody, PolicyCoverageLinkBody, PolicyExtendBody,
    PolicyRenewBody, PolicyRenewedByBody,
)
from ..services import insurance
from ..services.audit import log_change, record_manual_edit
from ..utils.document_storage import (
    delete_document_version, log_document_replacement, resolve_signed_url, upload_document_version,
)

router = APIRouter(prefix="/policies", tags=["insurance"])


async def _assemble_policy_detail(policy_id: str, pool, supabase=None) -> dict:
    policy = await pool.fetchrow(
        """
        SELECT id, carrier_id, insurance_company, policy_number, valid_from, valid_to,
               policy_document_url, has_endorsement, endorsement_number, endorsement_document_url,
               external_portal_url, cancelled_at, cancelled_reason, is_manual_override, created_at, updated_at,
               renews_policy_id,
               (SELECT s.id FROM public.insurance_policies s WHERE s.renews_policy_id = p.id) AS renewed_by_policy_id,
               (SELECT c.business_name FROM public.carriers c WHERE c.id = p.carrier_id) AS carrier_name
        FROM public.insurance_policies p WHERE id = $1
        """,
        policy_id,
    )
    if not policy:
        raise HTTPException(404, "Póliza no encontrada")

    coverages = await pool.fetch(
        """
        SELECT ct.id AS coverage_type_id, ct.code, ct.name
        FROM public.policy_coverages pc JOIN public.coverage_types ct ON ct.id = pc.coverage_type_id
        WHERE pc.policy_id = $1 ORDER BY ct.name
        """,
        policy_id,
    )
    assets = await pool.fetch(
        """
        SELECT a.id AS asset_id, a.license_plate, a.asset_type
        FROM public.policy_assets pa JOIN public.assets a ON a.id = pa.asset_id
        WHERE pa.policy_id = $1 ORDER BY a.license_plate
        """,
        policy_id,
    )
    # El estado de la póliza y de cada cuota sale de la vista (una sola regla).
    state = await insurance.policy_state(pool, policy_id) or {"policy_state": None, "expires_in_days": None}
    result = {
        **dict(policy),
        **state,
        "coverages": [dict(c) for c in coverages],
        "assets": [dict(a) for a in assets],
        "installments": await insurance.policy_installments(pool, policy_id),
        # Extender vigencia (Seguros E2): el historial de prórrogas.
        "term_changes": await insurance.term_changes(pool, policy_id),
    }
    # policy_document_url/endorsement_document_url guardan el storage_path
    # crudo (ver upload_policy_file) — firmarlos antes de devolverlos.
    if supabase is not None:
        result["policy_document_url"] = resolve_signed_url(supabase, result["policy_document_url"])
        result["endorsement_document_url"] = resolve_signed_url(supabase, result["endorsement_document_url"])
    return result


@router.get("")
async def list_policies(
    group_by: str = Query("policy", pattern="^(policy|carrier)$"),
    state: str = Query(""),
    q: str = Query(""),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    pool=Depends(get_pool),
    _=Depends(require(Permission.INSURANCE_READ)),
):
    """La lista de Seguros › Pólizas: por póliza o por empresa (incluye las activas sin póliza)."""
    if group_by == "carrier":
        if state and state not in insurance.CARRIER_STATES:
            raise HTTPException(422, "state inválido")
        return await insurance.list_carriers(pool, state=state, q=q, page=page, limit=limit)
    if state and state not in insurance.POLICY_FILTERS:
        raise HTTPException(422, "state inválido")
    return await insurance.list_policies(pool, state=state, q=q, page=page, limit=limit)


@router.get("/{policy_id}")
async def get_policy(
    policy_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(require(Permission.INSURANCE_READ)),
):
    return await _assemble_policy_detail(policy_id, pool, supabase)


@router.patch("/{policy_id}")
async def patch_policy(
    policy_id: str, body: InsurancePolicyPatchBody, pool=Depends(get_pool),
    supabase=Depends(get_supabase), user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                """
                SELECT updated_at, carrier_id, insurance_company, policy_number, valid_from, valid_to,
                       has_endorsement, endorsement_number, external_portal_url
                FROM public.insurance_policies WHERE id = $1
                """,
                policy_id,
            )
            if not current:
                raise HTTPException(404, "Póliza no encontrada")
            if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
                raise HTTPException(409, "El registro fue modificado por otro usuario; recargue e intente de nuevo")

            fields = ("insurance_company", "policy_number", "valid_from", "valid_to",
                      "has_endorsement", "endorsement_number", "external_portal_url")
            touched = [f for f in fields if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.insurance_policies SET
                    insurance_company = COALESCE($2, insurance_company),
                    policy_number = COALESCE($3, policy_number),
                    valid_from = COALESCE($4, valid_from),
                    valid_to = COALESCE($5, valid_to),
                    has_endorsement = COALESCE($6, has_endorsement),
                    endorsement_number = COALESCE($7, endorsement_number),
                    external_portal_url = COALESCE($8, external_portal_url),
                    updated_at = NOW()
                WHERE id = $1
                """,
                policy_id, body.insurance_company, body.policy_number, body.valid_from,
                body.valid_to, body.has_endorsement, body.endorsement_number, body.external_portal_url,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="insurance_policies", where={"id": policy_id}, actor=user["sub"],
                    entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                    action="update", field=field, old_value=current[field], new_value=getattr(body, field),
                )
    return await _assemble_policy_detail(policy_id, pool, supabase)


@router.delete("/{policy_id}")
async def delete_policy(
    policy_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require(Permission.POLICIES_DELETE)),
):
    """Borra la póliza completa (coverages/assets/installments caen por
    ON DELETE CASCADE). Borra también los archivos físicos en Storage si
    existen — sin esto quedarían blobs huérfanos sin ninguna fila que
    los referencie."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT carrier_id, insurance_company, policy_number, policy_document_url, "
                "endorsement_document_url FROM public.insurance_policies WHERE id = $1",
                policy_id,
            )
            if not current:
                raise HTTPException(404, "Póliza no encontrada")

            for storage_path in (current["policy_document_url"], current["endorsement_document_url"]):
                if storage_path:
                    delete_document_version(supabase, storage_path)

            await conn.execute("DELETE FROM public.insurance_policies WHERE id = $1", policy_id)
            await log_change(
                conn, actor=user["sub"], entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                action="delete", field="insurance_policy",
                old_value=f'{current["insurance_company"]} / {current["policy_number"]}', source="api",
            )
    return {"ok": True}


@router.post("/{policy_id}/coverages", status_code=201)
async def link_coverage(
    policy_id: str, body: PolicyCoverageLinkBody, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.insurance_policies WHERE id = $1", policy_id):
                raise HTTPException(404, "Póliza no encontrada")
            if not await conn.fetchval("SELECT 1 FROM public.coverage_types WHERE id = $1", body.coverage_type_id):
                raise HTTPException(404, "Tipo de cobertura no encontrado")
            await conn.execute(
                "INSERT INTO public.policy_coverages (policy_id, coverage_type_id) VALUES ($1, $2) "
                "ON CONFLICT (policy_id, coverage_type_id) DO NOTHING",
                policy_id, body.coverage_type_id,
            )
            await log_change(
                conn, actor=user["sub"], entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                action="link_coverage", new_value=body.coverage_type_id, source="api",
            )
    return {"ok": True}


@router.delete("/{policy_id}/coverages/{coverage_type_id}")
async def unlink_coverage(
    policy_id: str, coverage_type_id: str, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "DELETE FROM public.policy_coverages WHERE policy_id = $1 AND coverage_type_id = $2",
                policy_id, coverage_type_id,
            )
            if result == "DELETE 0":
                raise HTTPException(404, "Vínculo no encontrado")
            await log_change(
                conn, actor=user["sub"], entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                action="unlink_coverage", old_value=coverage_type_id, source="api",
            )
    return {"ok": True}


@router.post("/{policy_id}/assets", status_code=201)
async def link_asset(
    policy_id: str, body: PolicyAssetLinkBody, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.insurance_policies WHERE id = $1", policy_id):
                raise HTTPException(404, "Póliza no encontrada")
            if not await conn.fetchval("SELECT 1 FROM public.assets WHERE id = $1", body.asset_id):
                raise HTTPException(404, "Activo no encontrado")
            await conn.execute(
                "INSERT INTO public.policy_assets (policy_id, asset_id) VALUES ($1, $2) "
                "ON CONFLICT (policy_id, asset_id) DO NOTHING",
                policy_id, body.asset_id,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=body.asset_id,
                action="link_policy", new_value=policy_id, source="api",
            )
    return {"ok": True}


@router.delete("/{policy_id}/assets/{asset_id}")
async def unlink_asset(
    policy_id: str, asset_id: str, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "DELETE FROM public.policy_assets WHERE policy_id = $1 AND asset_id = $2",
                policy_id, asset_id,
            )
            if result == "DELETE 0":
                raise HTTPException(404, "Vínculo no encontrado")
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=asset_id,
                action="unlink_policy", old_value=policy_id, source="api",
            )
    return {"ok": True}


@router.get("/{policy_id}/installments")
async def list_installments(policy_id: str, pool=Depends(get_pool), _=Depends(require(Permission.INSURANCE_READ))):
    """Las cuotas de una póliza, con su estado calculado (app.insurance_status)."""
    return await insurance.policy_installments(pool, policy_id)


@router.post("/{policy_id}/renew", status_code=201)
async def renew_policy(
    policy_id: str, body: PolicyRenewBody, pool=Depends(get_pool), supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Renovar: crea la póliza nueva con los datos de esta; esta queda renovada."""
    if body.valid_to <= body.valid_from:
        raise HTTPException(422, "La vigencia termina antes de empezar")
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                new_id = await insurance.renew_policy(conn, policy_id, valid_from=body.valid_from, valid_to=body.valid_to,
                                                      policy_number=body.policy_number,
                                                      insurance_company=body.insurance_company, actor=user["sub"])
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
    return await _assemble_policy_detail(str(new_id), pool, supabase)


@router.get("/{policy_id}/renewal-candidates")
async def renewal_candidates(policy_id: str, pool=Depends(get_pool), _=Depends(require(Permission.INSURANCE_READ))):
    """Pólizas de la misma empresa que podrían haber renovado a esta (la ficha pregunta; nada se enlaza solo)."""
    return await insurance.renewal_candidates(pool, policy_id)


@router.post("/{policy_id}/renewed-by")
async def link_renewal(
    policy_id: str, body: PolicyRenewedByBody, pool=Depends(get_pool), supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                await insurance.link_renewal(conn, policy_id, body.successor_id, actor=user["sub"])
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(409, str(exc)) from exc
    return await _assemble_policy_detail(policy_id, pool, supabase)


@router.post("/{policy_id}/extend")
async def extend_policy(
    policy_id: str, body: PolicyExtendBody, pool=Depends(get_pool), supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Prórroga por endoso: nueva fecha de término, guardada en el historial de vigencia."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                await insurance.extend_policy(conn, policy_id, valid_to=body.valid_to,
                                              endorsement_number=body.endorsement_number,
                                              endorsement_date=body.endorsement_date, actor=user["sub"])
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc
    return await _assemble_policy_detail(policy_id, pool, supabase)


@router.post("/{policy_id}/installments/append", status_code=201)
async def append_installments(
    policy_id: str, body: InstallmentsAppendBody, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Cuotas nuevas a continuación de las existentes, dentro de la vigencia."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                return await insurance.append_installments(conn, policy_id, count=body.count, amount_uf=body.amount_uf,
                                                           first_due_date=body.first_due_date, actor=user["sub"])
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
            except ValueError as exc:
                raise HTTPException(422, str(exc)) from exc


@router.post("/{policy_id}/cancel")
async def cancel_policy(
    policy_id: str, body: PolicyCancelBody, pool=Depends(get_pool), supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Cancelar es el único estado de la póliza que decide una persona: fecha y motivo."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            try:
                await insurance.cancel_policy(conn, policy_id, reason=body.reason, actor=user["sub"])
            except LookupError as exc:
                raise HTTPException(404, str(exc)) from exc
    return await _assemble_policy_detail(policy_id, pool, supabase)


@router.post("/{policy_id}/file", status_code=201)
async def upload_policy_file(
    policy_id: str,
    file: UploadFile = File(...),
    kind: str = "document",
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Sube el archivo físico de la póliza (kind='document', policy_document_url)
    o del endoso (kind='endorsement', endorsement_document_url) — gap real
    encontrado 2026-07-16: la vista de estado ya calculaba
    missing_physical_file pero no existía forma de subir el archivo."""
    if kind not in ("document", "endorsement"):
        raise HTTPException(422, "kind debe ser 'document' o 'endorsement'")
    column = "policy_document_url" if kind == "document" else "endorsement_document_url"

    current = await pool.fetchrow(
        f"SELECT carrier_id, {column} AS current_path FROM public.insurance_policies WHERE id = $1",
        policy_id,
    )
    if not current:
        raise HTTPException(404, "Póliza no encontrada")

    key_prefix = f"policy/{policy_id}/{kind}"
    uploaded = await upload_document_version(supabase, key_prefix=key_prefix, file=file)
    old_storage_path = current["current_path"]

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                f"""
                UPDATE public.insurance_policies SET
                    {column} = $2,
                    updated_at = NOW()
                WHERE id = $1
                """,
                policy_id, uploaded["storage_path"],
            )
            await record_manual_edit(
                conn, table="insurance_policies", where={"id": policy_id}, actor=user["sub"],
                entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                action="document_upload", field=column,
                old_value=old_storage_path, new_value=uploaded["storage_path"],
            )
            if old_storage_path:
                await log_document_replacement(
                    conn, entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                    doc_name=f"policy:{policy_id}:{kind}",
                    old_status=None, old_expiry_date=None,
                    old_storage_path=old_storage_path, actor=user["sub"],
                )

    return {"kind": kind, **uploaded}


@router.delete("/{policy_id}/file")
async def delete_policy_file(
    policy_id: str,
    kind: str = "document",
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require(Permission.POLICIES_EDIT)),
):
    """Borra el archivo físico de la póliza o del endoso — mismo criterio
    que delete_compliance_file, sin estado intermedio."""
    if kind not in ("document", "endorsement"):
        raise HTTPException(422, "kind debe ser 'document' o 'endorsement'")
    column = "policy_document_url" if kind == "document" else "endorsement_document_url"

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"SELECT carrier_id, {column} AS current_path FROM public.insurance_policies WHERE id = $1",
                policy_id,
            )
            if not current:
                raise HTTPException(404, "Póliza no encontrada")
            storage_path = current["current_path"]
            if not storage_path:
                raise HTTPException(422, "Esta póliza no tiene ningún archivo cargado")

            delete_document_version(supabase, storage_path)

            await conn.execute(
                f"""
                UPDATE public.insurance_policies SET
                    {column} = NULL,
                    updated_at = NOW()
                WHERE id = $1
                """,
                policy_id,
            )
            await record_manual_edit(
                conn, table="insurance_policies", where={"id": policy_id}, actor=user["sub"],
                entity_type=insurance.AUDIT_ENTITY, entity_id=policy_id,
                action="document_delete", field=column,
                old_value=storage_path, new_value=None,
            )

    return await _assemble_policy_detail(policy_id, pool, supabase)
