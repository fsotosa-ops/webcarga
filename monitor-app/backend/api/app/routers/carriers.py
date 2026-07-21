"""Módulo Empresas — backend sobre public.carriers (H2.2). Reemplaza al
router de Checkpoint A-E (transporters.py/transporters_legacy.py, borrados
2026-07-16 junto con insurance.py viejo — ver AGENTLOG.md).
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.assignment import AssetAssignmentCreateBody, DriverAssignmentCreateBody
from ..schemas.carrier import CarrierCreateBody, CarrierListResponse, CarrierPatchBody
from ..schemas.common import PaginatedResponse
from ..schemas.contact import ContactCreateBody
from ..schemas.insurance import CarrierInsuranceOverviewResponse, InsurancePolicyCreateBody
from ..services.audit import log_change, record_manual_edit
from ..utils.document_storage import build_documents_zip, resolve_signed_url, safe_storage_name

router = APIRouter(prefix="/carriers", tags=["carriers"])


_CARRIER_HEALTH_VALUES = {"PENDING", "OK"}


def _pending_mandatory_join(entity_type: str, id_column: str) -> str:
    """Subquery de documentación LEGAL_MANDATORY pendiente/vencida para un
    entity_type dado — mismo criterio en los 3 niveles (CARRIER/DRIVER/ASSET,
    ver _CARRIER_LIST_AGG y mandatoryProblems en la ficha de empresa).
    `entity_type` siempre viene hardcodeado por el caller, nunca de request."""
    return f"""
        LEFT JOIN (
            SELECT cr.entity_id AS {id_column},
                   COUNT(*) FILTER (
                       WHERE req.requirement_level = 'LEGAL_MANDATORY'
                         AND (cr.status IN ('MISSING', 'EXPIRED', 'REJECTED')
                              OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE))
                   ) AS pending_mandatory
            FROM public.compliance_records cr
            JOIN public.compliance_requirements req ON req.id = cr.requirement_id
            WHERE cr.entity_type = '{entity_type}' AND cr.is_current = true
            GROUP BY cr.entity_id
        ) sev ON sev.{id_column} = r.{id_column}
    """

# Mismo criterio de "problema obligatorio" que `mandatoryProblems` en la ficha
# de empresa (app/dashboard/transportistas/empresa/[id]/page.tsx): requisito
# LEGAL_MANDATORY con status MISSING/EXPIRED/REJECTED o vencido por fecha
# (PENDING_REVIEW no cuenta como problema, ya está en revisión).
_CARRIER_LIST_AGG = """
    SELECT c.id AS carrier_id, c.tax_id, c.country_code, c.business_name, c.operational_status,
           COUNT(cr.id) AS total_requirements,
           MAX(cr.updated_at) AS last_document_update,
           COUNT(cr.id) FILTER (
               WHERE req.requirement_level = 'LEGAL_MANDATORY'
                 AND (cr.status IN ('MISSING', 'EXPIRED', 'REJECTED')
                      OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE))
           ) AS pending_mandatory,
           CASE
               WHEN COUNT(cr.id) FILTER (
                   WHERE req.requirement_level = 'LEGAL_MANDATORY'
                     AND (cr.status IN ('MISSING', 'EXPIRED', 'REJECTED')
                          OR (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE))
               ) > 0 THEN 'PENDING'
               ELSE 'OK'
           END AS compliance_health
    FROM public.carriers c
    LEFT JOIN public.compliance_records cr
        ON cr.entity_id = c.id AND cr.entity_type = 'CARRIER' AND cr.is_current = true
    LEFT JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    {where}
    GROUP BY c.id, c.tax_id, c.country_code, c.business_name, c.operational_status
