"""public.compliance_records — PATCH libre de status/expiration_date +
endpoint de archivos (H2.4). El upload es el "camino feliz" real: a
diferencia de la implementación vieja (solo persiste storage_path plano y
nunca transiciona status), este SIEMPRE deja status='APPROVED_MANUAL' y
persiste la evidencia en el JSONB metadata — ver context_carriers.md §4.2.
No existe un proceso de due diligence separado del negocio hoy: quien sube
el archivo ya lo revisó, no queda un estado intermedio "en revisión"
(decisión explícita del usuario 2026-07-18) — PENDING_REVIEW sigue siendo
un valor válido del CHECK constraint (datos legacy), pero nada nuevo lo
setea.
"""
import json
from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..schemas.carrier import ACTIVE_OPERATIONAL_STATUS
from ..schemas.compliance import (
    ReassignBody,
    ComplianceRecordPatchBody,
    PendingComplianceListResponse,
    RequirementOption,
)
from ..services.audit import log_change, record_manual_edit
from ..utils.document_storage import (
    delete_document_version, get_document_history, log_document_replacement, resolve_signed_url,
    upload_document_version,
)

router = APIRouter(prefix="/compliance-records", tags=["compliance"])

_CATEGORY_BY_ENTITY_TYPE = {"CARRIER": "EMPRESA", "DRIVER": "CHOFER", "ASSET": "EQUIPO"}


def _certification_type(requirement_level: str) -> str:
    return "BASICA" if requirement_level == "LEGAL_MANDATORY" else "ADICIONAL"


async def _fetch_record(record_id: str, pool, supabase=None) -> dict:
    row = await pool.fetchrow(
        """
        SELECT cr.id, cr.entity_id, cr.entity_type, cr.requirement_id, req.requirement_code, req.name,
               req.requirement_level, req.requires_file, cr.status, cr.expiration_date, cr.file_url,
               cr.metadata, cr.is_manual_override, cr.created_at, cr.updated_at
        FROM public.compliance_records cr
        JOIN public.compliance_requirements req ON req.id = cr.requirement_id
        WHERE cr.id = $1 AND cr.is_current = true
        """,
        record_id,
    )
    if not row:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")
    record = dict(row)
    # file_url guarda el storage_path crudo (ver upload_compliance_file) — el
    # bucket no es público, hay que firmarlo antes de devolverlo al frontend.
    if supabase is not None:
        record["file_url"] = resolve_signed_url(supabase, record["file_url"])
    return record


# Cada agrupación cambia sólo dos cosas: por qué entidad se agrupa y de dónde
# sale su nombre. El resto de la consulta es idéntico, así que se parametriza en
# vez de escribir tres consultas que después divergen.
_STATUS_GROUPS = {
    "carrier": {
        "entity_type": "CARRIER",
        "table": "public.carriers",
        "name_col": "business_name",
    },
    "driver": {
        "entity_type": "DRIVER",
        "table": "public.drivers",
        "name_col": "full_name",
    },
    "asset": {
        "entity_type": "ASSET",
        "table": "public.assets",
        "name_col": "license_plate",
    },
}


