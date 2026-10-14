"""Módulo Empresas — backend sobre public.carriers (H2.2). Reemplaza al
router de Checkpoint A-E (transporters.py/transporters_legacy.py, borrados
2026-07-16 junto con insurance.py viejo — ver AGENTLOG.md).
"""
from datetime import date
from typing import Annotated, Literal, Optional

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..auth import get_current_user, get_supabase
from ..authz import Permission, exigir, require, require_fields
from ..db import get_pool
from ..schemas.assignment import (
    AssetAssignmentCreateBody, CarrierReactivateBody, CarrierShipperLinkBody, DriverAssignmentCreateBody,
)
from ..schemas.carrier import CARRIER_FIELD_PERMISSIONS, CarrierCreateBody, CarrierListResponse, CarrierPatchBody
from ..schemas.common import PaginatedResponse
from ..schemas.contact import ContactCreateBody
from ..schemas.insurance import CarrierInsuranceOverviewResponse, InsurancePolicyCreateBody
from ..services import fleet_assignments
from ..services.entity_documents import entity_documents
from ..services.audit import log_change, record_manual_edit
from ..services.fleet_compliance import (
    CARRIER_SUMMARY_COLUMNS,
    ENABLEMENT_FILTERS,
    carrier_compliance_cte,
    carrier_summary_columns_sql,
    compliance_record_columns_sql,
    entity_compliance_cte,
    entity_summary_columns_sql,
    take_summary,
)
from ..services.entity_summary import carrier_summary
from ..services.fleet_driver_gap import compute_fleet_driver_gap
from ..services.vencimientos import por_vencer_predicate, vence_el_sql, vencido_predicate
from ..utils.identity import plate_matches_sql, rut_matches_sql
from ..utils.document_storage import build_documents_zip, resolve_signed_url, safe_storage_name

router = APIRouter(prefix="/carriers", tags=["carriers"])


# La empresa y sus datos de lista. El cumplimiento (cuánto debe, si puede
# operar) NO se cuenta acá: sale de `carrier_compliance` (D1, una sola
# respuesta), igual que en Pendientes. `total_requirements` y
# `last_document_update` son datos de la lista (cuántos registros vigentes
# tiene y cuándo se tocó el último), no un estado.
_CARRIER_LIST_SQL = """
    SELECT c.id AS carrier_id, c.tax_id, c.country_code, c.business_name, c.operational_status,
           COUNT(cr.id) AS total_requirements,
           MAX(cr.updated_at) AS last_document_update
    FROM public.carriers c
    LEFT JOIN public.compliance_records cr
        ON cr.entity_id = c.id AND cr.entity_type = 'CARRIER' AND cr.is_current = true
    {where}
    GROUP BY c.id, c.tax_id, c.country_code, c.business_name, c.operational_status
"""


def _estados(valor: str) -> list[str]:
    """Uno o varios estados separados por coma, sin vacios.

    Un solo valor sigue funcionando igual que antes — `= ANY(ARRAY['ACTIVE'])`
    es lo mismo que `= 'ACTIVE'`—, asi que ningun llamador viejo cambia.
    """
    return [e.strip() for e in valor.split(",") if e.strip()]


@router.get("", response_model=CarrierListResponse)
async def list_carriers(
    q: str = Query("", description="Buscar por nombre o tax_id"),
    operational_status: str = Query(
        "",
        description=(
            "ACTIVE|INACTIVE|LEGACY_INACTIVE|ONBOARDING. Acepta VARIOS separados por coma: "
            "la pestaña 'Inactivas' del Directorio manda 'LEGACY_INACTIVE,INACTIVE' porque el "
            "resumen de esa misma pantalla ya cuenta las dos juntas — filtrar por una sola dejaba "
            "fuera a las empresas dadas de baja desde la app, que es justo lo que el usuario "
            "acababa de hacer y no encontraba."
        ),
    ),
    enablement: Annotated[Literal["enabled", "not_enabled", ""], Query(
        description=(
            "enabled|not_enabled. Habilitada = puede operar (D1); No habilitada = activa "
            "con algún obligatorio vencido o faltante. Una empresa no activa no es ninguna "
            "de las dos: su ciclo de vida ya lo dice."
        ),
    )] = "",
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(require(Permission.DIRECTORY_READ)),
):
    clauses: list[str] = []
    params: list = []
    if q:
        params.append(q)
        clauses.append(f"(c.business_name ILIKE '%' || ${len(params)} || '%' OR {rut_matches_sql('c.tax_id', f'${len(params)}')})")
    if operational_status:
        params.append(_estados(operational_status))
        clauses.append(f"c.operational_status = ANY(${len(params)}::text[])")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    agg_cte = f"WITH agg AS ({_CARRIER_LIST_SQL.format(where=where)})"
    # D1: la misma respuesta que Pendientes (spec §5), una vez por consulta.
    base = (
        f"{agg_cte},\n{carrier_compliance_cte()},\n"
        f"listed AS (SELECT agg.*, {carrier_summary_columns_sql('cc')} FROM agg "
        f"LEFT JOIN carrier_compliance cc ON cc.carrier_id = agg.carrier_id)"
    )

    filter_params = list(params)
    filters: list[str] = []
    if enablement:
        filters.append(f"({ENABLEMENT_FILTERS[enablement]})")
    filter_where = ("WHERE " + " AND ".join(filters)) if filters else ""

    offset = (page - 1) * limit
    lp, op = len(filter_params) + 1, len(filter_params) + 2
    summary_cols = ", ".join(CARRIER_SUMMARY_COLUMNS)

    rows = await pool.fetch(
        f"""
        {base}
        SELECT carrier_id AS id, tax_id, country_code, business_name, operational_status,
               total_requirements, last_document_update,
               {summary_cols}
        FROM listed
        {filter_where}
        -- Primero las No habilitadas (activas que no pueden operar), después
        -- por nombre. Una empresa no activa no es No habilitada.
        ORDER BY
            ({ENABLEMENT_FILTERS["not_enabled"]}) DESC,
            business_name ASC,
            -- Desempate estable: dos empresas con el mismo nombre no cambian de
            -- página entre recargas (deuda de D1).
            id
        LIMIT ${lp} OFFSET ${op}
        """,
        *filter_params, limit, offset,
    )
    # El conteo de la página y las facetas en una sola pasada. Las facetas son
    # del universo `q` + `operational_status`, sin `enablement`:
    # cambiar de pestaña no reordena los otros conteos (CarrierListFacets).
    counts = await pool.fetchrow(
        f"""
        {base}
        SELECT
            COUNT(*) FILTER (WHERE {" AND ".join(filters) or "true"})          AS count,
            COUNT(*) FILTER (WHERE {ENABLEMENT_FILTERS["enabled"]})             AS enabled,
            COUNT(*) FILTER (WHERE {ENABLEMENT_FILTERS["not_enabled"]})         AS not_enabled,
            COUNT(*)                                                            AS total
        FROM listed
        """,
        *filter_params,
    )
    data = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=True)
        data.append(fila)
    facets = dict(counts)
    count = facets.pop("count")
    return {"data": data, "count": count, "page": page, "limit": limit, "facets": facets}