"""


@router.get("", response_model=CarrierListResponse)
async def list_carriers(
    q: str = Query("", description="Buscar por nombre o tax_id"),
    operational_status: str = Query(""),
    health: str = Query("", description="PENDING|OK — filtra por documentación obligatoria pendiente"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    if health and health not in _CARRIER_HEALTH_VALUES:
        raise HTTPException(422, "health inválido")

    clauses: list[str] = []
    params: list = []
    if q:
        params.append(q)
        clauses.append(f"(c.business_name ILIKE '%' || ${len(params)} || '%' OR c.tax_id ILIKE '%' || ${len(params)} || '%')")
    if operational_status:
        params.append(operational_status)
        clauses.append(f"c.operational_status = ${len(params)}")
    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    agg_cte = f"WITH agg AS ({_CARRIER_LIST_AGG.format(where=where)})"

    health_params = list(params)
    if health:
        health_params.append(health)
        health_where = f"WHERE compliance_health = ${len(health_params)}"
    else:
        health_where = ""

    offset = (page - 1) * limit
    lp, op = len(health_params) + 1, len(health_params) + 2

    rows = await pool.fetch(
        f"""
        {agg_cte}
        SELECT carrier_id AS id, tax_id, country_code, business_name, operational_status,
               total_requirements, last_document_update, pending_mandatory, compliance_health
        FROM agg
        {health_where}
        ORDER BY
            CASE compliance_health WHEN 'PENDING' THEN 1 ELSE 2 END,
            pending_mandatory DESC,
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
            COUNT(*) FILTER (WHERE compliance_health = 'PENDING') AS pending,
            COUNT(*) FILTER (WHERE compliance_health = 'OK') AS ok,
            COUNT(*) AS total
        FROM agg
        """,
        *params,
    )
    return {
        "data": [dict(r) for r in rows],
        "count": count,
        "page": page,
        "limit": limit,
        "facets": dict(facets),
    }


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
    operational_status: str = Query("", description="ACTIVE|INACTIVE|LEGACY_INACTIVE — filtra por estado de la empresa, mismo eje que /carriers"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    if health and health != "NONE" and health not in _INSURANCE_HEALTH_VALUES:
        raise HTTPException(422, "health inválido")

    q_params: list = []
    q_clauses: list[str] = []
    if q:
        q_params.append(q)
        q_clauses.append(f"(c.business_name ILIKE '%' || ${len(q_params)} || '%' OR c.tax_id ILIKE '%' || ${len(q_params)} || '%')")
    if operational_status:
        q_params.append(operational_status)
        q_clauses.append(f"c.operational_status = ${len(q_params)}")
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
        """
        SELECT id, tax_id, country_code, business_name, operational_status,
               legacy_admin_id, erp_id, is_manual_override, overridden_by, overridden_at,
               created_at, updated_at
        FROM public.carriers WHERE id = $1
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
        """
        SELECT cr.id, cr.requirement_id, req.requirement_code, req.name, req.requirement_level,
               req.requires_file, cr.status, cr.expiration_date, cr.file_url, cr.metadata,
               cr.is_manual_override, cr.updated_at,
               (cr.expiration_date IS NOT NULL AND cr.expiration_date < CURRENT_DATE) AS is_expired,
               (cr.expiration_date IS NOT NULL AND cr.expiration_date >= CURRENT_DATE
                AND cr.expiration_date <= CURRENT_DATE + INTERVAL '30 days') AS is_expiring_soon
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

    return {
        **dict(carrier),
        "contacts": [dict(c) for c in contacts],
        "compliance_records": compliance_records,
    }


@router.get("/{carrier_id}")
async def get_carrier(
    carrier_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    return await _assemble_carrier_detail(carrier_id, pool, supabase)


@router.get("/{carrier_id}/documents/export")
async def export_carrier_documents(
    carrier_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
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
    body: CarrierCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
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
                INSERT INTO public.carriers (tax_id, country_code, business_name, operational_status)
                VALUES ($1, $2, $3, $4)
                RETURNING id, tax_id, country_code, business_name, operational_status, created_at
                """,
                body.tax_id, body.country_code, body.business_name, body.operational_status,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="CARRIER", entity_id=row["id"],
                action="create", source="api",
            )
    return dict(row)


