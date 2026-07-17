"""public.drivers — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.driver import DriverCreateBody, DriverPatchBody
from ..services.audit import log_change, record_manual_edit

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
