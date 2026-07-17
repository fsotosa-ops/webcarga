"""public.assets — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.asset import AssetCreateBody, AssetPatchBody
from ..services.audit import log_change, record_manual_edit

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/{asset_id}")
async def get_asset(asset_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        SELECT a.id, a.license_plate, a.asset_type, a.operational_status,
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
                INSERT INTO public.assets (license_plate, asset_type, operational_status)
                VALUES ($1, $2, $3)
                RETURNING id, license_plate, asset_type, operational_status, created_at
                """,
                body.license_plate, body.asset_type, body.operational_status,
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
                "SELECT asset_type, operational_status FROM public.assets WHERE id = $1", asset_id,
            )
            if not current:
                raise HTTPException(404, "Activo no encontrado")

            touched = [f for f in ("asset_type", "operational_status") if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.assets SET
                    asset_type = COALESCE($2, asset_type),
                    operational_status = COALESCE($3, operational_status)
                WHERE id = $1
                """,
                asset_id, body.asset_type, body.operational_status,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="assets", where={"id": asset_id}, actor=user["sub"],
                    entity_type="ASSET", entity_id=asset_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
    return await get_asset(asset_id, pool, user)