@router.patch("/{carrier_id}")
async def patch_carrier(
    carrier_id: str, body: CarrierPatchBody, pool=Depends(get_pool),
    supabase=Depends(get_supabase), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT updated_at, business_name, operational_status FROM public.carriers WHERE id = $1",
                carrier_id,
            )
            if not current:
                raise HTTPException(404, "Empresa no encontrada")
            if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
                raise HTTPException(409, "El registro fue modificado por otro usuario; recargue e intente de nuevo")

            touched = body.sent_fields()
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.carriers SET
                    business_name = COALESCE($2, business_name),
                    operational_status = COALESCE($3, operational_status),
                    updated_at = NOW()
                WHERE id = $1
                """,
                carrier_id, body.business_name, body.operational_status,
            )
            for field in touched:
                await record_manual_edit(
                    conn, table="carriers", where={"id": carrier_id}, actor=user["sub"],
                    entity_type="CARRIER", entity_id=carrier_id, action="update", field=field,
                    old_value=current[field], new_value=getattr(body, field),
                )

    return await _assemble_carrier_detail(carrier_id, pool, supabase)


@router.delete("/{carrier_id}")
async def delete_carrier(carrier_id: str, pool=Depends(get_pool), user=Depends(require_editor)):
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
async def list_carrier_drivers(carrier_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        f"""
        SELECT r.driver_id AS id, r.tax_id, r.full_name, r.operational_status,
               r.total_requirements, r.last_document_update,
               COALESCE(sev.pending_mandatory, 0) AS pending_mandatory,
               CASE WHEN COALESCE(sev.pending_mandatory, 0) > 0 THEN 'PENDING' ELSE 'OK' END AS compliance_health
        FROM app.carrier_driver_roster r
        {_pending_mandatory_join('DRIVER', 'driver_id')}
        WHERE r.carrier_id = $1
        ORDER BY r.full_name
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]


