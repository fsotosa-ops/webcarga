"""public.drivers — master data, independiente de a qué carrier esté asignado
(H2.2). Alta/baja de la asignación vive en routers/carriers.py."""
import re

from asyncpg.exceptions import CheckViolationError, UniqueViolationError
from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.contact import ContactCreateBody
from ..schemas.driver import DriverCreateBody, DriverPatchBody
from ..services.audit import log_change, record_manual_edit
from ..services.vencimientos import por_vencer_predicate, vencido_predicate
from ..utils.document_storage import resolve_signed_url

router = APIRouter(prefix="/drivers", tags=["drivers"])


# Declarado ANTES de /{driver_id} por convención con el resto del router
# (colección primero, item después) — no hay colisión real de rutas, "" y
# "/{driver_id}" tienen distinta cantidad de segmentos.
@router.get("")
async def list_drivers(
    q: str = Query(""),
    limit: int = Query(10, ge=1, le=50),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Búsqueda de conductores activos por nombre/RUT, con su empresa y
    vehículo estándar ya resueltos — usada por TripAssignDialog (Ronda 26,
    hardening del Diario) para el flujo driver-first de creación de viajes.
    Mismo shape que GET /trips/available-drivers menos trips_total/
    last_report_at (acá no importa si tuvo viajes hoy, es búsqueda general)."""
    if len(q.strip()) < 2:
        return []
    rows = await pool.fetch(
        """
        SELECT
            d.id       AS driver_id,
            d.full_name AS driver_name,
            d.tax_id    AS driver_rut,
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = d.id AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            )          AS driver_phone,
            c.id       AS carrier_id,
            c.business_name AS carrier_name,
            a.id       AS tractor_asset_id,
            a.license_plate AS tractor_plate
        FROM public.drivers d
        LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.driver_id = d.id AND vda.status = 'ACTIVE'
        LEFT JOIN public.assets a ON a.id = vda.asset_id
        WHERE d.operational_status = 'ACTIVE'
          AND (d.full_name ILIKE '%'||$1||'%' OR d.tax_id ILIKE '%'||$1||'%')
        ORDER BY d.full_name
        LIMIT $2
        """,
        q.strip(), limit,
    )
    return [dict(r) for r in rows]


# HU-06 (Fase 3, 2026-07-22): fuzzy match del nombre reportado por el TMS
# contra el roster — ~80% de similitud + confirmación humana, diseño
# confirmado por Pablo en la reunión del 20/07 (no reemplaza la búsqueda
# manual de arriba, la complementa cuando el cruce exacto por nombre falla).
# Umbral calibrado contra nombres reales de viajes UNMATCHED: coincidencias
# legítimas (typo/nombre incompleto) caen en 0.70-1.0, ruido cae por debajo
# de 0.30 — 0.7 da margen sin acercarse a la zona de ruido.
_FUZZY_MATCH_MIN_SIMILARITY = 0.7


@router.get("/fuzzy-match")
async def fuzzy_match_drivers(
    name: str = Query(..., min_length=2),
    limit: int = Query(5, ge=1, le=20),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Candidatos del roster por similitud de texto (pg_trgm) contra un
    nombre crudo del TMS — usado cuando un viaje no logra cruzar por nombre
    exacto (fleet_match_status = UNMATCHED). El operador debe confirmar el
    candidato con un click (mismo flujo que la búsqueda manual); esto nunca
    vincula nada por sí solo."""
    # El TMS suele adjuntar el RUT ("NOMBRE / 12345678-9") y puntuación/tabs
    # sueltos — se limpia antes de comparar para no penalizar la similitud
    # por ruido que no es parte del nombre.
    cleaned = re.sub(r"\s*/\s*[\w.-]+$", "", name.strip())
    cleaned = re.sub(r"[\s.]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) < 2:
        return []
    rows = await pool.fetch(
        """
        SELECT
            d.id       AS driver_id,
            d.full_name AS driver_name,
            d.tax_id    AS driver_rut,
            (
                SELECT fl2.driver_phone FROM app.trip_fleet_links fl2
                WHERE fl2.driver_id = d.id AND fl2.driver_phone IS NOT NULL
                ORDER BY fl2.updated_at DESC LIMIT 1
            )          AS driver_phone,
            c.id       AS carrier_id,
            c.business_name AS carrier_name,
            a.id       AS tractor_asset_id,
            a.license_plate AS tractor_plate,
            similarity(upper(d.full_name), upper($1)) AS similarity
        FROM public.drivers d
        LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id AND c.operational_status = 'ACTIVE'
        LEFT JOIN public.vehicle_driver_assignments vda ON vda.driver_id = d.id AND vda.status = 'ACTIVE'
        LEFT JOIN public.assets a ON a.id = vda.asset_id
        WHERE d.operational_status = 'ACTIVE'
          AND similarity(upper(d.full_name), upper($1)) >= $2
        ORDER BY similarity DESC
        LIMIT $3
        """,
        cleaned, _FUZZY_MATCH_MIN_SIMILARITY, limit,
    )
    return [dict(r) for r in rows]


@router.get("/{driver_id}")
async def get_driver(driver_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    row = await pool.fetchrow(
        """
        SELECT d.id, d.tax_id, d.country_code, d.full_name, d.operational_status,
               d.is_manual_override, d.created_at,
               dcs.total_requirements, dcs.last_document_update,
               -- La empresa a la que pertenece hoy, por su asignación ACTIVE
               -- (mismo criterio que el resto del roster). Sin ella no hay
               -- migas ni contexto en su panel de detalle. LEFT JOIN: un
               -- conductor sin asignación tiene que seguir apareciendo.
               c.id::text      AS carrier_id,
               c.business_name AS carrier_name
        FROM public.drivers d
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = d.id
        LEFT JOIN public.driver_assignments da
               ON da.driver_id = d.id AND da.status = 'ACTIVE'
        LEFT JOIN public.carriers c ON c.id = da.carrier_id
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
    MISSING al insertar. Para asignarlo a una empresa, POST /carriers/{id}/drivers.

    EL RUT SE CANONIZA ACÁ, y con la función de la base (2026-08-27, bug crítico
    #1 de la minuta del 25/08). Antes este pre-chequeo comparaba `tax_id = $1`
    LITERAL contra una columna que `trg_drivers_normalize_tax_id` guarda siempre
    como `NNNNNNNN-D`, y el propio formulario del Diario enseña el formato CON
    puntos en su placeholder. O sea:

      * RUT existente tecleado sin puntos -> lo encontraba -> 409 correcto.
      * RUT existente tecleado CON puntos -> NO lo encontraba, seguía al INSERT,
        el trigger lo canonizaba y recién ahí chocaba con `drivers_tax_id_key`:
        `UniqueViolationError` sin `except` -> **500**.
      * RUT con dígito verificador malo -> `canonical_rut` devuelve NULL, el
        trigger conserva lo tecleado y lo rechaza `drivers_tax_id_is_canonical`:
        `CheckViolationError` sin `except` -> **500** otra vez.

    Se llama a `public.canonical_rut()` en vez de reescribirla en Python a
    propósito: el CHECK de la tabla usa ESA, y dos implementaciones de la misma
    regla se separan el día que alguien toca una. El CHECK no mira
    `country_code` —es incondicional—, así que acá tampoco se ramifica.

    Los `except` de abajo no son redundantes con el pre-chequeo: cubren la
    carrera entre el SELECT y el INSERT. Sin ellos esa carrera es un 500.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            canonico = await conn.fetchval("SELECT public.canonical_rut($1)", body.tax_id)
            if canonico is None:
                raise HTTPException(422, {
                    "code": "RUT_INVALIDO",
                    "message": (
                        f"El RUT '{body.tax_id}' no es válido. Revisa el dígito verificador."
                    ),
                    "tax_id": body.tax_id,
                })
            existing = await conn.fetchrow(
                "SELECT id, full_name, operational_status FROM public.drivers WHERE tax_id = $1",
                canonico,
            )
            if existing:
                # Estructurado, no un string: la interfaz necesita el id para
                # ofrecer "asignar a este conductor" en vez de dejar al
                # coordinador con un mensaje y ninguna salida.
                raise HTTPException(409, {
                    "code": "CONDUCTOR_YA_EXISTE",
                    "message": (
                        f"{existing['full_name']} ya está registrado con el RUT {canonico}."
                    ),
                    "driver_id": str(existing["id"]),
                    "full_name": existing["full_name"],
                    "tax_id": canonico,
                    "operational_status": existing["operational_status"],
                })
            try:
                row = await conn.fetchrow(
                    """
                    INSERT INTO public.drivers (tax_id, country_code, full_name, operational_status)
                    VALUES ($1, $2, $3, $4)
                    RETURNING id, tax_id, country_code, full_name, operational_status, created_at
                    """,
                    canonico, body.country_code, body.full_name, body.operational_status,
                )
            except UniqueViolationError:
                raise HTTPException(409, {
                    "code": "CONDUCTOR_YA_EXISTE",
                    "message": f"Ya existe un conductor con el RUT {canonico}.",
                    "tax_id": canonico,
                })
            except CheckViolationError:
                raise HTTPException(422, {
                    "code": "RUT_INVALIDO",
                    "message": f"El RUT '{body.tax_id}' no es válido.",
                    "tax_id": body.tax_id,
                })
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
        f"""
        SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
               req.requires_file, req.expiration_policy,
               cr.status, cr.expiration_date, cr.file_url, cr.metadata,
               cr.is_manual_override, cr.updated_at,
               {vencido_predicate('cr')} AS is_expired,
               {por_vencer_predicate('cr')} AS is_expiring_soon
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