# ── Landing de Seguros — agregado por carrier, sincronizado con la misma
#    data real que ya se ve en la tab Seguros de cada empresa (H3 rediseño,
#    2026-07-16). Ruta declarada ANTES de /{carrier_id} para no colisionar
#    con el path param (mismo nivel de profundidad). No expone cuotas
#    individuales cross-empresa — eso quedó descartado explícitamente. ────

_INSURANCE_HEALTH_VALUES = {"EXPIRED", "EXPIRING_SOON", "VALID", "CANCELLED"}

_INSURANCE_OVERVIEW_AGG = """
    SELECT c.id AS carrier_id, c.business_name, c.tax_id, c.operational_status,
           COUNT(p.policy_id) AS total_policies,
           COALESCE(SUM(p.overdue_installments), 0) AS total_overdue_installments,
           MIN(p.next_payment_date) AS next_payment_date,
           CASE
               WHEN COUNT(p.policy_id) = 0 THEN NULL
               WHEN BOOL_OR(p.policy_health = 'EXPIRED') THEN 'EXPIRED'
               WHEN BOOL_OR(p.policy_health = 'EXPIRING_SOON') THEN 'EXPIRING_SOON'
               WHEN BOOL_OR(p.policy_health = 'VALID') THEN 'VALID'
               ELSE 'CANCELLED'
           END AS worst_policy_health
    FROM public.carriers c
    LEFT JOIN app.carrier_insurance_status p ON p.carrier_id = c.id
    {q_where}
    GROUP BY c.id, c.business_name, c.tax_id, c.operational_status
"""


