"""public.drivers — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.contact import ContactCreateBody
from ..schemas.driver import DriverCreateBody, DriverPatchBody
from ..services.audit import log_change, record_manual_edit
from ..utils.document_storage import resolve_signed_url

router = APIRouter(prefix="/drivers", tags=["drivers"])


@router.get("/{driver_id}")
async def get_driver(driver_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        SELECT d.id, d.tax_id, d.country_code, d.full_name, d.operational_status,
               d.is_manual_override, d.created_at,
               dcs.total_requirements, dcs.last_document_update
        FROM public.drivers d
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = d.id
        WHERE d.id = $1
        """,
        driver_id,
    )
    if not row:
        raise HTTPException(404, "Conductor no encontrado")
    return dict(row)


@router.post("", status_code=201)
async def create_driver(body: DriverCreateBody, pool=Depends(get_pool), user=Depends(require_editor)):
    """Alta de conductor como master data (sin asignar a ninguna empresa
    todavía) — trg_reconcile_new_driver siembra los compliance_records
    MISSING al insertar. Para asignarlo a una empresa, POST /carriers/{id}/drivers."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchval("SELECT id FROM public.drivers WHERE tax_id = $1", body.tax_id)
            if existing:
                raise HTTPException(409, f"Ya existe un conductor con tax_id {body.tax_id}")
            row = await conn.fetchrow(
                """
                INSERT INTO public.drivers (tax_id, country_code, full_name, operational_status)
                VALUES ($1, $2, $3, $4)
                RETURNING id, tax_id, country_code, full_name, operational_status, created_at
                """,
                body.tax_id, body.country_code, body.full_name, body.operational_status,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="DRIVER", entity_id=row["id"],
                action="create", source="api",
            )
    return dict(row)


@router.patch("/{driver_id}")
async def patch_driver(
    driver_id: str, body: DriverPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT full_name, operational_status FROM public.drivers WHERE id = $1", driver_id,
            )
            if not current:
                raise HTTPException(404, "Conductor no encontrado")

            touched = [f for f in ("full_name", "operational_status") if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.drivers SET
                    full_name = COALESCE($2, full_name),
                    operational_status = COALESCE($3, operational_status)
                WHERE id = $1
                """,
                driver_id, body.full_name, body.operational_status,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="drivers", where={"id": driver_id}, actor=user["sub"],
                    entity_type="DRIVER", entity_id=driver_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )
    return await get_driver(driver_id, pool, user)


@router.get("/{driver_id}/compliance-records")
async def list_driver_compliance_records(
    driver_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    """Checklist itemizado del conductor — mismo shape que el anidado en
    GET /carriers/{id} (_assemble_carrier_detail), filtrado a DRIVER."""
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
        WHERE cr.entity_id = $1 AND cr.entity_type = 'DRIVER' AND cr.is_current = true
        ORDER BY req.requirement_level, req.name
        """,
        driver_id,
    )
    records = [dict(r) for r in rows]
    for record in records:
        record["file_url"] = resolve_signed_url(supabase, record["file_url"])
    return records


# ── Contactos (polimórfico — alta anidada bajo driver, edición flat en routers/contacts.py) ──

@router.get("/{driver_id}/contacts")
async def list_driver_contacts(driver_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active "
        "FROM public.contacts WHERE entity_type = 'DRIVER' AND entity_id = $1 AND is_active = true "
        "ORDER BY is_primary DESC, contact_role",
        driver_id,
    )
    return [dict(r) for r in rows]


@router.post("/{driver_id}/contacts", status_code=201)
async def create_driver_contact(
    driver_id: str, body: ContactCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    if body.entity_type != "DRIVER" or body.entity_id != driver_id:
        raise HTTPException(422, "entity_type/entity_id del body deben coincidir con la ruta")
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.drivers WHERE id = $1", driver_id):
                raise HTTPException(404, "Conductor no encontrado")
            row = await conn.fetchrow(
                """
                INSERT INTO public.contacts
                    (entity_id, entity_type, contact_role, first_name, last_name, job_title, email, phone, is_primary)
                VALUES ($1, 'DRIVER', $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active
                """,
                driver_id, body.contact_role, body.first_name, body.last_name,
                body.job_title, body.email, body.phone, body.is_primary,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="DRIVER", entity_id=driver_id,
                action="create", field="contact", new_value=body.contact_role, source="api",
            )
    return dict(row)
