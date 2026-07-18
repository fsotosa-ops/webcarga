"""public.locations — catálogo de locales por generador de carga (H2.6,
fase "catálogo de locales"). Polimórfico (entity_type/entity_id, sin FK
real), mismo criterio que public.contacts/public.compliance_records.
Poblado inicialmente por upsert desde bronze.raw_shipper_locations
(20260717230000_public_locations_catalog.sql); este router cubre el
mantenimiento manual (alta, edición, baja lógica) — sin DELETE real, mismo
criterio que carriers (dar de baja vía operational_status)."""
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user, require_editor
from ..db import get_pool
from ..schemas.location import LocationCreateBody, LocationPatchBody
from ..services.audit import log_change

router = APIRouter(prefix="/locations", tags=["locations"])

_LOCATION_FIELDS = (
    "id, entity_type, entity_id, site_number, name, country_code, format, address, "
    "region_name, region_number, opens_at, closes_at, operation_type, "
    "operational_status, created_at, updated_at"
)


@router.get("")
async def list_locations(
    entity_type: str = Query("", description="Ej. SHIPPER"),
    entity_id: str = Query(""),
    q: str = Query("", description="Buscar por nombre o N° de local"),
    operation_type: str = Query(""),
    operational_status: str = Query(""),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    clauses: list[str] = []
    params: list = []
    if entity_type:
        params.append(entity_type)
        clauses.append(f"entity_type = ${len(params)}")
    if entity_id:
        params.append(entity_id)
        clauses.append(f"entity_id = ${len(params)}")
    if q:
        params.append(q)
        clauses.append(f"(name ILIKE '%' || ${len(params)} || '%' OR site_number ILIKE '%' || ${len(params)} || '%')")
    if operation_type:
        params.append(operation_type)
        clauses.append(f"operation_type = ${len(params)}")
    if operational_status:
        params.append(operational_status)
        clauses.append(f"operational_status = ${len(params)}")
    else:
        clauses.append("operational_status = 'ACTIVE'")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    rows = await pool.fetch(
        f"SELECT {_LOCATION_FIELDS} FROM public.locations {where} ORDER BY name",
        *params,
    )
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_location(
    body: LocationCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            if body.entity_type == "SHIPPER" and not await conn.fetchval(
                "SELECT 1 FROM public.shippers WHERE id = $1", body.entity_id
            ):
                raise HTTPException(404, "Generador de carga no encontrado")

            existing = await conn.fetchval(
                "SELECT id FROM public.locations "
                "WHERE entity_type = $1 AND entity_id = $2 AND lower(name) = lower($3) "
                "AND site_number IS NOT DISTINCT FROM $4",
                body.entity_type, body.entity_id, body.name, body.site_number,
            )
            if existing:
                raise HTTPException(409, "Ya existe un local con ese nombre y N° para este generador de carga")

            row = await conn.fetchrow(
                f"""
                INSERT INTO public.locations
                    (entity_type, entity_id, site_number, name, country_code, format, address,
                     region_name, region_number, opens_at, closes_at, operation_type)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING {_LOCATION_FIELDS}
                """,
                body.entity_type, body.entity_id, body.site_number, body.name, body.country_code,
                body.format, body.address, body.region_name, body.region_number, body.opens_at,
                body.closes_at, body.operation_type,
            )
            await log_change(
                conn, actor=user["sub"], entity_type=body.entity_type, entity_id=body.entity_id,
                action="create", field="location", new_value=body.name, source="api",
            )
    return dict(row)


@router.patch("/{location_id}")
async def patch_location(
    location_id: str, body: LocationPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    touched = body.sent_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"SELECT {_LOCATION_FIELDS} FROM public.locations WHERE id = $1", location_id,
            )
            if not current:
                raise HTTPException(404, "Local no encontrado")

            await conn.execute(
                """
                UPDATE public.locations SET
                    name               = COALESCE($2, name),
                    site_number        = COALESCE($3, site_number),
                    country_code       = COALESCE($4, country_code),
                    format             = COALESCE($5, format),
                    address            = COALESCE($6, address),
                    region_name        = COALESCE($7, region_name),
                    region_number      = COALESCE($8, region_number),
                    opens_at           = COALESCE($9, opens_at),
                    closes_at          = COALESCE($10, closes_at),
                    operation_type     = COALESCE($11, operation_type),
                    operational_status = COALESCE($12, operational_status),
                    updated_at         = NOW()
                WHERE id = $1
                """,
                location_id, body.name, body.site_number, body.country_code, body.format,
                body.address, body.region_name, body.region_number, body.opens_at, body.closes_at,
                body.operation_type, body.operational_status,
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type=current["entity_type"], entity_id=current["entity_id"],
                    action="update", field=field, old_value=str(current[field]) if current[field] is not None else None,
                    new_value=str(getattr(body, field)), source="api",
                )

    row = await pool.fetchrow(f"SELECT {_LOCATION_FIELDS} FROM public.locations WHERE id = $1", location_id)
    return dict(row)