@router.get("/insurance-overview", response_model=CarrierInsuranceOverviewResponse)
async def list_carriers_insurance_overview(
    q: str = Query("", description="Buscar por nombre o tax_id"),
    health: str = Query("", description="EXPIRED|EXPIRING_SOON|VALID|CANCELLED|NONE — filtra por worst_policy_health"),
    operational_status: str = Query("", description="ACTIVE|INACTIVE|LEGACY_INACTIVE|ONBOARDING — filtra por estado de la empresa, mismo eje que /carriers"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(require(Permission.DIRECTORY_READ)),
):
    if health and health != "NONE" and health not in _INSURANCE_HEALTH_VALUES:
        raise HTTPException(422, "health inválido")

    q_params: list = []
    q_clauses: list[str] = []
    if q:
        q_params.append(q)
        q_clauses.append(f"(c.business_name ILIKE '%' || ${len(q_params)} || '%' OR {rut_matches_sql('c.tax_id', f'${len(q_params)}')})")
    if operational_status:
        q_params.append(_estados(operational_status))
        q_clauses.append(f"c.operational_status = ANY(${len(q_params)}::text[])")
    q_where = ("WHERE " + " AND ".join(q_clauses)) if q_clauses else ""
    agg_cte = f"WITH agg AS ({_INSURANCE_OVERVIEW_AGG.format(q_where=q_where)})"

    health_params = list(q_params)
    if health == "NONE":
        health_where = "WHERE worst_policy_health IS NULL"
    elif health:
        health_params.append(health)
        health_where = f"WHERE worst_policy_health = ${len(health_params)}"
    else:
        health_where = ""

    offset = (page - 1) * limit
    lp, op = len(health_params) + 1, len(health_params) + 2

    rows = await pool.fetch(
        f"""
        {agg_cte}
        SELECT * FROM agg
        {health_where}
        ORDER BY
            CASE worst_policy_health
                WHEN 'EXPIRED' THEN 1
                WHEN 'EXPIRING_SOON' THEN 2
                WHEN 'VALID' THEN 3
                WHEN 'CANCELLED' THEN 4
                ELSE 5
            END,
            total_overdue_installments DESC,
            business_name ASC
        LIMIT ${lp} OFFSET ${op}
        """,
        *health_params, limit, offset,
    )
    count = await pool.fetchval(f"{agg_cte} SELECT count(*) FROM agg {health_where}", *health_params)
    facets = await pool.fetchrow(
        f"""
        {agg_cte}
        SELECT
            COUNT(*) FILTER (WHERE worst_policy_health = 'EXPIRED') AS expired,
            COUNT(*) FILTER (WHERE worst_policy_health = 'EXPIRING_SOON') AS expiring_soon,
            COUNT(*) FILTER (WHERE worst_policy_health = 'VALID') AS valid,
            COUNT(*) FILTER (WHERE worst_policy_health = 'CANCELLED') AS cancelled,
            COUNT(*) FILTER (WHERE worst_policy_health IS NULL) AS no_policy,
            COUNT(*) AS total
        FROM agg
        """,
        *q_params,
    )
    return {
        "data": [dict(r) for r in rows],
        "count": count,
        "page": page,
        "limit": limit,
        "facets": dict(facets),
    }


async def _assemble_carrier_detail(carrier_id: str, pool, supabase=None) -> dict:
    carrier = await pool.fetchrow(
        f"""
        WITH {carrier_compliance_cte()}
        SELECT c.id, c.tax_id, c.country_code, c.business_name, c.operational_status,
               c.legacy_admin_id, c.erp_id, c.is_manual_override, c.overridden_by, c.overridden_at,
               c.created_at, c.updated_at, c.management_types,
               {carrier_summary_columns_sql('cc')}
        FROM public.carriers c
        LEFT JOIN carrier_compliance cc ON cc.carrier_id = c.id
        WHERE c.id = $1
        """,
        carrier_id,
    )
    if not carrier:
        raise HTTPException(404, "Empresa no encontrada")

    contacts = await pool.fetch(
        """
        SELECT id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active
        FROM public.contacts
        WHERE entity_type = 'CARRIER' AND entity_id = $1 AND is_active = true
        ORDER BY is_primary DESC, contact_role
        """,
        carrier_id,
    )

    compliance = await pool.fetch(
        f"""
        SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
               req.requires_file, req.expiration_policy,
               cr.status, cr.expiration_date, cr.file_url, cr.metadata,
               cr.is_manual_override, cr.updated_at,
               {vencido_predicate('cr')} AS is_expired,
               {por_vencer_predicate('cr')} AS is_expiring_soon,
               -- El vencimiento calculado según el tipo (HU-C1, entrega 2b);
               -- -infinity (falta la emisión o el período) no es una fecha.
               NULLIF({vence_el_sql('cr')}, '-infinity') AS vence_el,
               -- D1: el estado lo calcula la regla de Configuración, no el
               -- `status` guardado (historial del archivo, spec §3).
               {compliance_record_columns_sql('cr')},
               cr.issue_date, cr.period_start
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.entity_id = $1 AND cr.entity_type = 'CARRIER' AND cr.is_current = true
        ORDER BY req.requirement_level, req.name
        """,
        carrier_id,
    )

    compliance_records = [dict(c) for c in compliance]
    if supabase is not None:
        for record in compliance_records:
            record["file_url"] = resolve_signed_url(supabase, record["file_url"])

    detail = dict(carrier)
    summary = take_summary(detail, with_fleet=True)
    return {
        **detail,
        "compliance_summary": summary,
        "contacts": [dict(c) for c in contacts],
        "compliance_records": compliance_records,
    }


@router.get("/fleet-driver-gap")
async def get_fleet_driver_gap(pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    """Tarea 8 (plan 3.1, minuta 2026-08-03): inconsistencias de dotación
    tracto/conductor por empresa Tractoreo — solo lectura, cálculo en vivo.
    Declarada ANTES de /{carrier_id} (ruta literal debe ganarle a la ruta
    con path param, mismo cuidado que /insurance-overview arriba)."""
    return {"rows": await compute_fleet_driver_gap(pool)}


# El directorio que Pablo echaba de menos. Textual, reunión del 21/08: *"me
# falta ese directorio que tenía yo antes, porque en ese directorio me
# aparecían, no sé, trescientas empresas, y de las trescientas eran cincuenta
# están activas, doscientas cincuenta inactivas"*, y enseguida pidió, debajo de
# eso, el conteo de tractos, equipos y conductores.
#
# Existía en el módulo de Empresas (`/dashboard/carriers`) como tabs
# Activas/Inactivo/Onboarding con sus conteos, y se perdió al mover la carga
# documental a Certificación. Se repone donde ahora se trabaja.
#
# UNA sola consulta: son ocho conteos sobre tres tablas, y ocho viajes a la base
# para dibujar una tira de cifras es lo que vuelve lenta una portada.
#
# La flota se cuenta SOLO en empresas activas y sobre app.active_fleet: lo
# activo con asignación vigente (D1, spec §4.1). Hasta el 12/10 contaba por
# asignación sola, y dar de baja no la toca: decía 84 conductores donde el
# Cierre ve 78 (F-03). Es la misma pregunta con la respuesta corregida
# (D1-R3), no un campo nuevo.
_SQL_DIRECTORIO = """
SELECT
  (SELECT count(*) FROM public.carriers)                                          AS empresas_total,
  (SELECT count(*) FROM public.carriers WHERE operational_status = 'ACTIVE')      AS activas,
  (SELECT count(*) FROM public.carriers
    WHERE operational_status IN ('LEGACY_INACTIVE', 'INACTIVE'))                  AS inactivas,
  (SELECT count(*) FROM public.carriers WHERE operational_status = 'ONBOARDING')  AS onboarding,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
     JOIN public.assets a ON a.id = f.entity_id
    WHERE f.entity_type = 'ASSET' AND a.asset_type = 'TRACTOCAMION')              AS tractos,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
     JOIN public.assets a ON a.id = f.entity_id
    WHERE f.entity_type = 'ASSET' AND a.asset_type = 'RAMPLA')                    AS ramplas,
  (SELECT count(DISTINCT f.entity_id) FROM app.active_fleet f
     JOIN public.carriers c ON c.id = f.carrier_id AND c.operational_status = 'ACTIVE'
    WHERE f.entity_type = 'DRIVER')                                               AS conductores
"""


# El buscador unico del Directorio.
#
# POR QUE EXISTE. Pablo, 04/09: *"en el directorio deberia ser capaz de buscar
# todo. Ya todo, me refiero a empresa, conductor, patente"*. Hasta el
# 2026-09-07 el Directorio buscaba SOLO por nombre o RUT de empresa: escribir
# el apellido de un conductor devolvia "Sin resultados", y la patente tambien.
# La busqueda por conductor y por vehiculo existia, pero en Certificacion —el
# modulo documental—, donde no se puede dar de baja ni transferir a nadie.
#
# Va contra las tablas base y no contra `app.carrier_*_roster`: son vistas
# materializadas, y esta es la pantalla donde se edita. Un alta hecha hace un
# minuto tiene que aparecer.
#
# El RUT y la patente se comparan por su forma canonica —`canonical_rut` y
# `canonical_plate` viven en Postgres desde el 17/08— para que "18.659.820-2",
# "186598202" y "dt by52" encuentren lo mismo que el texto exacto. Siempre se
# canoniza LA COLUMNA tambien (`canonical_rut(c.tax_id) = canonical_rut($1)`):
# carriers.tax_id no es canonico por construccion, y comparar la columna cruda
# con la forma canonica no encontraba un tax_id guardado con puntos (D1 §7.2).
_SQL_BUSCAR_EMPRESAS = f"""
SELECT c.id, c.business_name, c.tax_id, c.operational_status
FROM public.carriers c
WHERE c.business_name ILIKE '%' || $1 || '%'
   OR {rut_matches_sql('c.tax_id', '$1')}
ORDER BY (c.operational_status = 'ACTIVE') DESC, c.business_name
LIMIT $2
"""

_SQL_BUSCAR_CONDUCTORES = f"""
SELECT d.id, d.full_name, d.tax_id, d.operational_status,
       c.id AS carrier_id, c.business_name AS carrier_name,
       c.operational_status AS carrier_operational_status
FROM public.drivers d
LEFT JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = da.carrier_id
WHERE d.full_name ILIKE '%' || $1 || '%'
   OR {rut_matches_sql('d.tax_id', '$1')}
ORDER BY (d.operational_status = 'ACTIVE') DESC, d.full_name
LIMIT $2
"""

_SQL_BUSCAR_VEHICULOS = f"""
SELECT a.id, a.license_plate, a.asset_type, a.operational_status,
       wot.label AS webcarga_operation_type_label,
       c.id AS carrier_id, c.business_name AS carrier_name,
       c.operational_status AS carrier_operational_status
FROM public.assets a
LEFT JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
LEFT JOIN public.carriers c ON c.id = aa.carrier_id
LEFT JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
WHERE {plate_matches_sql('a.license_plate', '$1')}
ORDER BY (a.operational_status = 'ACTIVE') DESC, a.license_plate
LIMIT $2
"""


@router.get("/buscar")
async def buscar_en_el_directorio(
    q: str = Query("", description="Empresa, conductor o patente — un solo campo para los tres"),
    limit: int = Query(10, ge=1, le=50, description="Por grupo, no en total"),
    pool=Depends(get_pool),
    _=Depends(require(Permission.DIRECTORY_READ)),
):
    """Un texto, tres tipos de resultado.

    Va ANTES de `GET /{carrier_id}` por la misma razon que /directorio: si se
    declarara despues, un GET a /buscar entraria por esa ruta y contestaria
    404 de empresa no encontrada.
    """
    termino = q.strip()
    if len(termino) < 2:
        # Con una letra sola el resultado es todo el padron, que no es una
        # respuesta: es la lista completa con otro nombre.
        return {"q": termino, "empresas": [], "conductores": [], "vehiculos": []}

    empresas = await pool.fetch(_SQL_BUSCAR_EMPRESAS, termino, limit)
    conductores = await pool.fetch(_SQL_BUSCAR_CONDUCTORES, termino, limit)
    vehiculos = await pool.fetch(_SQL_BUSCAR_VEHICULOS, termino, limit)
    return {
        "q": termino,
        "empresas": [dict(r) for r in empresas],
        "conductores": [dict(r) for r in conductores],
        "vehiculos": [dict(r) for r in vehiculos],
    }


@router.get("/directorio")
async def get_directorio(pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    """Cuántas empresas hay, cuántas operan, y con qué flota.

    Va ANTES de `GET /{carrier_id}`: declarada después, un GET a /directorio
    entraría por esa ruta y contestaría 404 de empresa no encontrada.
    """
    fila = await pool.fetchrow(_SQL_DIRECTORIO)
    return {
        "empresas": {
            "total":      fila["empresas_total"],
            "activas":    fila["activas"],
            "inactivas":  fila["inactivas"],
            "onboarding": fila["onboarding"],
        },
        # Sólo de las empresas activas: es la flota que opera, no el catálogo.
        "flota": {
            "tractos":     fila["tractos"],
            "ramplas":     fila["ramplas"],
            "conductores": fila["conductores"],
        },
    }


@router.get("/{carrier_id}/summary")
async def get_carrier_summary(carrier_id: UUID, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    """Resumen de solo lectura para la vista rápida del Cierre (HU 20261011/01)."""
    summary = await carrier_summary(pool, carrier_id)
    if summary is None:
        raise HTTPException(404, "Empresa no encontrada")
    return summary


@router.get("/{carrier_id}")
async def get_carrier(
    carrier_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(require(Permission.DIRECTORY_READ)),
):
    return await _assemble_carrier_detail(carrier_id, pool, supabase)


@router.get("/{carrier_id}/documents/export")
async def export_carrier_documents(
    carrier_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(require(Permission.DIRECTORY_READ)),
):
    """HU-08 (Fase 0, 2026-07-21): exportar en bloque toda la documentación
    cargada de una empresa — pedido explícito de Fabián en la reunión del
    20/07 ("¿puedo bajar toda esta documentación... o tengo que ir uno a
    uno?"). Antes no existía ningún export, solo descarga individual por
    documento."""
    carrier = await pool.fetchrow("SELECT business_name FROM public.carriers WHERE id = $1", carrier_id)
    if not carrier:
        raise HTTPException(404, "Empresa no encontrada")

    records = await pool.fetch(
        """
        SELECT req.name, cr.file_url
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.entity_id = $1 AND cr.entity_type = 'CARRIER' AND cr.is_current = true
          AND cr.file_url IS NOT NULL
        ORDER BY req.name
        """,
        carrier_id,
    )
    if not records:
        raise HTTPException(404, "Esta empresa no tiene documentos cargados")

    zip_bytes = build_documents_zip(supabase, [dict(r) for r in records])
    filename = f"{safe_storage_name(carrier['business_name'])}_documentos.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("", status_code=201)
async def create_carrier(
    body: CarrierCreateBody, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    """Onboarding manual de UNA empresa (distinto del bulk-load de Mage desde
    el Excel EETT). trg_reconcile_new_carrier siembra los compliance_records
    MISSING automáticamente al insertar — no hace falta duplicarlo acá."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            existing = await conn.fetchval(
                "SELECT id FROM public.carriers WHERE tax_id = $1", body.tax_id,
            )
            if existing:
                raise HTTPException(409, f"Ya existe una empresa con tax_id {body.tax_id}")

            row = await conn.fetchrow(
                """
                INSERT INTO public.carriers
                    (tax_id, country_code, business_name, operational_status, management_types)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING id, tax_id, country_code, business_name, operational_status,
                          created_at, management_types
                """,
                body.tax_id, body.country_code, body.business_name, body.operational_status,
                body.management_types,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="CARRIER", entity_id=row["id"],
                action="create", source="api",
            )
    return dict(row)


@router.patch("/{carrier_id}")
async def patch_carrier(
    carrier_id: str, body: CarrierPatchBody, pool=Depends(get_pool),
    supabase=Depends(get_supabase), user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    require_fields(user, body.model_dump(exclude_none=True), CARRIER_FIELD_PERMISSIONS)
    async with pool.acquire() as conn:
        async with conn.transaction():
            # `management_types` va en el SELECT porque el bucle de auditoría de
            # más abajo lee `current[field]` para cada campo tocado: sin traerla,
            # patchear la gestión revienta con KeyError en vez de guardar.
            # FOR UPDATE: el permiso de abajo depende del estado leído. Sin el
            # bloqueo, una baja concurrente (ONBOARDING → INACTIVE) entre esta
            # lectura y el UPDATE quedaría pisada por una "activación" que en
            # realidad es reactivar, y eso exige directory.delete.
            current = await conn.fetchrow(
                "SELECT updated_at, business_name, operational_status, tax_id, management_types "
                "FROM public.carriers WHERE id = $1 FOR UPDATE",
                carrier_id,
            )
            if not current:
                raise HTTPException(404, "Empresa no encontrada")
            # Dar de baja o reactivar una empresa es de Certificación (D-e,
            # 12/10): directory.delete. La excepción es activar una empresa
            # nueva (ONBOARDING → ACTIVE), que el Supervisor de Operaciones
            # hace desde el pre-cierre con directory.edit (R5). Depende del
            # estado actual, por eso no cabe en CARRIER_FIELD_PERMISSIONS; va
            # antes de cualquier escritura. Reenviar el estado que ya tiene no
            # es cambiarlo: ni exige directory.delete ni se audita.
            cambia_estado = (body.operational_status is not None
                             and body.operational_status != current["operational_status"])
            if cambia_estado and not (
                current["operational_status"] == "ONBOARDING" and body.operational_status == "ACTIVE"
            ):
                exigir(user, Permission.DIRECTORY_DELETE)
            if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
                raise HTTPException(409, "El registro fue modificado por otro usuario; recargue e intente de nuevo")

            touched = body.sent_fields()
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")
            if not cambia_estado:
                touched = [f for f in touched if f != "operational_status"]

            if cambia_estado and body.operational_status == "ACTIVE" and not body.tax_id and not current["tax_id"]:
                raise HTTPException(422, "No se puede activar una empresa sin RUT/tax_id")

            if body.tax_id:
                # En forma canónica (D3): "76.123.456-7" y "761234567" son el mismo RUT.
                dup = await conn.fetchval(
                    "SELECT id FROM public.carriers WHERE public.canonical_rut(tax_id) = public.canonical_rut($1) "
                    "AND id != $2", body.tax_id, carrier_id,
                )
                if dup:
                    raise HTTPException(409, f"Ya existe una empresa con tax_id {body.tax_id}")

            # Si solo reenvió el estado que ya tiene, `touched` quedó vacío: no
            # hay nada que escribir ni auditar, y tampoco se toca updated_at (el
            # bloqueo optimista de otra persona no tiene por qué ver un cambio
            # que no hubo).
            if touched:
                await conn.execute(
                    """
                    UPDATE public.carriers SET
                        business_name = COALESCE($2, business_name),
                        operational_status = COALESCE($3, operational_status),
                        tax_id = COALESCE($4, tax_id),
                        management_types = COALESCE($5, management_types),
                        updated_at = NOW()
                    WHERE id = $1
                    """,
                    carrier_id, body.business_name, body.operational_status, body.tax_id,
                    body.management_types,
                )
            for field in touched:
                await record_manual_edit(
                    conn, table="carriers", where={"id": carrier_id}, actor=user["sub"],
                    entity_type="CARRIER", entity_id=carrier_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )

    return await _assemble_carrier_detail(carrier_id, pool, supabase)


@router.delete("/{carrier_id}")
async def delete_carrier(carrier_id: str, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_DELETE))):
    """Borrado real (a diferencia de 'Dar de baja', que solo cambia
    operational_status) — solo permitido si la empresa no tiene datos
    asociados todavía, para poder limpiar altas por error/duplicadas sin
    riesgo de perder datos reales. Si tiene cualquier rastro real (roster,
    pólizas, contactos, generador de carga, viajes vinculados
    (app.trip_fleet_links, FK real desde Fase 1.5), o un compliance_record ya
    tocado por el usuario/con archivo), se bloquea con 409 y se indica qué
    la bloquea — la vía para esos casos sigue siendo 'Dar de baja'.
    Los compliance_records MISSING auto-sembrados por trg_reconcile_new_carrier
    no cuentan como dato real: no tienen FK real (entity_id/entity_type
    polimórfico), así que se borran acá explícitamente junto con la empresa.
    driver_assignments/asset_assignments solo bloquean si status='ACTIVE' —
    "Quitar del roster" las deja en INACTIVE en vez de borrarlas (historial),
    y bloquear sobre esas filas dejaría sin forma de borrar una empresa
    después de deshacer un alta por error (bug real encontrado en vivo)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.carriers WHERE id = $1", carrier_id):
                raise HTTPException(404, "Empresa no encontrada")

            blockers = []
            if await conn.fetchval(
                "SELECT 1 FROM public.driver_assignments WHERE carrier_id = $1 AND status = 'ACTIVE' LIMIT 1",
                carrier_id,
            ):
                blockers.append("conductores")
            if await conn.fetchval(
                "SELECT 1 FROM public.asset_assignments WHERE carrier_id = $1 AND status = 'ACTIVE' LIMIT 1",
                carrier_id,
            ):
                blockers.append("equipos")
            if await conn.fetchval("SELECT 1 FROM public.insurance_policies WHERE carrier_id = $1 LIMIT 1", carrier_id):
                blockers.append("pólizas de seguro")
            if await conn.fetchval("SELECT 1 FROM public.carrier_shippers WHERE carrier_id = $1 LIMIT 1", carrier_id):
                blockers.append("generadores de carga vinculados")
            if await conn.fetchval(
                "SELECT 1 FROM app.trip_fleet_links WHERE carrier_id = $1 LIMIT 1", carrier_id,
            ):
                blockers.append("viajes vinculados")
            if await conn.fetchval(
                "SELECT 1 FROM public.contacts WHERE entity_type = 'CARRIER' AND entity_id = $1 LIMIT 1",
                carrier_id,
            ):
                blockers.append("contactos")
            if await conn.fetchval(
                """
                SELECT 1 FROM public.compliance_records
                WHERE entity_type = 'CARRIER' AND entity_id = $1
                  AND (status != 'MISSING' OR file_url IS NOT NULL OR expiration_date IS NOT NULL)
                LIMIT 1
                """,
                carrier_id,
            ):
                blockers.append("documentos cargados")

            if blockers:
                raise HTTPException(
                    409,
                    f"No se puede eliminar: la empresa tiene {', '.join(blockers)} asociados. "
                    "Use 'Dar de baja' en su lugar.",
                )

            await log_change(
                conn, actor=user["sub"], entity_type="CARRIER", entity_id=carrier_id,
                action="delete", source="api",
            )
            await conn.execute(
                "DELETE FROM public.compliance_records WHERE entity_type = 'CARRIER' AND entity_id = $1",
                carrier_id,
            )
            await conn.execute("DELETE FROM public.carriers WHERE id = $1", carrier_id)
    return {"ok": True}


# ── Roster de conductores/vehículos (alta/baja vía driver_assignments/asset_assignments) ──

@router.get("/{carrier_id}/drivers")
async def list_carrier_drivers(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    # En vivo desde public.drivers (bloque 0 del Directorio, 0.2), igual que
    # list_carrier_assets lee el tipo de operación en vivo. La vista
    # app.carrier_driver_roster no tiene trigger de refresco en drivers, y
    # agregarle uno sumaría un REFRESH más por escritura (F-18). Los conteos de
    # documentos siguen saliendo de app.driver_compliance_status, que sí se
    # refresca cuando cambian los documentos.
    rows = await pool.fetch(
        f"""
        WITH {entity_compliance_cte()}
        SELECT r.driver_id AS id, r.tax_id, r.full_name, r.operational_status,
               dcs.total_requirements, dcs.last_document_update,
               {entity_summary_columns_sql('ec')}
        FROM (
            SELECT d.id AS driver_id, d.tax_id, d.full_name, d.operational_status
            FROM public.driver_assignments da
            JOIN public.drivers d ON d.id = da.driver_id
            WHERE da.carrier_id = $1 AND da.status = 'ACTIVE'
        ) r
        LEFT JOIN app.driver_compliance_status dcs ON dcs.driver_id = r.driver_id
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'DRIVER' AND ec.entity_id = r.driver_id
        ORDER BY r.full_name
        """,
        carrier_id,
    )
    filas = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=False)
        filas.append(fila)
    return filas


# ── Asignaciones con vigencia (D2): un solo servicio, services/fleet_assignments.py ──


@router.post("/{carrier_id}/drivers", status_code=201)
async def assign_driver(
    carrier_id: str, body: DriverAssignmentCreateBody, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.assign(conn, fleet_assignments.DRIVER, body.driver_id, carrier_id,
                                           actor=user["sub"], effective=body.effective_date)
    return {"ok": True}


@router.delete("/{carrier_id}/drivers/{driver_id}")
async def unassign_driver(
    # Quitar del roster termina una asignación: es editar, igual que asignar
    # (POST de arriba). Hasta el 12/10 exigía directory.delete y el botón se
    # mostraba con directory.edit: 403 a los Supervisores de Operaciones (F-33).
    carrier_id: str, driver_id: str, end_date: Optional[date] = None, pool=Depends(get_pool),
    user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.end(conn, fleet_assignments.DRIVER, driver_id, carrier_id,
                                        actor=user["sub"], effective=end_date)
    return {"ok": True}


@router.get("/{carrier_id}/assets")
async def list_carrier_assets(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    # En vivo desde public.assets, igual que el roster de conductores (bloque 0,
    # 0.2): app.carrier_asset_roster es materializada y no se refresca cuando
    # se da de baja un equipo. Con el ciclo de vida viejo, la habilitación del
    # equipo saldría mal (D1, R-B8). Los conteos de documentos siguen en
    # app.asset_compliance_status, que sí se refresca con los documentos.
    rows = await pool.fetch(
        f"""
        WITH {entity_compliance_cte()}
        SELECT r.asset_id AS id, r.license_plate, r.asset_type, r.operational_status,
               r.fleet_service_type_id, st.label AS fleet_service_type_label,
               st.bg_color AS fleet_service_type_bg_color, st.text_color AS fleet_service_type_text_color,
               -- Tipo de Operacion WebCarga (Tractoreo / Equipo Completo), el
               -- campo que decide si el tracto bloquea el cierre del dia.
               r.webcarga_operation_type_id,
               wot.label AS webcarga_operation_type_label,
               wot.code  AS webcarga_operation_type_code,
               acs.total_requirements, acs.last_document_update,
               {entity_summary_columns_sql('ec')}
        FROM (
            SELECT a.id AS asset_id, a.license_plate, a.asset_type, a.operational_status,
                   a.fleet_service_type_id, a.webcarga_operation_type_id
            FROM public.asset_assignments aa
            JOIN public.assets a ON a.id = aa.asset_id
            WHERE aa.carrier_id = $1 AND aa.status = 'ACTIVE'
        ) r
        LEFT JOIN app.status_taxonomies st ON st.id = r.fleet_service_type_id
        LEFT JOIN app.status_taxonomies wot ON wot.id = r.webcarga_operation_type_id
        LEFT JOIN app.asset_compliance_status acs ON acs.asset_id = r.asset_id
        LEFT JOIN entity_compliance ec ON ec.entity_type = 'ASSET' AND ec.entity_id = r.asset_id
        ORDER BY r.license_plate
        """,
        carrier_id,
    )
    filas = []
    for r in rows:
        fila = dict(r)
        fila["compliance_summary"] = take_summary(fila, with_fleet=False)
        filas.append(fila)
    return filas


@router.post("/{carrier_id}/assets", status_code=201)
async def assign_asset(
    carrier_id: str, body: AssetAssignmentCreateBody, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.assign(conn, fleet_assignments.ASSET, body.asset_id, carrier_id,
                                           actor=user["sub"], effective=body.effective_date)
    return {"ok": True}


@router.delete("/{carrier_id}/assets/{asset_id}")
async def unassign_asset(
    # Quitar del roster termina una asignación: es editar, igual que asignar
    # (POST de arriba). Hasta el 12/10 exigía directory.delete y el botón se
    # mostraba con directory.edit: 403 a los Supervisores de Operaciones (F-33).
    carrier_id: str, asset_id: str, end_date: Optional[date] = None, pool=Depends(get_pool),
    user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.end(conn, fleet_assignments.ASSET, asset_id, carrier_id,
                                        actor=user["sub"], effective=end_date)
    return {"ok": True}


# ── Contactos (polimórfico — alta anidada bajo carrier, edición flat en routers/contacts.py) ──

@router.get("/{carrier_id}/contacts")
async def list_carrier_contacts(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    rows = await pool.fetch(
        "SELECT id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active "
        "FROM public.contacts WHERE entity_type = 'CARRIER' AND entity_id = $1 AND is_active = true "
        "ORDER BY is_primary DESC, contact_role",
        carrier_id,
    )
    return [dict(r) for r in rows]


@router.post("/{carrier_id}/contacts", status_code=201)
async def create_carrier_contact(
    carrier_id: str, body: ContactCreateBody, pool=Depends(get_pool), user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    if body.entity_type != "CARRIER" or body.entity_id != carrier_id:
        raise HTTPException(422, "entity_type/entity_id del body deben coincidir con la ruta")
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.carriers WHERE id = $1", carrier_id):
                raise HTTPException(404, "Empresa no encontrada")
            row = await conn.fetchrow(
                """
                INSERT INTO public.contacts
                    (entity_id, entity_type, contact_role, first_name, last_name, job_title, email, phone, is_primary)
                VALUES ($1, 'CARRIER', $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active
                """,
                carrier_id, body.contact_role, body.first_name, body.last_name,
                body.job_title, body.email, body.phone, body.is_primary,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="CARRIER", entity_id=carrier_id,
                action="create", field="contact", new_value=body.contact_role, source="api",
            )
    return dict(row)


# ── Pólizas de seguro (H2.3 — ver routers/policies.py para el resto del CRUD) ──

@router.get("/{carrier_id}/policies")
async def list_carrier_policies(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    rows = await pool.fetch(
        """
        SELECT policy_id AS id, insurance_company, policy_number, coverage_names,
               total_assets_covered, policy_expiration_date, policy_health, missing_physical_file,
               total_installments, paid_installments, overdue_installments, next_payment_date
        FROM app.carrier_insurance_status WHERE carrier_id = $1
        ORDER BY policy_expiration_date NULLS LAST
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]


@router.post("/{carrier_id}/policies", status_code=201)
async def create_carrier_policy(
    carrier_id: str, body: InsurancePolicyCreateBody, pool=Depends(get_pool), user=Depends(require(Permission.POLICIES_EDIT)),
):
    if body.carrier_id != carrier_id:
        raise HTTPException(422, "carrier_id del body debe coincidir con la ruta")
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.carriers WHERE id = $1", carrier_id):
                raise HTTPException(404, "Empresa no encontrada")
            row = await conn.fetchrow(
                """
                INSERT INTO public.insurance_policies
                    (carrier_id, insurance_company, policy_number, valid_from, valid_to,
                     expiration_alert_days, has_endorsement, endorsement_number)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING id, carrier_id, insurance_company, policy_number, valid_from, valid_to,
                          expiration_alert_days, has_endorsement, endorsement_number, status, created_at
                """,
                carrier_id, body.insurance_company, body.policy_number, body.valid_from,
                body.valid_to, body.expiration_alert_days, body.has_endorsement, body.endorsement_number,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="CARRIER", entity_id=carrier_id,
                action="create", field="insurance_policy", new_value=str(row["id"]), source="api",
            )
    return dict(row)


# ── Documentos de la empresa: el panel único (Cert 3, Entrega B) ──

@router.get("/{carrier_id}/documents")
async def get_carrier_documents(
    carrier_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase),
    _=Depends(require(Permission.DIRECTORY_READ)),
):
    return await entity_documents(pool, supabase, "CARRIER", carrier_id)


# ── Clientes de la empresa (P10: se declaran; D2: con vigencia) ──

@router.get("/{carrier_id}/shippers")
async def list_carrier_shippers(carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ))):
    return await fleet_assignments.list_shippers(pool, carrier_id)


@router.post("/{carrier_id}/shippers", status_code=201)
async def add_carrier_shipper(
    carrier_id: str, body: CarrierShipperLinkBody, pool=Depends(get_pool),
    user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.assign(conn, fleet_assignments.SHIPPER, body.shipper_id, carrier_id,
                                           actor=user["sub"], effective=body.effective_date)
    return {"ok": True}


@router.delete("/{carrier_id}/shippers/{shipper_id}")
async def end_carrier_shipper(
    carrier_id: str, shipper_id: str, end_date: Optional[date] = None, pool=Depends(get_pool),
    user=Depends(require(Permission.DIRECTORY_EDIT)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            await fleet_assignments.end(conn, fleet_assignments.SHIPPER, shipper_id, carrier_id,
                                        actor=user["sub"], effective=end_date)
    return {"ok": True}


# ── Baja y reactivación (D2: P4 vista previa del impacto, P3 elegir la flota) ──

@router.get("/{carrier_id}/deactivation-impact")
async def carrier_deactivation_impact(
    carrier_id: str, pool=Depends(get_pool), _=Depends(require(Permission.DIRECTORY_READ)),
):
    async with pool.acquire() as conn:
        return await fleet_assignments.deactivation_impact(conn, carrier_id)


@router.post("/{carrier_id}/reactivate")
async def reactivate_carrier(
    carrier_id: str, body: CarrierReactivateBody, pool=Depends(get_pool),
    user=Depends(require(Permission.DIRECTORY_DELETE)),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            return await fleet_assignments.reactivate(
                conn, carrier_id, driver_ids=body.driver_ids, asset_ids=body.asset_ids, actor=user["sub"])
