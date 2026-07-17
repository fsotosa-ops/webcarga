"""public.assets — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.asset import AssetCreateBody, AssetPatchBody
from ..services.audit import log_change, record_manual_edit
from ..utils.document_storage import resolve_signed_url

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/{asset_id}")
async def get_asset(asset_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        SELECT a.id, a.license_plate, a.asset_type, a.operational_status, a.manufacture_year,
               a.is_manual_override, a.created_at,
               acs.total_requirements, acs.last_document_update
        FROM public.assets a
        LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = a.id
        WHERE a.id = $1
        """,
        asset_id,
    )
    if not row:
        raise HTTPException(404, "Activo no encontrado")
    return dict(row)


@router.post("", status_code=201)
async def create_asset(body: AssetCreateBody, pool=Depends(get_pool), user=Depends(require_editor)):
    """Alta de vehículo/rampla como master data — trg_reconcile_new_asset
    siembra los compliance_records MISSING al insertar."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchval(
                "SELECT id FROM public.assets WHERE license_plate = $1", body.license_plate,
            )
            if existing:
                raise HTTPException(409, f"Ya existe un activo con patente {body.license_plate}")
            row = await conn.fetchrow(
                """
                INSERT INTO public.assets (license_plate, asset_type, operational_status, manufacture_year)
                VALUES ($1, $2, $3, $4)
                RETURNING id, license_plate, asset_type, operational_status, manufacture_year, created_at
                """,
                body.license_plate, body.asset_type, body.operational_status, body.manufacture_year,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=row["id"],
                action="create", source="api",
            )
    return dict(row)


@router.patch("/{asset_id}")
async def patch_asset(
    asset_id: str, body: AssetPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT asset_type, operational_status, manufacture_year FROM public.assets WHERE id = $1", asset_id,
            )
            if not current:
                raise HTTPException(404, "Activo no encontrado")

            touched = [f for f in ("asset_type", "operational_status", "manufacture_year") if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.assets SET
                    asset_type = COALESCE($2, asset_type),
                    operational_status = COALESCE($3, operational_status),
                    manufacture_year = COALESCE($4, manufacture_year)
                WHERE id = $1
                """,
                asset_id, body.asset_type, body.operational_status, body.manufacture_year,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="assets", where={"id": asset_id}, actor=user["sub"],
                    entity_type="ASSET", entity_id=asset_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
    return await get_asset(asset_id, pool, user)


@router.get("/{asset_id}/compliance-records")
async def list_asset_compliance_records(
    asset_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    """Checklist itemizado del activo — mismo shape que el anidado en
    GET /carriers/{id} (_assemble_carrier_detail), filtrado a ASSET."""
    rows = await pool.fetch(
        """
        SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
               req.requires_file, cr.status, cr.expiration_date, cr.file_url, cr.metadata,
               cr.is_manual_override, cr.updated_at,
               (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE) AS is_expired,
               (cr.expiration_date IS NOT NULL AND cr.expiration_date >= CURRENT_DATE
                AND cr.expiration_date <= CURRENT_DATE + INTERVAL '30 days') AS is_expiring_soon
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.entity_id = $1 AND cr.entity_type = 'ASSET' AND cr.is_current = true
        ORDER BY req.requirement_level, req.name
        """,
        asset_id,
    )
    records = [dict(r) for r in rows]
    for record in records:
        record["file_url"] = resolve_signed_url(supabase, record["file_url"])
    return records