@router.post("/{carrier_id}/drivers", status_code=201)
async def assign_driver(
    carrier_id: str, body: DriverAssignmentCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.carriers WHERE id = $1", carrier_id):
                raise HTTPException(404, "Empresa no encontrada")
            if not await conn.fetchval("SELECT 1 FROM public.drivers WHERE id = $1", body.driver_id):
                raise HTTPException(404, "Conductor no encontrado")

            # Desactivar la asignación ACTIVE previa en otra empresa (mismo
            # criterio que los loaders de Mage — Checkpoint M.5) salvo que
            # esté protegida por un override manual.
            await conn.execute(
                """
                UPDATE public.driver_assignments
                SET status = 'INACTIVE'
                WHERE driver_id = $1 AND carrier_id <> $2 AND status = 'ACTIVE'
                  AND NOT is_manual_override
                """,
                body.driver_id, carrier_id,
            )
            await conn.execute(
                """
                INSERT INTO public.driver_assignments (driver_id, carrier_id, status)
                VALUES ($1, $2, 'ACTIVE')
                ON CONFLICT (driver_id, carrier_id) DO UPDATE SET status = 'ACTIVE'
                WHERE NOT driver_assignments.is_manual_override
                """,
                body.driver_id, carrier_id,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="DRIVER", entity_id=body.driver_id,
                action="assign", field="carrier_id", new_value=carrier_id, source="api",
            )
    return {"ok": True}


@router.delete("/{carrier_id}/drivers/{driver_id}")
async def unassign_driver(
    carrier_id: str, driver_id: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "UPDATE public.driver_assignments SET status = 'INACTIVE' "
                "WHERE driver_id = $1 AND carrier_id = $2 AND status = 'ACTIVE'",
                driver_id, carrier_id,
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Asignación activa no encontrada")
            await record_manual_edit(
                conn, table="driver_assignments", where={"driver_id": driver_id, "carrier_id": carrier_id},
                actor=user["sub"], entity_type="DRIVER", entity_id=driver_id,
                action="unassign", field="status", old_value="ACTIVE", new_value="INACTIVE",
            )
    return {"ok": True}


@router.get("/{carrier_id}/assets")
async def list_carrier_assets(carrier_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        f"""
        SELECT r.asset_id AS id, r.license_plate, r.asset_type, r.operational_status,
               r.total_requirements, r.last_document_update,
               COALESCE(sev.pending_mandatory, 0) AS pending_mandatory,
               CASE WHEN COALESCE(sev.pending_mandatory, 0) > 0 THEN 'PENDING' ELSE 'OK' END AS compliance_health
        FROM app.carrier_asset_roster r
        {_pending_mandatory_join('ASSET', 'asset_id')}
        WHERE r.carrier_id = $1
        ORDER BY r.license_plate
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]


@router.post("/{carrier_id}/assets", status_code=201)
async def assign_asset(
    carrier_id: str, body: AssetAssignmentCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            if not await conn.fetchval("SELECT 1 FROM public.carriers WHERE id = $1", carrier_id):
                raise HTTPException(404, "Empresa no encontrada")
            if not await conn.fetchval("SELECT 1 FROM public.assets WHERE id = $1", body.asset_id):
                raise HTTPException(404, "Activo no encontrado")

            await conn.execute(
                """
                UPDATE public.asset_assignments
                SET status = 'INACTIVE'
                WHERE asset_id = $1 AND carrier_id <> $2 AND status = 'ACTIVE'
                  AND NOT is_manual_override
                """,
                body.asset_id, carrier_id,
            )
            await conn.execute(
                """
                INSERT INTO public.asset_assignments (asset_id, carrier_id, status)
                VALUES ($1, $2, 'ACTIVE')
                ON CONFLICT (asset_id, carrier_id) DO UPDATE SET status = 'ACTIVE'
                WHERE NOT asset_assignments.is_manual_override
                """,
                body.asset_id, carrier_id,
            )
            await log_change(
                conn, actor=user["sub"], entity_type="ASSET", entity_id=body.asset_id,
                action="assign", field="carrier_id", new_value=carrier_id, source="api",
            )
    return {"ok": True}


@router.delete("/{carrier_id}/assets/{asset_id}")
async def unassign_asset(
    carrier_id: str, asset_id: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "UPDATE public.asset_assignments SET status = 'INACTIVE' "
                "WHERE asset_id = $1 AND carrier_id = $2 AND status = 'ACTIVE'",
                asset_id, carrier_id,
            )
            if result == "UPDATE 0":
                raise HTTPException(404, "Asignación activa no encontrada")
            await record_manual_edit(
                conn, table="asset_assignments", where={"asset_id": asset_id, "carrier_id": carrier_id},
                actor=user["sub"], entity_type="ASSET", entity_id=asset_id,
                action="unassign", field="status", old_value="ACTIVE", new_value="INACTIVE",
            )
    return {"ok": True}


# ── Contactos (polimórfico — alta anidada bajo carrier, edición flat en routers/contacts.py) ──

@router.get("/{carrier_id}/contacts")
async def list_carrier_contacts(carrier_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT id, contact_role, first_name, last_name, job_title, email, phone, is_primary, is_active "
        "FROM public.contacts WHERE entity_type = 'CARRIER' AND entity_id = $1 AND is_active = true "
        "ORDER BY is_primary DESC, contact_role",
        carrier_id,
    )
    return [dict(r) for r in rows]


@router.post("/{carrier_id}/contacts", status_code=201)
async def create_carrier_contact(
    carrier_id: str, body: ContactCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
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
async def list_carrier_policies(carrier_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
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
    carrier_id: str, body: InsurancePolicyCreateBody, pool=Depends(get_pool), user=Depends(require_editor),
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
                action="create", field="insurance_policy", new_value=row["id"], source="api",
            )
    return dict(row)


# ── Generadores de carga (public.carrier_shippers M:N, solo lectura por ahora) ──

@router.get("/{carrier_id}/shippers")
async def list_carrier_shippers(carrier_id: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        """
        SELECT s.id, s.name, cs.status, cs.start_date, cs.end_date
        FROM public.carrier_shippers cs
        JOIN public.shippers s ON s.id = cs.shipper_id
        WHERE cs.carrier_id = $1
        ORDER BY s.name
        """,
        carrier_id,
    )
    return [dict(r) for r in rows]
