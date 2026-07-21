"""public.compliance_records — PATCH libre de status/expiration_date +
endpoint de archivos (H2.4). El upload es el "camino feliz" real: a
diferencia de la implementación vieja (solo persiste storage_path plano y
nunca transiciona status), este SIEMPRE deja status='APPROVED_MANUAL' y
persiste la evidencia en el JSONB metadata — ver context_carriers.md §4.2.
No existe un proceso de due diligence separado del negocio hoy: quien sube
el archivo ya lo revisó, no queda un estado intermedio "en revisión"
(decisión explícita del usuario 2026-07-18) — PENDING_REVIEW sigue siendo
un valor válido del CHECK constraint (datos legacy), pero nada nuevo lo
setea.
"""
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.compliance import ComplianceRecordPatchBody
from ..services.audit import record_manual_edit
from ..utils.document_storage import (
    delete_document_version, get_document_history, log_document_replacement, resolve_signed_url,
    upload_document_version,
)

router = APIRouter(prefix="/compliance-records", tags=["compliance"])


async def _fetch_record(record_id: str, pool, supabase=None) -> dict:
    row = await pool.fetchrow(
        """
        SELECT cr.id, cr.entity_id, cr.entity_type, cr.requirement_id, req.requirement_code, req.name,
               req.requirement_level, req.requires_file, cr.status, cr.expiration_date, cr.file_url,
               cr.metadata, cr.is_manual_override, cr.created_at, cr.updated_at
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.id = $1 AND cr.is_current = true
        """,
        record_id,
    )
    if not row:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")
    record = dict(row)
    # file_url guarda el storage_path crudo (ver upload_compliance_file) — el
    # bucket no es público, hay que firmarlo antes de devolverlo al frontend.
    if supabase is not None:
        record["file_url"] = resolve_signed_url(supabase, record["file_url"])
    return record


@router.get("/pending-summary")
async def get_pending_summary(pool=Depends(get_pool), _=Depends(get_current_user)):
    """HU-08 (Fase 0, 2026-07-21): vista consolidada de documentos pendientes
    — hoy solo existía el conteo por empresa dentro de su propia ficha
    (`app.carrier_compliance_status`); Pablo pidió explícitamente en la
    reunión del 20/07 poder ver el total agregado y, desde ahí, ir directo a
    la empresa que le falta, "sin necesidad de entrar empresa por empresa".
    Los pendientes de DRIVER/ASSET se atribuyen a la empresa vía su
    asignación ACTIVE vigente (mismo criterio que el resto del roster) — sin
    asignación activa, ese pendiente queda fuera del agregado (no hay a qué
    empresa cargárselo)."""
    rows = await pool.fetch(
        """
        WITH pending AS (
            SELECT cr.entity_type, cr.entity_id, req.requirement_level
            FROM public.compliance_records cr
            JOIN public.compliance_requirements req ON req.id = cr.requirement_id
            WHERE cr.is_current = true AND cr.status IN ('MISSING', 'EXPIRED')
        ),
        attributed AS (
            SELECT
                p.requirement_level,
                CASE p.entity_type
                    WHEN 'CARRIER' THEN p.entity_id
                    WHEN 'DRIVER'  THEN da.carrier_id
                    WHEN 'ASSET'   THEN aa.carrier_id
                END AS carrier_id
            FROM pending p
            LEFT JOIN public.driver_assignments da
                ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
            LEFT JOIN public.asset_assignments aa
                ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
        )
        SELECT c.id AS carrier_id, c.business_name AS carrier_name, c.operational_status,
               count(*) AS pending_count,
               count(*) FILTER (WHERE a.requirement_level = 'LEGAL_MANDATORY') AS pending_mandatory
        FROM attributed a
        JOIN public.carriers c ON c.id = a.carrier_id
        GROUP BY c.id, c.business_name, c.operational_status
        ORDER BY pending_count DESC
        """
    )
    carriers = [dict(r) for r in rows]
    return {
        "total_pending": sum(c["pending_count"] for c in carriers),
        "total_pending_mandatory": sum(c["pending_mandatory"] for c in carriers),
        "carriers": carriers,
    }


