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
from ..schemas.location_rate import LocationRateCreateBody, LocationRatePatchBody
from ..services.audit import log_change

router = APIRouter(prefix="/locations", tags=["locations"])

_LOCATION_FIELDS = (
    "id, entity_type, entity_id, site_number, name, country_code, format, address, "
    "region_name, region_number, opens_at, closes_at, operation_type, "
    "operational_status, is_manual_override, created_at, updated_at"
)


@router.get("")
async def list_locations(
    entity_type: str = Query("", description="Ej. SHIPPER"),
    entity_id: str = Query(""),
    q: str = Query("", description="Buscar por nombre o N° de local"),
    operation_type: str = Query(""),
    operational_status: str = Query(""),
    incomplete: str = Query("", description="true = solo locales sin clasificación (HU-16)"),
    needs_manual_classification: str = Query(
        "", description="true = sin región disponible en su historial de viajes, requiere elegir zona a mano "
                         "(Robustecer Tarifario 2026-07-27) — subconjunto de `incomplete`, no todo lo incompleto."),
    include_rate: str = Query("", description="true = agrega la tarifa vigente (Fase 5, Tarifario 1.0)"),
    # Ronda 43 (Fase C, Tarea 7): verificado contra datos reales antes de
    # agregar esto — el generador de carga con más volumen tiene 566 locales
    # activos (bien lejos de las "decenas" que hubieran hecho innecesaria la
    # paginación de servidor). limit tope 200 (no 100 como carriers/insurance)
    # porque acá no hay filtro de "solo pendientes" que reduzca el volumen
    # real visto de entrada.
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
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
    # HU-15/16 (Fase 4): "incompleto" no es una columna nueva — se deriva de
    # operation_type IS NULL, el mismo campo que ya decide "Sin clasificar"
    # en el Diario (trg_reconcile_new_trip_stop_location siembra locales sin
    # este dato). Suficiente para identificar qué falta completar sin
    # inventar un flag de completitud separado que se pueda desincronizar.
    if incomplete == "true":
        clauses.append("operation_type IS NULL")
    if needs_manual_classification == "true":
        clauses.append("operation_type IS NULL AND region_number IS NULL")
    if operational_status:
        params.append(operational_status)
        clauses.append(f"operational_status = ${len(params)}")
    else:
        clauses.append("operational_status = 'ACTIVE'")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""

    # Fase 5 (Tarifario 1.0): opt-in — el Diario y Configuración > Locales
    # no lo piden, sin cambio de comportamiento para ellos. "Vigente" se
    # calcula acá, no se almacena: valid_from <= hoy <= valid_to (o
    # valid_to NULL = vigente indefinidamente). public.locations.id (sin
    # alias) porque el FROM de esta consulta no alías la tabla.
    rate_select = ""
    rate_join = ""
    if include_rate == "true":
        rate_select = ", cr.tarifa AS current_rate, cr.valid_from AS current_rate_valid_from, cr.valid_to AS current_rate_valid_to"
        rate_join = """
            LEFT JOIN LATERAL (
                SELECT tarifa, valid_from, valid_to
                FROM public.location_rates lr
                WHERE lr.location_id = public.locations.id
                  AND lr.valid_from <= CURRENT_DATE
                  AND (lr.valid_to IS NULL OR lr.valid_to >= CURRENT_DATE)
                ORDER BY lr.valid_from DESC
                LIMIT 1
            ) cr ON true
        """

    offset = (page - 1) * limit
    lp, op = len(params) + 1, len(params) + 2

    rows = await pool.fetch(
        f"""
        SELECT {_LOCATION_FIELDS}{rate_select} FROM public.locations {rate_join} {where}
        ORDER BY name
        LIMIT ${lp} OFFSET ${op}
        """,
        *params, limit, offset,
    )
    count = await pool.fetchval(f"SELECT count(*) FROM public.locations {where}", *params)
    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}


_LOCATION_RATE_FIELDS = "id, location_id, tarifa, valid_from, valid_to, created_at, updated_at"


@router.get("/{location_id}/rates")
async def list_location_rates(location_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates "
        "WHERE location_id = $1 ORDER BY valid_from DESC",
        location_id,
    )
    return [dict(r) for r in rows]


@router.post("/{location_id}/rates", status_code=201)
async def create_location_rate(
    location_id: str, body: LocationRateCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            loc = await conn.fetchrow(
                "SELECT entity_type, entity_id FROM public.locations WHERE id = $1", location_id,
            )
            if not loc:
                raise HTTPException(404, "Local no encontrado")

            row = await conn.fetchrow(
                f"""
                INSERT INTO public.location_rates (location_id, tarifa, valid_from, valid_to, created_by)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING {_LOCATION_RATE_FIELDS}
                """,
                location_id, body.tarifa, body.valid_from, body.valid_to, user["sub"],
            )
            await log_change(
                conn, actor=user["sub"], entity_type=loc["entity_type"], entity_id=loc["entity_id"],
                action="create", field="location_rate", new_value=body.tarifa, source="api",
            )
    return dict(row)


@router.patch("/{location_id}/rates/{rate_id}")
async def patch_location_rate(
    location_id: str, rate_id: str, body: LocationRatePatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    touched = body.sent_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates "
                "WHERE id = $1 AND location_id = $2",
                rate_id, location_id,
            )
            if not current:
                raise HTTPException(404, "Tarifa no encontrada")

            loc = await conn.fetchrow(
                "SELECT entity_type, entity_id FROM public.locations WHERE id = $1", location_id,
            )

            await conn.execute(
                """
                UPDATE public.location_rates SET
                    tarifa     = COALESCE($2, tarifa),
                    valid_from = COALESCE($3, valid_from),
                    valid_to   = COALESCE($4, valid_to),
                    updated_at = NOW()
                WHERE id = $1
                """,
                rate_id, body.tarifa, body.valid_from, body.valid_to,
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type=loc["entity_type"], entity_id=loc["entity_id"],
                    action="update", field=f"location_rate.{field}",
                    old_value=str(current[field]) if current[field] is not None else None,
                    new_value=str(getattr(body, field)), source="api",
                )

    row = await pool.fetchrow(
        f"SELECT {_LOCATION_RATE_FIELDS} FROM public.location_rates WHERE id = $1", rate_id,
    )
    return dict(row)


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

            # Robustecer Tarifario (2026-07-27): si el body trae operation_type
            # explícito, es una corrección humana — se marca is_manual_override
            # para que el trigger de auto-registro de locales (que completa la
            # clasificación desde destination_region) nunca la pise después.
            manual_override = "operation_type" in touched

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
                    is_manual_override = CASE WHEN $13 THEN true ELSE is_manual_override END,
                    overridden_by      = CASE WHEN $13 THEN $14 ELSE overridden_by END,
                    overridden_at      = CASE WHEN $13 THEN NOW() ELSE overridden_at END,
                    updated_at         = NOW()
                WHERE id = $1
                """,
                location_id, body.name, body.site_number, body.country_code, body.format,
                body.address, body.region_name, body.region_number, body.opens_at, body.closes_at,
                body.operation_type, body.operational_status, manual_override, user["sub"],
            )
            for field in touched:
                await log_change(
                    conn, actor=user["sub"], entity_type=current["entity_type"], entity_id=current["entity_id"],
                    action="update", field=field, old_value=str(current[field]) if current[field] is not None else None,
                    new_value=str(getattr(body, field)), source="api",
                )

    row = await pool.fetchrow(f"SELECT {_LOCATION_FIELDS} FROM public.locations WHERE id = $1", location_id)
    return dict(row)