@router.get("/status")
async def get_certification_status(
    group: Literal["carrier", "driver", "asset"] = Query("carrier"),
    carrier_id: str | None = Query(None),
    q: str = Query(""),
    limit: int = Query(200, le=500),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Cómo va la certificación, agrupada por empresa, conductor o vehículo.

    Es la misma lista mirada de tres maneras (HU-04). Un conductor o un vehículo
    sin la empresa a la que pertenece no dice nada, así que **la fila siempre
    trae su empresa** — cuando se agrupa por empresa, es ella misma.

    Los documentos sin clasificar sólo se cuentan agrupando por empresa: un
    archivo en la bandeja pertenece a una empresa, no a un conductor.

    Con `carrier_id` se acota a la flota de una empresa. Es lo que usa el panel
    de detalle, y a propósito por la misma consulta: así el "N de M" de un
    conductor es idéntico mirándolo desde la lista o desde su empresa.
    """
    cfg = _STATUS_GROUPS[group]

    if group == "carrier":
        # La empresa suma lo suyo y lo de sus conductores y vehículos activos,
        # mismo criterio de atribución que el resto del roster.
        entity_join = """
            LEFT JOIN attributed a ON a.carrier_id = e.id
            LEFT JOIN docs d       ON d.carrier_id = e.id
        """
        if carrier_id:
            # Acotado a una empresa, el filtro por estado operativo sobra: la
            # pidieron por id. Y dejar un $n sin referenciar hace que Postgres
            # rechace la sentencia entera, asi que se renumera.
            entity_where = "e.id = $3::uuid"
        else:
            entity_where = "(e.operational_status = $1 OR COALESCE(d.unclassified, 0) > 0)"
        # Sólo esta agrupación filtra por estado operativo, así que sólo ella
        # recibe ese parámetro. Numerar de más deja un $1 sin referenciar y
        # Postgres rechaza la sentencia entera.
        if carrier_id:
            params: list = [q, limit, carrier_id]
            p_q, p_limit = "$1", "$2"
        else:
            params = [ACTIVE_OPERATIONAL_STATUS, q, limit]
            p_q, p_limit = "$2", "$3"
        carrier_cols = "e.id::text AS carrier_id, e.business_name AS carrier_name, e.operational_status"
        group_by = "e.id, e.business_name, e.operational_status, d.unclassified"
        unclassified = "COALESCE(d.unclassified, 0)::int"
        # Sólo agrupando por empresa hay algo que ordenar por acá.
        orden_cola = "COALESCE(d.unclassified, 0) DESC, "
        extra_cte = """,
        docs AS (
            SELECT COALESCE(i.carrier_id, b.carrier_id) AS carrier_id, count(*) AS unclassified
            FROM public.document_ingest_items i
            JOIN public.document_ingest_batches b ON b.id = i.batch_id
            WHERE i.match_status = 'UNMATCHED'
            GROUP BY 1
        )"""
    else:
        asignacion = "driver_assignments" if group == "driver" else "asset_assignments"
        columna = "driver_id" if group == "driver" else "asset_id"
        entity_join = f"""
            LEFT JOIN records r ON r.entity_type = '{cfg["entity_type"]}' AND r.entity_id = e.id
            LEFT JOIN public.{asignacion} asg
                   ON asg.{columna} = e.id AND asg.status = 'ACTIVE'
            LEFT JOIN public.carriers c ON c.id = asg.carrier_id
        """
        entity_where = "r.entity_id IS NOT NULL"
        carrier_cols = "c.id::text AS carrier_id, c.business_name AS carrier_name, c.operational_status"
        group_by = "e.id, e.{name_col}, c.id, c.business_name, c.operational_status".format(**cfg)
        unclassified = "0"
        # OJO: un literal en ORDER BY lo interpreta Postgres como POSICIÓN
        # ordinal ("ORDER BY 0" es un error), así que acá no va.
        orden_cola = ""
        extra_cte = ""
        params = [q, limit]
        p_q, p_limit = "$1", "$2"
        if carrier_id:
            entity_where += " AND asg.carrier_id = $3::uuid"
            params.append(carrier_id)

    # Agrupando por empresa el agregado sale de `attributed`; en las otras dos,
    # de las filas del propio conductor o vehículo.
    fuente = "a" if group == "carrier" else "r"

    rows = await pool.fetch(
        f"""
        WITH records AS (
            SELECT cr.entity_type, cr.entity_id, cr.status, req.requirement_level
            FROM public.compliance_records cr
            JOIN public.compliance_requirements req ON req.id = cr.requirement_id
            WHERE cr.is_current = true
        ),
        attributed AS (
            SELECT r.status, r.requirement_level,
                CASE r.entity_type
                    WHEN 'CARRIER' THEN r.entity_id
                    WHEN 'DRIVER'  THEN da.carrier_id
                    WHEN 'ASSET'   THEN aa.carrier_id
                END AS carrier_id
            FROM records r
            LEFT JOIN public.driver_assignments da
                ON r.entity_type = 'DRIVER' AND da.driver_id = r.entity_id AND da.status = 'ACTIVE'
            LEFT JOIN public.asset_assignments aa
                ON r.entity_type = 'ASSET' AND aa.asset_id = r.entity_id AND aa.status = 'ACTIVE'
        ){extra_cte}
        SELECT e.id::text AS entity_id, e.{cfg["name_col"]} AS entity_name,
               {carrier_cols},
               count({fuente}.status)                                              AS total_count,
               count(*) FILTER (WHERE {fuente}.status IS NOT NULL
                                  AND {fuente}.status NOT IN ('MISSING','EXPIRED')) AS satisfied_count,
               count(*) FILTER (WHERE {fuente}.status IN ('MISSING','EXPIRED'))     AS pending_count,
               count(*) FILTER (WHERE {fuente}.status IN ('MISSING','EXPIRED')
                                  AND {fuente}.requirement_level = 'LEGAL_MANDATORY') AS pending_mandatory,
               {unclassified}                                                      AS unclassified_count
        FROM {cfg["table"]} e
        {entity_join}
        WHERE {entity_where}
          AND e.{cfg["name_col"]} ILIKE '%' || {p_q}::text || '%'
        GROUP BY {group_by}
        -- Primero donde hay trabajo esperando, después lo más incompleto.
        ORDER BY {orden_cola}pending_count DESC, e.{cfg["name_col"]}
        LIMIT {p_limit}
        """,
        *params,
    )
    result = [dict(r) for r in rows]
    return {
        "total_pending": sum(r["pending_count"] for r in result),
        "total_unclassified": sum(r["unclassified_count"] for r in result),
        "rows": result,
    }


_PENDING_ROWS_SQL = """
WITH pending AS (
    SELECT cr.id, cr.entity_type, cr.entity_id, cr.status, cr.expiration_date,
           req.id AS requirement_id,
           req.requirement_code, req.name AS document_name, req.requirement_level
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON req.id = cr.requirement_id
    WHERE cr.is_current = true AND cr.status IN ('MISSING', 'EXPIRED')
),
resolved AS (
    SELECT p.*,
        CASE p.entity_type
            WHEN 'CARRIER' THEN p.entity_id
            WHEN 'DRIVER'  THEN da.carrier_id
            WHEN 'ASSET'   THEN aa.carrier_id
        END AS resolved_carrier_id,
        CASE p.entity_type
            WHEN 'DRIVER' THEN d.full_name
            WHEN 'ASSET'  THEN a.license_plate
            ELSE NULL
        END AS subject_name
    FROM pending p
    LEFT JOIN public.driver_assignments da
        ON p.entity_type = 'DRIVER' AND da.driver_id = p.entity_id AND da.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
        ON p.entity_type = 'ASSET' AND aa.asset_id = p.entity_id AND aa.status = 'ACTIVE'
    LEFT JOIN public.drivers d ON p.entity_type = 'DRIVER' AND d.id = p.entity_id
    LEFT JOIN public.assets a ON p.entity_type = 'ASSET' AND a.id = p.entity_id
),
-- Tipo de Operación (Tractoreo/Equipo Completo) a nivel EMPRESA: no existe
-- como columna propia de carriers — se agrega desde los vehículos activos
-- de la empresa (public.assets.webcarga_operation_type_id). Una empresa
-- con flota mixta aparece con ambos valores, no se fuerza uno solo
-- (confirmado con datos reales, Ronda 85 de AGENTLOG: 36 de 80
-- tractocamiones son "Equipo Completo" mientras el resto de la empresa
-- puede ser "Tractoreo").
carrier_operation_types AS (
    SELECT aa.carrier_id, array_agg(DISTINCT wot.label) AS operation_types
    FROM public.asset_assignments aa
    JOIN public.assets a ON a.id = aa.asset_id
    JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id
    WHERE aa.status = 'ACTIVE'
    GROUP BY aa.carrier_id
)
SELECT
    r.id::text, r.entity_type, r.entity_id::text, r.subject_name,
    r.requirement_id, r.requirement_code, r.document_name, r.requirement_level, r.status, r.expiration_date,
    c.id::text AS carrier_id, c.business_name AS carrier_name, c.tax_id AS carrier_tax_id,
    COALESCE(cot.operation_types, ARRAY[]::text[]) AS carrier_operation_types,
    count(*) OVER() AS total_count
FROM resolved r
JOIN public.carriers c ON c.id = r.resolved_carrier_id
LEFT JOIN carrier_operation_types cot ON cot.carrier_id = c.id
WHERE c.operational_status = $8
  AND ($1::uuid IS NULL OR c.id = $1)
  AND ($2::text IS NULL OR r.entity_type = $2)
  AND ($3::text IS NULL OR r.requirement_code = $3)
  AND ($4::text IS NULL OR c.business_name ILIKE '%' || $4 || '%' OR r.subject_name ILIKE '%' || $4 || '%')
  AND ($5::text IS NULL OR $5 = ANY(COALESCE(cot.operation_types, ARRAY[]::text[])))
ORDER BY c.business_name, r.entity_type, r.subject_name
LIMIT $6 OFFSET $7
"""


@router.get("/pending", response_model=PendingComplianceListResponse)
async def list_pending_compliance_records(
    carrier_id: Optional[str] = Query(None),
    category: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = Query(None),
    requirement_code: Optional[str] = Query(None),
    q: str = Query(""),
    operation_type: Optional[Literal["Tractoreo", "Equipo Completo"]] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Módulo Documentos (sábana) — un `compliance_record` pendiente por
    fila, cruzando toda la flota en vez de navegar empresa por empresa. Ver
    docs/superpowers/plans (plan del módulo). Reusa el mismo criterio de
    atribución DRIVER/ASSET→empresa que `pending-summary`, a nivel de fila.
    Solo empresas activas (bug 5.4): antes traía también LEGACY_INACTIVE/
    INACTIVE/ONBOARDING — confirmado contra datos reales que eran más de la
    mitad del volumen mostrado."""
    rows = await pool.fetch(
        _PENDING_ROWS_SQL,
        carrier_id, category, requirement_code, q or None, operation_type, limit, offset,
        ACTIVE_OPERATIONAL_STATUS,
    )
    total = rows[0]["total_count"] if rows else 0
    result_rows = [
        {
            "id": r["id"],
            "carrier_id": r["carrier_id"],
            "carrier_name": r["carrier_name"],
            "carrier_tax_id": r["carrier_tax_id"],
            "carrier_operation_types": list(r["carrier_operation_types"]),
            "certification_type": _certification_type(r["requirement_level"]),
            "category": _CATEGORY_BY_ENTITY_TYPE[r["entity_type"]],
            "entity_type": r["entity_type"],
            "entity_id": r["entity_id"],
            "subject_name": r["subject_name"],
            "requirement_id": str(r["requirement_id"]),
            "requirement_code": r["requirement_code"],
            "document_name": r["document_name"],
            "status": r["status"],
            "expiration_date": r["expiration_date"],
        }
        for r in rows
    ]
    return {"total": total, "rows": result_rows}


@router.get("/{record_id}")
async def get_compliance_record(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    return await _fetch_record(record_id, pool, supabase)


@router.post("/{record_id}/reassign")
async def reassign_compliance_document(
    record_id: str,
    body: ReassignBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Corrige un documento cargado en el lugar equivocado (HU-03).

    Dos operaciones que cubren las cuatro variantes de la HU:
    - con destino → lo mueve a otro requisito, de la misma entidad o de otra;
    - con `to_tray` → lo devuelve a la bandeja de sin clasificar.

    "A otra empresa" se compone: devolver a la bandeja y después mover el item,
    que es la operación que ya existe.

    **El archivo nunca se copia ni se borra**: viaja el mismo `storage_path`.
    Es lo único irrecuperable del sistema, así que reasignar mueve la
    referencia y nada más.
    """
    tiene_destino = bool(body.target_entity_type and body.target_entity_id and body.target_requirement_id)
    if not tiene_destino and not body.to_tray:
        raise HTTPException(422, "Indicá un destino o devolvelo a sin clasificar")
    if tiene_destino and body.to_tray:
        raise HTTPException(422, "O se reasigna a un requisito o se devuelve a la bandeja, no ambos")

    async with pool.acquire() as conn:
        async with conn.transaction():
            origen = await conn.fetchrow(
                "SELECT id::text, entity_type, entity_id::text, status, expiration_date, "
                "file_url, metadata FROM public.compliance_records "
                "WHERE id = $1 AND is_current = true",
                record_id,
            )
            if not origen:
                raise HTTPException(404, "Registro de cumplimiento no encontrado")
            if not origen["file_url"]:
                raise HTTPException(422, "Ese requisito no tiene ningún archivo que reasignar")

            storage_path = origen["file_url"]
            meta = origen["metadata"] or {}
            if isinstance(meta, str):
                meta = json.loads(meta)

            if body.to_tray:
                # Vuelve a la bandeja de la empresa a la que pertenece hoy.
                carrier_id = await conn.fetchval(
                    """
                    SELECT CASE $2::text
                        WHEN 'CARRIER' THEN $1::uuid
                        WHEN 'DRIVER'  THEN (SELECT carrier_id FROM public.driver_assignments
                                             WHERE driver_id = $1::uuid AND status = 'ACTIVE' LIMIT 1)
                        WHEN 'ASSET'   THEN (SELECT carrier_id FROM public.asset_assignments
                                             WHERE asset_id = $1::uuid AND status = 'ACTIVE' LIMIT 1)
                    END
                    """,
                    origen["entity_id"], origen["entity_type"],
                )
                if not carrier_id:
                    raise HTTPException(
                        422,
                        "No se puede devolver a la bandeja: la entidad no tiene una empresa activa asignada",
                    )
                batch_id = await conn.fetchval(
                    """
                    INSERT INTO public.document_ingest_batches
                        (carrier_id, source, status, created_by, total_files, unmatched)
                    VALUES ($1, 'UPLOAD', 'REVIEW', $2, 1, 1)
                    RETURNING id::text
                    """,
                    carrier_id, user["sub"],
                )
                await conn.execute(
                    """
                    INSERT INTO public.document_ingest_items
                        (batch_id, storage_path, file_name, mime_type, size_bytes, match_status)
                    VALUES ($1::uuid, $2, $3, $4, $5, 'UNMATCHED')
                    """,
                    batch_id, storage_path,
                    meta.get("file_name") or storage_path.rsplit("/", 1)[-1],
                    meta.get("mime_type"), meta.get("size_bytes"),
                )
            else:
                destino = await conn.fetchrow(
                    """
                    SELECT id::text, entity_id::text, entity_type, status, expiration_date
                    FROM public.compliance_records
                    WHERE entity_id = $1 AND requirement_id = $2 AND is_current = true
                    """,
                    body.target_entity_id, body.target_requirement_id,
                )
                if not destino:
                    raise HTTPException(
                        404,
                        "Esa entidad no tiene ese requisito. Verificá la categoría y el tipo de documento.",
                    )
                await _apply_stored_document(
                    conn, destino["id"],
                    storage_path=storage_path,
                    file_name=meta.get("file_name") or storage_path.rsplit("/", 1)[-1],
                    mime_type=meta.get("mime_type"), size_bytes=meta.get("size_bytes"),
                    expiration_date=origen["expiration_date"], actor=user["sub"],
                    entity_type=destino["entity_type"], entity_id=destino["entity_id"],
                    old_status=destino["status"],
                )

            # El origen queda como estaba antes de la carga equivocada.
            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = 'MISSING', file_url = NULL, metadata = '{}'::jsonb,
                    expiration_date = NULL, updated_at = NOW()
                WHERE id = $1
                """,
                record_id,
            )
            await log_change(
                conn, actor=user["sub"], entity_type=origen["entity_type"],
                entity_id=origen["entity_id"], action="document_reassign",
                field="file_url", old_value=storage_path,
                new_value="bandeja" if body.to_tray else body.target_requirement_id,
            )

    return {"ok": True, "to_tray": body.to_tray}


@router.patch("/{record_id}")
async def patch_compliance_record(
    record_id: str, body: ComplianceRecordPatchBody, pool=Depends(get_pool),
    supabase=Depends(get_supabase), user=Depends(require_editor),
):
    """Override manual libre (ej. un admin aprueba a mano sin archivo). Para
    subir evidencia real, usar POST /{record_id}/file — ese fuerza
    APPROVED_MANUAL en vez de dejar setear cualquier status a mano."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT entity_id, entity_type, status, expiration_date FROM public.compliance_records "
                "WHERE id = $1 AND is_current = true",
                record_id,
            )
            if not current:
                raise HTTPException(404, "Registro de cumplimiento no encontrado")

            touched = [f for f in ("status", "expiration_date") if getattr(body, f) is not None]
            if not touched:
                raise HTTPException(422, "Ningún campo enviado")

            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = COALESCE($2, status),
                    expiration_date = COALESCE($3, expiration_date),
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id, body.status, body.expiration_date,
            )
            for field in touched:
                old = current[field]
                new = getattr(body, field)
                await record_manual_edit(
                    conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                    entity_type=current["entity_type"], entity_id=current["entity_id"],
                    action="update", field=field,
                    old_value=old.isoformat() if hasattr(old, "isoformat") else old,
                    new_value=new.isoformat() if hasattr(new, "isoformat") else new,
                )
    return await _fetch_record(record_id, pool, supabase)


async def _apply_compliance_upload(
    record_id: str, file: UploadFile, pool, supabase, user,
    expiration_date: date | None = None,
) -> dict:
    """Extraído de upload_compliance_file (endpoint singular) para reusar
    exactamente la misma lógica de status/metadata/auditoría desde el
    endpoint de carga masiva (POST /bulk-file) — un solo lugar que decide
    qué pasa cuando se sube un archivo a un compliance_record.

    `expiration_date` es opcional y se aplica con COALESCE: si no viene, se
    preserva la que ya estuviera declarada. Antes esta función no la escribía
    nunca, así que un documento subido quedaba con la fecha en NULL y — como
    /pending filtra por status — desaparecía de pendientes para siempre."""
    current = await pool.fetchrow(
        "SELECT entity_id, entity_type, status, expiration_date, metadata FROM public.compliance_records "
        "WHERE id = $1 AND is_current = true",
        record_id,
    )
    if not current:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")

    key_prefix = f"{current['entity_type'].lower()}/{current['entity_id']}/{record_id}"
    uploaded = await upload_document_version(supabase, key_prefix=key_prefix, file=file)

    old_metadata = current["metadata"] or {}
    if isinstance(old_metadata, str):
        old_metadata = json.loads(old_metadata)
    old_storage_path = old_metadata.get("storage_path")
    new_metadata = {
        **old_metadata,
        "storage_path": uploaded["storage_path"],
        "file_name": uploaded["file_name"],
        "mime_type": uploaded["mime_type"],
        "size_bytes": uploaded["size_bytes"],
    }

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = 'APPROVED_MANUAL',
                    file_url = $2,
                    metadata = $3::jsonb,
                    expiration_date = COALESCE($4, expiration_date),
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id, uploaded["storage_path"], json.dumps(new_metadata),
                expiration_date,
            )
            await record_manual_edit(
                conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                entity_type=current["entity_type"], entity_id=current["entity_id"],
                action="document_upload", field="status",
                old_value=current["status"], new_value="APPROVED_MANUAL",
            )
            if old_storage_path:
                await log_document_replacement(
                    conn, entity_type=current["entity_type"], entity_id=current["entity_id"],
                    doc_name=f"compliance_record:{record_id}",
                    old_status=current["status"], old_expiry_date=current["expiration_date"],
                    old_storage_path=old_storage_path, actor=user["sub"],
                )

    return {"status": "APPROVED_MANUAL", **uploaded}


async def _apply_stored_document(
    conn, record_id: str, *, storage_path: str, file_name: str,
    mime_type: str | None, size_bytes: int | None,
    expiration_date: date | None, actor: str, entity_type: str, entity_id: str,
    old_status: str,
) -> None:
    """Aplica a un compliance_record un archivo que YA está en storage.

    Contraparte de _apply_compliance_upload para el flujo de la bandeja de sin
    clasificar: ahí el archivo se sube antes de saber a qué requisito
    pertenece, así que cuando se decide ya no hay un UploadFile que leer, solo
    un storage_path. El efecto sobre el record es idéntico (mismo UPDATE,
    misma auditoría) — no se duplica el blob, se referencia el existente.

    Recibe `conn` en vez de `pool` porque el llamador ya está dentro de una
    transacción (marcar el item y aplicar el documento tienen que ser atómicos).

    Si el requisito YA tenía un archivo, registra el reemplazo en audit_log
    antes de pisarlo — igual que `_apply_compliance_upload`. Sin esto el
    puntero al archivo anterior se pierde: el blob sigue en storage (nunca se
    sobrescribe) pero nada permite volver a encontrarlo.
    """
    current = await conn.fetchrow(
        "SELECT metadata, expiration_date FROM public.compliance_records WHERE id = $1",
        record_id,
    )
    old_metadata = (current["metadata"] if current else None) or {}
    if isinstance(old_metadata, str):
        old_metadata = json.loads(old_metadata)
    old_storage_path = old_metadata.get("storage_path")
    if old_storage_path:
        await log_document_replacement(
            conn, entity_type=entity_type, entity_id=entity_id,
            doc_name=f"compliance_record:{record_id}",
            old_status=old_status,
            old_expiry_date=current["expiration_date"] if current else None,
            old_storage_path=old_storage_path, actor=actor,
        )

    metadata = {
        "storage_path": storage_path, "file_name": file_name,
        "mime_type": mime_type, "size_bytes": size_bytes,
    }
    # Deja rastro de que este documento piso a otro. Sin esta marca, deshacer
    # la clasificacion volveria el requisito a MISSING y borraria un documento
    # que era valido antes de la operacion.
    if old_storage_path:
        metadata["replaced_storage_path"] = old_storage_path
    await conn.execute(
        """
        UPDATE public.compliance_records SET
            status = 'APPROVED_MANUAL',
            file_url = $2,
            metadata = $3::jsonb,
            expiration_date = COALESCE($4, expiration_date),
            updated_at = NOW()
        WHERE id = $1
        """,
        record_id, storage_path, json.dumps(metadata), expiration_date,
    )
    await record_manual_edit(
        conn, table="compliance_records", where={"id": record_id}, actor=actor,
        entity_type=entity_type, entity_id=entity_id,
        action="document_upload", field="status",
        old_value=old_status, new_value="APPROVED_MANUAL",
    )


@router.post("/{record_id}/file", status_code=201)
async def upload_compliance_file(
    record_id: str,
    file: UploadFile = File(...),
    expiration_date: Optional[date] = Form(None),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    return await _apply_compliance_upload(record_id, file, pool, supabase, user, expiration_date)


_BULK_UPLOAD_MAX_FILES = 30


@router.post("/bulk-file")
async def bulk_upload_compliance_files(
    carrier_id: str = Form(...),
    record_ids: list[str] = Form(...),
    files: list[UploadFile] = File(...),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    """Módulo Documentos — carga masiva restringida a UNA empresa por vez
    (regla de negocio del diseño validado en Figma: "no es posible subir
    masivamente archivos de varias empresas"). `record_ids`/`files` son dos
    arrays paralelos por índice — el emparejamiento archivo↔record_id lo
    hace el usuario en el modal (arrastra cada archivo a su fila del
    checklist), no hay auto-matching por nombre de archivo (sin precedente
    confiable para eso en esta app). Procesamiento por archivo, NO
    todo-o-nada: un archivo con MIME inválido no tumba el resto del lote —
    mismo criterio que el riesgo documentado en el diseño validado
    ("si el documento se sube en un formato no reconocido, se rechaza y no
    avanza de status", no dice "se rechaza todo el lote")."""
    if len(files) != len(record_ids):
        raise HTTPException(422, "record_ids y files deben tener la misma cantidad de elementos")
    if not files:
        raise HTTPException(422, "No se envió ningún archivo")
    if len(files) > _BULK_UPLOAD_MAX_FILES:
        raise HTTPException(422, f"Máximo {_BULK_UPLOAD_MAX_FILES} archivos por carga masiva")
    if len(set(record_ids)) != len(record_ids):
        raise HTTPException(422, "record_ids duplicados en la misma carga")

    # Defensa en profundidad de "una sola empresa": no confiar solo en que
    # el frontend deshabilite el botón — cada record_id debe resolver al
    # carrier_id recibido (mismo criterio de atribución que /pending).
    owner_rows = await pool.fetch(
        """
        SELECT cr.id::text AS record_id,
            CASE cr.entity_type
                WHEN 'CARRIER' THEN cr.entity_id
                WHEN 'DRIVER'  THEN da.carrier_id
                WHEN 'ASSET'   THEN aa.carrier_id
            END AS resolved_carrier_id
        FROM public.compliance_records cr
        LEFT JOIN public.driver_assignments da
            ON cr.entity_type = 'DRIVER' AND da.driver_id = cr.entity_id AND da.status = 'ACTIVE'
        LEFT JOIN public.asset_assignments aa
            ON cr.entity_type = 'ASSET' AND aa.asset_id = cr.entity_id AND aa.status = 'ACTIVE'
        WHERE cr.id = ANY($1::uuid[])
        """,
        record_ids,
    )
    owner_by_record = {r["record_id"]: r["resolved_carrier_id"] for r in owner_rows}
    mismatched = [
        rid for rid in record_ids
        if str(owner_by_record.get(rid)) != carrier_id
    ]
    if mismatched:
        raise HTTPException(
            422,
            f"Estos registros no pertenecen a la empresa {carrier_id}, no se puede subir en el mismo lote: {mismatched}",
        )

    uploaded, errors = [], []
    for record_id, file in zip(record_ids, files):
        try:
            result = await _apply_compliance_upload(record_id, file, pool, supabase, user)
            uploaded.append({"record_id": record_id, **result})
        except HTTPException as e:
            errors.append({"record_id": record_id, "file_name": file.filename, "error": str(e.detail)})
    return {"uploaded": uploaded, "errors": errors}


@router.delete("/{record_id}/file")
async def delete_compliance_file(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    """Borra la evidencia cargada y vuelve el registro a MISSING — mismo
    estado que un documento nunca subido (decisión explícita del usuario
    2026-07-18, no queda un estado "archivado" intermedio)."""
    async with pool.acquire() as conn:
        async with conn.transaction():
            current = await conn.fetchrow(
                "SELECT entity_id, entity_type, status, metadata FROM public.compliance_records "
                "WHERE id = $1 AND is_current = true",
                record_id,
            )
            if not current:
                raise HTTPException(404, "Registro de cumplimiento no encontrado")

            metadata = current["metadata"] or {}
            if isinstance(metadata, str):
                metadata = json.loads(metadata)
            storage_path = metadata.get("storage_path")
            if not storage_path:
                raise HTTPException(422, "Este registro no tiene ningún archivo cargado")

            delete_document_version(supabase, storage_path)

            await conn.execute(
                """
                UPDATE public.compliance_records SET
                    status = 'MISSING',
                    file_url = NULL,
                    metadata = '{}'::jsonb,
                    updated_at = NOW()
                WHERE id = $1
                """,
                record_id,
            )
            await record_manual_edit(
                conn, table="compliance_records", where={"id": record_id}, actor=user["sub"],
                entity_type=current["entity_type"], entity_id=current["entity_id"],
                action="document_delete", field="status",
                old_value=current["status"], new_value="MISSING",
            )
    return await _fetch_record(record_id, pool, supabase)


@router.get("/{record_id}/files")
async def list_compliance_files(
    record_id: str, pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    current = await pool.fetchrow(
        "SELECT entity_id, entity_type, status, expiration_date, file_url, updated_at, overridden_by "
        "FROM public.compliance_records WHERE id = $1",
        record_id,
    )
    if not current:
        raise HTTPException(404, "Registro de cumplimiento no encontrado")
    return await get_document_history(
        pool, supabase, entity_type=current["entity_type"], entity_id=current["entity_id"],
        doc_name=f"compliance_record:{record_id}",
        current_storage_path=current["file_url"],
        current_status=current["status"],
        current_expiry_date=current["expiration_date"],
        current_updated_at=current["updated_at"],
        current_actor=current["overridden_by"],
    )


# ══════════════════════════════════════════════════════════════════════════
# Catálogo de requisitos
# ══════════════════════════════════════════════════════════════════════════
# Router aparte: el catálogo describe QUÉ se exige, no el estado de un
# compliance_record concreto, así que no cuelga de /compliance-records.

requirements_router = APIRouter(prefix="/compliance-requirements", tags=["compliance"])


@requirements_router.get("", response_model=list[RequirementOption])
async def list_compliance_requirements(
    target_entity: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """Tipos de documento del catálogo, opcionalmente acotados a un tipo de
    entidad. Solo lectura: administrar el catálogo requiere migración (ver
    HU-05 de la épica Red de Transporte)."""
    rows = await pool.fetch(
        """
        SELECT id::text, target_entity, requirement_code, name,
               requirement_level, COALESCE(has_expiration, false) AS has_expiration
        FROM public.compliance_requirements
        WHERE ($1::text IS NULL OR target_entity = $1)
        ORDER BY target_entity, name
        """,
        target_entity,
    )
    return [dict(r) for r in rows]