@router.get("/{record_id}")
async def get_compliance_record(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    return await _fetch_record(record_id, pool, supabase)


@router.patch("/{record_id}")
async def patch_compliance_record(
    record_id: str, body: ComplianceRecordPatchBody, pool=Depends(get_pool),
    supabase=Depends(get_supabase), user=Depends(require_editor),
):
    """Override manual libre (ej. un admin aprueba a mano sin archivo). Para
    subir evidencia real, usar POST /{record_id}/file — ese fuerza
    APPROVED_MANUAL en vez de dejar setear cualquier status a mano."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT entity_id, entity_type, status, expiration_date FROM public.compliance_records "
                "WHERE id = $1 AND is_current = true",
                record_id,
            )
            if not current:
                raise HTTPException(404, "Registro de cumplimiento no encontrado")

            touched = [f for f in ("status", "expiration_date") if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = COALESCE($2, status),
                    expiration_date = COALESCE($3, expiration_date),
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id, body.status, body.expiration_date,
            )
            for field in touched:
                old = current[field]
                new = getattr(body, field)
                await record_manual_edit(
                    conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                    entity_type=current["entity_type"], entity_id=current["entity_id"],
                    action="update", field=field,
                    old_value=old.isoformat() if hasattr(old, "isoformat") else old,
                    new_value=new.isoformat() if hasattr(new, "isoformat") else new,
                )
    return await _fetch_record(record_id, pool, supabase)


@router.post("/{record_id}/file", status_code=201)
async def upload_compliance_file(
    record_id: str,
    file: UploadFile = File(...),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    current = await pool.fetchrow(
        "SELECT entity_id, entity_type, status, expiration_date, metadata FROM public.compliance_records "
        "WHERE id = $1 AND is_current = true",
        record_id,
    )
    if not current:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")

    key_prefix = f"{current['entity_type'].lower()}/{current['entity_id']}/{record_id}"
    uploaded = await upload_document_version(supabase, key_prefix=key_prefix, file=file)

    old_metadata = current["metadata"] or {}
    if isinstance(old_metadata, str):
        old_metadata = json.loads(old_metadata)
    old_storage_path = old_metadata.get("storage_path")
    new_metadata = {
        **old_metadata,
        "storage_path": uploaded["storage_path"],
        "file_name": uploaded["file_name"],
        "mime_type": uploaded["mime_type"],
        "size_bytes": uploaded["size_bytes"],
    }

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = 'APPROVED_MANUAL',
                    file_url = $2,
                    metadata = $3::jsonb,
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id, uploaded["storage_path"], json.dumps(new_metadata),
            )
            await record_manual_edit(
                conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                entity_type=current["entity_type"], entity_id=current["entity_id"],
                action="document_upload", field="status",
                old_value=current["status"], new_value="APPROVED_MANUAL",
            )
            if old_storage_path:
                await log_document_replacement(
                    conn, entity_type=current["entity_type"], entity_id=current["entity_id"],
                    doc_name=f"compliance_record:{record_id}",
                    old_status=current["status"], old_expiry_date=current["expiration_date"],
                    old_storage_path=old_storage_path, actor=user["sub"],
                )

    return {"status": "APPROVED_MANUAL", **uploaded}


@router.delete("/{record_id}/file")
async def delete_compliance_file(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    """Borra la evidencia cargada y vuelve el registro a MISSING — mismo
    estado que un documento nunca subido (decisión explícita del usuario
    2026-07-18, no queda un estado "archivado" intermedio)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT entity_id, entity_type, status, metadata FROM public.compliance_records "
                "WHERE id = $1 AND is_current = true",
                record_id,
            )
            if not current:
                raise HTTPException(404, "Registro de cumplimiento no encontrado")

            metadata = current["metadata"] or {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            storage_path = metadata.get("storage_path")
            if not storage_path:
                raise HTTPException(422, "Este registro no tiene ningún archivo cargado")

            delete_document_version(supabase, storage_path)

            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = 'MISSING',
                    file_url = NULL,
                    metadata = '{}'::jsonb,
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id,
            )
            await record_manual_edit(
                conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                entity_type=current["entity_type"], entity_id=current["entity_id"],
                action="document_delete", field="status",
                old_value=current["status"], new_value="MISSING",
            )
    return await _fetch_record(record_id, pool, supabase)


@router.get("/{record_id}/files")
async def list_compliance_files(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    current = await pool.fetchrow(
        "SELECT entity_id, entity_type, status, expiration_date, file_url, updated_at, overridden_by "
        "FROM public.compliance_records WHERE id = $1",
        record_id,
    )
    if not current:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")
    return await get_document_history(
        pool, supabase, entity_type=current["entity_type"], entity_id=current["entity_id"],
        doc_name=f"compliance_record:{record_id}",
        current_storage_path=current["file_url"],
        current_status=current["status"],
        current_expiry_date=current["expiration_date"],
        current_updated_at=current["updated_at"],
        current_actor=current["overridden_by"],
    )
