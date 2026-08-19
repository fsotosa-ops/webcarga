"""public.assets — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.asset import AssetCreateBody, AssetPatchBody
from ..services.audit import log_change, record_manual_edit
from ..services.vencimientos import por_vencer_predicate, vencido_predicate
from ..utils.document_storage import resolve_signed_url

router = APIRouter(prefix="/assets", tags=["assets"])


@router.get("/{asset_id}")
async def get_asset(asset_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        SELECT a.id, a.license_plate, a.asset_type, a.operational_status, a.manufacture_year,
               a.is_manual_override, a.created_at,
               a.fleet_service_type_id, acs.fleet_service_type_label,
               acs.fleet_service_type_bg_color, acs.fleet_service_type_text_color,
               acs.total_requirements, acs.last_document_update,
               -- Ver el comentario equivalente en routers/drivers.py.
               c.id::text      AS carrier_id,
               c.business_name AS carrier_name
        FROM public.assets a
        LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = a.id
        LEFT JOIN public.asset_assignments aa
               ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = aa.carrier_id
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
            # `is_manual_override` se marca SÓLO si una persona declaró la
            # clasificación: es lo único que hay que proteger de la ingesta.
            # Marcarlo siempre dejaría a Mage sin poder clasificar los
            # vehículos que nadie clasificó, que son la mayoría.
            row = await conn.fetchrow(
                """
                INSERT INTO public.assets
                    (license_plate, asset_type, operational_status, manufacture_year,
                     is_manual_override, overridden_by, overridden_at,
                     fleet_service_type_id, webcarga_operation_type_id)
                VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $5 THEN NOW() END, $7, $8)
                RETURNING id, license_plate, asset_type, operational_status, manufacture_year,
                          created_at, fleet_service_type_id, webcarga_operation_type_id,
                          is_manual_override
                """,
                body.license_plate, body.asset_type, body.operational_status, body.manufacture_year,
                body.declara_clasificacion(),
                user["sub"] if body.declara_clasificacion() else None,
                body.fleet_service_type_id, body.webcarga_operation_type_id,
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
                "SELECT asset_type, operational_status, manufacture_year, "
                "fleet_service_type_id, webcarga_operation_type_id "
                "FROM public.assets WHERE id = $1", asset_id,
            )
            if not current:
                raise HTTPException(404, "Activo no encontrado")

            touched = [
                f for f in (
                    "asset_type", "operational_status", "manufacture_year",
                    "fleet_service_type_id", "webcarga_operation_type_id",
                ) if getattr(body, f) is not None
            ]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.assets SET
                    asset_type = COALESCE($2, asset_type),
                    operational_status = COALESCE($3, operational_status),
                    manufacture_year = COALESCE($4, manufacture_year),
                    fleet_service_type_id = COALESCE($5::uuid, fleet_service_type_id),
                    webcarga_operation_type_id = COALESCE($6::uuid, webcarga_operation_type_id)
                WHERE id = $1
                """,
                asset_id, body.asset_type, body.operational_status, body.manufacture_year,
                body.fleet_service_type_id, body.webcarga_operation_type_id,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="assets", where={"id": asset_id}, actor=user["sub"],
                    entity_type="ASSET", entity_id=asset_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
    return await get_asset(asset_id, pool, user)


@router.get("/{asset_id}/driver-assignment")
async def get_asset_driver_assignment(
    asset_id: str, pool=Depends(get_pool), _=Depends(get_current_user),
):
    """Conductor habitual actualmente asignado a este vehículo (Fase 1 del
    hardening del Diario, 2026-07-18) — ver POST para el porqué."""
    row = await pool.fetchrow(
        """
        SELECT va.id, va.driver_id, d.full_name AS driver_name, va.start_date
        FROM public.vehicle_driver_assignments va
        JOIN public.drivers d ON d.id = va.driver_id
        WHERE va.asset_id = $1 AND va.status = 'ACTIVE'
        """,
        asset_id,
    )
    return dict(row) if row else None


@router.post("/{asset_id}/driver-assignment", status_code=201)
async def assign_driver_to_asset(
    asset_id: str, body: dict, pool=Depends(get_pool), user=Depends(require_editor),
):
    """Asigna el conductor habitual de este vehículo. Reemplaza la
    dependencia de bronze.raw_bd_ot (bootstrap histórico de una sola vez,
    migración 20260718060000) para viajes NUEVOS: el Diario resuelve
    driver_id automáticamente vía esta tabla cuando un viaje reporta la
    patente de este activo (routers/trips.py, _TRIP_FROM) — operaciones
    asigna el conductor UNA vez por vehículo, no viaje por viaje."""
    driver_id = body.get("driver_id")
    if not driver_id:
        raise HTTPException(422, "driver_id requerido")
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.assets WHERE id = $1", asset_id):
                raise HTTPException(404, "Activo no encontrado")
            if not await conn.fetchval("SELECT 1 FROM public.drivers WHERE id = $1", driver_id):
                raise HTTPException(404, "Conductor no encontrado")

            # Desactivar la asignación ACTIVE previa de este vehículo (a
            # cualquier conductor) antes de insertar la nueva — el índice
            # único parcial (asset_id WHERE status='ACTIVE') exige que no
            # convivan dos activas para el mismo vehículo.
            await conn.execute(
                """
                UPDATE public.vehicle_driver_assignments
                SET status = 'INACTIVE'
                WHERE asset_id = $1 AND status = 'ACTIVE'
                """,
                asset_id,
            )
            await conn.execute(
                """
                INSERT INTO public.vehicle_driver_assignments
                    (asset_id, driver_id, status, is_manual_override, source,
                     overridden_by, overridden_at)
                VALUES ($1, $2, 'ACTIVE', true, 'manual', $3, now())
                ON CONFLICT (asset_id, driver_id) DO UPDATE
                    SET status = 'ACTIVE', is_manual_override = true,
                        -- `source` va JUNTO con is_manual_override: la
                        -- restriccion vda_source_matches_manual_flag exige que
                        -- digan lo mismo. Sin esto, reasignar a mano un
                        -- vehiculo que venia del padron reventaba.
                        source = 'manual', end_date = NULL,
                        overridden_by = $3, overridden_at = now()
                """,
                asset_id, driver_id, user["sub"],
            )
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=asset_id,
                action="assign_driver", field="driver_id", new_value=driver_id, source="api",
            )
    return {"ok": True}


@router.delete("/{asset_id}/driver-assignment")
async def unassign_driver_from_asset(
    asset_id: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                """
                UPDATE public.vehicle_driver_assignments
                SET status = 'INACTIVE'
                WHERE asset_id = $1 AND status = 'ACTIVE'
                """,
                asset_id,
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Asignación activa no encontrada")
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=asset_id,
                action="unassign_driver", source="api",
            )
    return {"ok": True}


@router.get("/{asset_id}/compliance-records")
async def list_asset_compliance_records(
    asset_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    """Checklist itemizado del activo — mismo shape que el anidado en
    GET /carriers/{id} (_assemble_carrier_detail), filtrado a ASSET."""
    rows = await pool.fetch(
        f"""
        SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
               req.requires_file, req.expiration_policy,
               cr.status, cr.expiration_date, cr.file_url, cr.metadata,
               cr.is_manual_override, cr.updated_at,
               {vencido_predicate('cr')} AS is_expired,
               {por_vencer_predicate('cr')} AS is_expiring_soon
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
