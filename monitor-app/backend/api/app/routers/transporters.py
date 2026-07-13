"""Módulo Empresas EETT — backend RELACIONAL (TRANSPORTERS_BACKEND=relational,
default). Reescritura de app/routers/transporters_legacy.py (jsonb, sobre
app.transporter_profiles) contra el modelo relacional nuevo (migraciones
20260709100001..07). Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §3.

Contrato de respuesta preservado (TransporterListItem / TransporterProfile,
ver frontend/lib/types.ts:370-490) + campos nuevos de habilitación/seguros.
"""
import json
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..auth import get_current_user, get_supabase, require_admin, require_editor
from ..db import get_pool
from ..schemas.transporter_relational import (
    AddDriverBody,
    AddTrailerBody,
    AddVehicleBody,
    BajaBody,
    ContactPatchBody,
    DocumentPatchBody,
    PaginatedResponse,
    PatchDriverBody,
    PatchVehicleBody,
    TransferBody,
    TransporterPatchBody,
    split_rut,
)
router = APIRouter(prefix="/transporters", tags=["transporters"])

VALID_OVERRIDE_FIELDS = {"business_name", "rut", "account_stage", "contactability"}

# Claves de gobernanza == doc_code del catálogo (auditoría 2026-07-10: el
# rename de doc_code a vocabulario genérico "gc" eliminó la necesidad del
# mapa de indirección que existía cuando la clave de gobernanza no coincidía
# con el doc_code real — ver 20260709100003_compliance_documents.sql).
DRIVER_GOV_KEYS = [
    "anexo_3_gc", "epp", "das_odi", "hoja_de_vida", "cert_antecedentes",
    "validado_gc_driver", "contrato_trabajo", "creacion_gc_driver",
]
VEHICLE_GOV_KEYS = [
    "padron", "poliza_rc", "gps", "seguro_carga", "mantencion_camara_frio", "creacion_gc_vehicle",
]

# doc_type de app.alert_thresholds usado para cada fecha de vencimiento nativa
# (drivers/vehicles) — mismos doc_type sembrados en 20260529000002_config_tables.sql
_DRIVER_EXPIRY_DOC_TYPES = [("id_expiry", "id_expiry"), ("license_expiry", "license_expiry")]
_VEHICLE_EXPIRY_DOC_TYPES = [
    ("circ_permit_expiry", "circulacion"),
    ("tech_inspection_expiry", "revision_tecnica"),
    ("gas_emissions_expiry", "gases"),
    ("soap_insurance_expiry", "soap"),
]


# ── Helpers ───────────────────────────────────────────────────────

def _format_rut(rut: Optional[str], dv: Optional[str]) -> Optional[str]:
    if not rut:
        return None
    return f"{rut}-{dv}" if dv else rut


def _iso(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def _num(v):
    return float(v) if v is not None else None


_DOC_TABLE = {"transporter": "transporter_documents", "driver": "driver_documents", "vehicle": "vehicle_documents"}
_DOC_FK_COL = {"transporter": "transporter_id", "driver": "driver_id", "vehicle": "vehicle_id"}


async def _docs_by_entity(pool, entity_type: str, entity_ids: list) -> dict:
    if not entity_ids:
        return {}
    table = _DOC_TABLE[entity_type]
    fk = _DOC_FK_COL[entity_type]
    rows = await pool.fetch(
        f"SELECT {fk} AS entity_id, doc_name, status FROM app.{table} WHERE {fk} = ANY($1::uuid[])",
        entity_ids,
    )
    out: dict = {}
    for r in rows:
        out.setdefault(r["entity_id"], {})[r["doc_name"]] = r["status"]
    return out


async def _resolve_entity(pool, tid: str, entity_type: str, entity_id: str) -> None:
    """Valida que entity_id exista y, para driver/vehicle, esté asignado
    (transporter_id directo, Checkpoint A Task 2 — ya no assignment tables)
    a la empresa tid."""
    if entity_type == "transporter":
        exists = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", entity_id)
    elif entity_type == "driver":
        exists = await pool.fetchval(
            "SELECT id FROM app.drivers WHERE id = $1 AND transporter_id = $2", entity_id, tid,
        )
    else:  # vehicle
        exists = await pool.fetchval(
            "SELECT id FROM app.vehicles WHERE id = $1 AND transporter_id = $2", entity_id, tid,
        )
    if not exists:
        raise HTTPException(404, "No encontrado")


async def _upsert_document(pool, entity_type: str, entity_id, doc_code: str, data: dict, updated_by: str) -> dict:
    """Upsert en la tabla angosta de documentos correspondiente al tipo de
    entidad. `doc_code` se valida contra app.compliance_doc_catalog (se
    mantiene permanentemente tras Checkpoint A — es la fuente de metadata
    de documentos requeridos, no se retiró). manual_override=True por
    defecto: cualquier PATCH desde la app es edición manual."""
    catalog = await pool.fetchval(
        "SELECT doc_code FROM app.compliance_doc_catalog WHERE doc_code = $1 AND entity_type = $2",
        doc_code, entity_type,
    )
    if not catalog:
        raise HTTPException(422, f"doc_code inválido para {entity_type}: {doc_code}")

    table = _DOC_TABLE[entity_type]
    fk = _DOC_FK_COL[entity_type]
    manual_override = data.get("manual_override", True)
    row = await pool.fetchrow(
        f"""
        INSERT INTO app.{table}
          ({fk}, doc_name, status, expiry_date, file_url, storage_path, notes, manual_override, updated_by, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::uuid, NOW())
        ON CONFLICT ({fk}, doc_name) DO UPDATE SET
            status           = COALESCE($3, app.{table}.status),
            expiry_date      = COALESCE($4, app.{table}.expiry_date),
            file_url         = COALESCE($5, app.{table}.file_url),
            storage_path     = COALESCE($6, app.{table}.storage_path),
            notes            = COALESCE($7, app.{table}.notes),
            manual_override  = $8,
            updated_by       = $9::uuid,
            updated_at       = NOW()
        RETURNING *
        """,
        str(entity_id), doc_code, data.get("status"), data.get("expiry_date"),
        data.get("file_url"), data.get("storage_path"), data.get("notes"), manual_override, updated_by,
    )
    return dict(row)


def _serialize_document(row: dict, entity_type: str, entity_id) -> dict:
    return {
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "doc_code": row["doc_name"],
        "status": row["status"],
        "expiry_date": _iso(row["expiry_date"]),
        "file_url": row["file_url"],
        "storage_path": row["storage_path"],
        "notes": row["notes"],
        "manual_override": row["manual_override"],
        "updated_at": _iso(row["updated_at"]),
    }


async def _document_patch_impl(pool, entity_type, entity_id, doc_code, body: DocumentPatchBody, user):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(422, "Ningún campo enviado")
    row = await _upsert_document(pool, entity_type, entity_id, doc_code, data, user["sub"])
    return _serialize_document(row, entity_type, entity_id)


async def _document_upload_impl(pool, supabase, entity_type, entity_id, doc_code, key_prefix, file, user):
    from ..utils.document_storage import log_document_replacement, upload_document_version

    current = await pool.fetchrow(
        f"SELECT status, expiry_date, storage_path FROM app.{_DOC_TABLE[entity_type]} "
        f"WHERE {_DOC_FK_COL[entity_type]} = $1 AND doc_name = $2",
        str(entity_id), doc_code,
    )
    if current and current["storage_path"]:
        await log_document_replacement(
            pool, entity_type=entity_type, entity_id=entity_id, doc_name=doc_code,
            old_status=current["status"], old_expiry_date=current["expiry_date"],
            old_storage_path=current["storage_path"], actor=user["sub"],
        )

    stored = await upload_document_version(supabase, key_prefix=key_prefix, file=file)
    row = await _upsert_document(
        pool, entity_type, entity_id, doc_code, {"storage_path": stored["storage_path"]}, user["sub"],
    )
    return {**stored, **_serialize_document(row, entity_type, entity_id)}


async def _document_files_impl(pool, supabase, entity_type, entity_id, doc_code):
    from ..utils.document_storage import get_document_history
    return await get_document_history(pool, supabase, entity_type=entity_type, entity_id=entity_id, doc_name=doc_code)


# ── LIST ──────────────────────────────────────────────────────────

_LIST_FROM = """
    FROM app.transporters t
    LEFT JOIN (
        SELECT transporter_id, count(*) AS driver_count
        FROM app.drivers WHERE transporter_id IS NOT NULL
        GROUP BY transporter_id
    ) dc ON dc.transporter_id = t.id
    LEFT JOIN (
        SELECT transporter_id,
               count(*) FILTER (WHERE kind <> 'rampla') AS vehicle_count,
               count(*) FILTER (WHERE kind = 'rampla')  AS trailer_count,
               count(*) FILTER (WHERE kind = 'tracto')  AS tracto_count
        FROM app.vehicles WHERE transporter_id IS NOT NULL
        GROUP BY transporter_id
    ) vc ON vc.transporter_id = t.id
    LEFT JOIN app.v_transporter_eligibility el ON el.transporter_id = t.id
    LEFT JOIN app.v_transporter_operational_status os ON os.transporter_id = t.id
"""


@router.get("", response_model=PaginatedResponse)
async def list_transporters(
    q: str = Query("", description="Buscar por nombre o RUT"),
    stage: str = Query("", description="Filtrar por account_stage exacto"),
    active: Optional[bool] = Query(None),
    eligible: Optional[bool] = Query(None),
    alert: str = Query("", description="'docs' | 'insurance'"),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    params: list = []
    clauses: list[str] = []

    if q:
        params.append(q)
        n = len(params)
        clauses.append(f"(t.business_name ILIKE '%' || ${n} || '%' OR t.rut ILIKE '%' || ${n} || '%')")
    if stage:
        params.append(stage)
        clauses.append(f"t.account_stage = ${len(params)}")
    if active is not None:
        params.append(active)
        clauses.append(f"t.is_active = ${len(params)}")
    if eligible is not None:
        params.append(eligible)
        clauses.append(f"COALESCE(el.eligible, false) = ${len(params)}")
    if alert == "docs":
        clauses.append("'docs_below_threshold' = ANY(COALESCE(el.blocking_reasons, '{}'))")
    elif alert == "insurance":
        clauses.append("'insurance_overdue' = ANY(COALESCE(el.blocking_reasons, '{}'))")

    where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
    offset = (page - 1) * limit
    params_page = params + [limit, offset]
    lp, op = len(params) + 1, len(params) + 2

    rows = await pool.fetch(f"""
        SELECT
            t.id::text                                                    AS id,
            t.admin_internal_id::text                                     AS admin_id,
            t.business_name,
            CASE WHEN t.dv IS NOT NULL AND t.dv <> '' THEN t.rut || '-' || t.dv ELSE t.rut END AS rut,
            t.account_stage,
            COALESCE(dc.driver_count, 0)::int                             AS driver_count,
            COALESCE(vc.vehicle_count, 0)::int                            AS vehicle_count,
            COALESCE(vc.trailer_count, 0)::int                            AS trailer_count,
            COALESCE(vc.tracto_count, 0)::int                             AS tracto_count,
            (COALESCE(array_length(t.manually_edited_fields, 1), 0) > 0)  AS has_manual_edits,
            NOT COALESCE(el.eligible, true)                               AS has_active_alerts,
            t.in_admin,
            t.clients,
            t.avance_80_20,
            t.avance_total,
            el.compliance_pct,
            el.eligible,
            el.insurance_ok,
            (SELECT count(*)::int FROM app.insurance_policies ip
             WHERE ip.transporter_id = t.id)                              AS policies_count,
            COALESCE(el.blocking_reasons, '{{}}')                         AS blocking_reasons,
            os.operational_status, os.matched_by_upload
        {_LIST_FROM}
        {where}
        ORDER BY t.business_name ASC NULLS LAST
        LIMIT ${lp} OFFSET ${op}
    """, *params_page)

    count = await pool.fetchval(f"SELECT COUNT(*) {_LIST_FROM} {where}", *params)

    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}


# ── COMPLIANCE ALERTS ─────────────────────────────────────────────

@router.get("/compliance-alerts/summary")
async def compliance_alerts_summary(pool=Depends(get_pool), _=Depends(get_current_user)):
    threshold_rows = await pool.fetch(
        "SELECT doc_type, warning_days FROM app.alert_thresholds"
    )
    thresholds = {r["doc_type"]: r["warning_days"] for r in threshold_rows}

    def status_for(expiry, doc_type: str) -> Optional[str]:
        if expiry is None:
            return None
        today = date.today()
        if expiry < today:
            return "expired"
        warning_days = thresholds.get(doc_type, 30)
        if expiry <= today + timedelta(days=warning_days):
            return "expiring_soon"
        return None

    driver_ruts: dict[str, str] = {}
    plates: dict[str, str] = {}
    total_expired = 0
    total_expiring = 0

    def record(bucket: dict, key, status: str) -> None:
        nonlocal total_expired, total_expiring
        if not key or not status:
            return
        if status == "expired":
            total_expired += 1
        else:
            total_expiring += 1
        existing = bucket.get(key)
        if not existing or existing == "expiring_soon":
            bucket[key] = status

    driver_rows = await pool.fetch(
        "SELECT rut, dv, id_expiry, license_expiry FROM app.drivers "
        "WHERE id_expiry IS NOT NULL OR license_expiry IS NOT NULL"
    )
    for r in driver_rows:
        rut_fmt = _format_rut(r["rut"], r["dv"])
        for field, doc_type in _DRIVER_EXPIRY_DOC_TYPES:
            record(driver_ruts, rut_fmt, status_for(r[field], doc_type))

    vehicle_rows = await pool.fetch(
        "SELECT plate, circ_permit_expiry, tech_inspection_expiry, "
        "gas_emissions_expiry, soap_insurance_expiry FROM app.vehicles"
    )
    for r in vehicle_rows:
        for field, doc_type in _VEHICLE_EXPIRY_DOC_TYPES:
            record(plates, r["plate"], status_for(r[field], doc_type))

    ineligible_rows = await pool.fetch(
        "SELECT rut, blocking_reasons FROM app.v_transporter_eligibility "
        "WHERE NOT eligible AND is_active"
    )
    ineligible_transporters = {r["rut"]: list(r["blocking_reasons"] or []) for r in ineligible_rows}

    return {
        "driver_ruts": driver_ruts,
        "plates": plates,
        "total_expired": total_expired,
        "total_expiring_soon": total_expiring,
        "ineligible_transporters": ineligible_transporters,
    }


# ── DETAIL ────────────────────────────────────────────────────────

@router.get("/{tid}")
async def get_transporter(tid: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    t = await pool.fetchrow("SELECT * FROM app.transporters WHERE id = $1", tid)
    if not t:
        raise HTTPException(404, "No encontrado")

    contacts = await pool.fetch(
        "SELECT role, name, phone, email FROM app.transporter_contacts WHERE transporter_id = $1",
        tid,
    )

    driver_rows = await pool.fetch(
        """
        SELECT id, rut, dv, full_name, id_expiry, license_expiry, avance_total,
               baja_override, baja_reason
        FROM app.drivers
        WHERE transporter_id = $1
        ORDER BY full_name
        """,
        tid,
    )
    driver_ids = [r["id"] for r in driver_rows]

    vehicle_rows = await pool.fetch(
        """
        SELECT id, plate, kind, type_label, year,
               circ_permit_expiry, tech_inspection_expiry,
               gas_emissions_expiry, soap_insurance_expiry,
               baja_override, baja_reason
        FROM app.vehicles
        WHERE transporter_id = $1 AND kind <> 'rampla'
        ORDER BY plate
        """,
        tid,
    )
    vehicle_ids = [r["id"] for r in vehicle_rows]

    trailer_rows = await pool.fetch(
        """
        SELECT id, plate
        FROM app.vehicles
        WHERE transporter_id = $1 AND kind = 'rampla'
        ORDER BY plate
        """,
        tid,
    )

    driver_docs = await _docs_by_entity(pool, "driver", driver_ids)
    vehicle_docs = await _docs_by_entity(pool, "vehicle", vehicle_ids)

    company_doc_rows = await pool.fetch(
        """
        SELECT c.doc_code, c.label, cd.status, cd.expiry_date,
               cd.file_url, cd.storage_path, cd.manual_override, cd.updated_at
        FROM app.compliance_doc_catalog c
        LEFT JOIN app.transporter_documents cd
          ON cd.transporter_id = $1 AND cd.doc_name = c.doc_code
        WHERE c.entity_type = 'transporter'
        ORDER BY c.sort_order
        """,
        tid,
    )

    eligibility = await pool.fetchrow(
        "SELECT eligible, compliance_pct, insurance_ok, blocking_reasons "
        "FROM app.v_transporter_eligibility WHERE transporter_id = $1",
        tid,
    )

    operational = await pool.fetchrow(
        "SELECT operational_status, matched_by_upload "
        "FROM app.v_transporter_operational_status WHERE transporter_id = $1",
        tid,
    )

    drivers = []
    for r in driver_rows:
        docs = driver_docs.get(r["id"], {})
        gov = {
            "id_expiry": _iso(r["id_expiry"]),
            "license_expiry": _iso(r["license_expiry"]),
            "avance_total": _num(r["avance_total"]),
        }
        for key in DRIVER_GOV_KEYS:
            gov[key] = docs.get(key)
        drivers.append({
            "id": str(r["id"]), "rut": _format_rut(r["rut"], r["dv"]), "name": r["full_name"],
            "governance": gov,
            "baja_override": r["baja_override"], "baja_reason": r["baja_reason"],
        })

    vehicles = []
    for r in vehicle_rows:
        docs = vehicle_docs.get(r["id"], {})
        gov = {
            "year": r["year"],
            "circ_permit_expiry": _iso(r["circ_permit_expiry"]),
            "tech_inspection_expiry": _iso(r["tech_inspection_expiry"]),
            "gas_emissions_expiry": _iso(r["gas_emissions_expiry"]),
            "soap_insurance_expiry": _iso(r["soap_insurance_expiry"]),
        }
        for key in VEHICLE_GOV_KEYS:
            gov[key] = docs.get(key)
        vehicles.append({
            "id": str(r["id"]), "type": r["type_label"] or r["kind"], "plate": r["plate"],
            "governance": gov,
            "baja_override": r["baja_override"], "baja_reason": r["baja_reason"],
        })

    trailers = [{"id": str(r["id"]), "plate": r["plate"]} for r in trailer_rows]

    documents = [
        {
            "doc_code": r["doc_code"], "label": r["label"], "status": r["status"],
            "expiry_date": _iso(r["expiry_date"]),
            "file_url": r["file_url"],
            "storage_path": r["storage_path"],
            "manual_override": r["manual_override"],
            "updated_at": _iso(r["updated_at"]),
        }
        for r in company_doc_rows
    ]

    contactability = t["contactability"]
    if isinstance(contactability, str):
        contactability = json.loads(contactability)

    return {
        "id": str(t["id"]),
        "admin_id": str(t["admin_internal_id"]) if t["admin_internal_id"] is not None else None,
        "business_name": t["business_name"],
        "rut": _format_rut(t["rut"], t["dv"]),
        "account_stage": t["account_stage"],
        "contactability": contactability,
        "contacts": [dict(c) for c in contacts],
        "drivers": drivers,
        "vehicles": vehicles,
        "trailers": trailers,
        "manually_edited_fields": list(t["manually_edited_fields"] or []),
        "edited_at": _iso(t["edited_at"]),
        "updated_at": _iso(t["updated_at"]),
        "in_admin": t["in_admin"],
        "clients": list(t["clients"] or []),
        "eligibility": {
            "eligible": eligibility["eligible"] if eligibility else False,
            "compliance_pct": _num(eligibility["compliance_pct"]) if eligibility else None,
            "insurance_ok": eligibility["insurance_ok"] if eligibility else True,
            "blocking_reasons": list(eligibility["blocking_reasons"] or []) if eligibility else [],
        },
        "operational_status": operational["operational_status"] if operational else "no_operativa",
        "matched_by_upload": operational["matched_by_upload"] if operational else False,
        "admin_account_id": str(t["admin_account_id"]) if t["admin_account_id"] is not None else None,
        "documents": documents,
        "baja_override": t["baja_override"], "baja_reason": t["baja_reason"],
    }


# ── PATCH ─────────────────────────────────────────────────────────

@router.patch("/{tid}")
async def patch_transporter(
    tid: str,
    body: TransporterPatchBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    current = await pool.fetchrow(
        "SELECT updated_at FROM app.transporters WHERE id = $1", tid
    )
    if not current:
        raise HTTPException(404, "No encontrado")

    if body.expected_updated_at is not None and current["updated_at"] != body.expected_updated_at:
        raise HTTPException(409, "El registro fue modificado por otro usuario; recargue e intente de nuevo")

    touched = body.sent_top_level_fields()
    if not touched:
        raise HTTPException(422, "Ningún campo enviado")

    if touched:
        new_rut = new_dv = None
        if body.rut is not None:
            new_rut, new_dv = split_rut(body.rut)

        await pool.execute(
            """
            UPDATE app.transporters SET
                business_name  = COALESCE($2, business_name),
                rut            = COALESCE($3, rut),
                dv             = CASE WHEN $3::text IS NOT NULL THEN $4 ELSE dv END,
                account_stage  = COALESCE($5, account_stage),
                contactability = COALESCE($6::jsonb, contactability),
                manually_edited_fields = (
                    SELECT ARRAY(SELECT DISTINCT unnest(
                        COALESCE(manually_edited_fields, '{}') || $7::text[]
                    ))
                ),
                edited_by  = $8::uuid,
                edited_at  = NOW(),
                updated_at = NOW()
            WHERE id = $1
            """,
            tid, body.business_name, new_rut, new_dv, body.account_stage,
            json.dumps(body.contactability.model_dump()) if body.contactability is not None else None,
            touched, user["sub"],
        )

    return await get_transporter(tid, pool, user)


# ── RESET FIELD (devolver campo al pipeline) ──────────────────────

@router.delete("/{tid}/overrides/{field}")
async def reset_field(
    tid: str,
    field: str,
    pool=Depends(get_pool),
    _=Depends(require_editor),
):
    if field not in VALID_OVERRIDE_FIELDS:
        raise HTTPException(422, f"Campo inválido: {field}")

    result = await pool.execute(
        """
        UPDATE app.transporters
        SET manually_edited_fields = array_remove(manually_edited_fields, $2),
            updated_at = NOW()
        WHERE id = $1
        """,
        tid, field,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    return {"ok": True, "field": field}


# ── DOCUMENTOS — transporter / driver / vehicle ────────────────────

@router.patch("/{tid}/documents/{doc_code}")
async def patch_transporter_document(
    tid: str, doc_code: str, body: DocumentPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "transporter", tid)
    return await _document_patch_impl(pool, "transporter", tid, doc_code, body, user)


@router.post("/{tid}/documents/{doc_code}/file")
async def upload_transporter_document_file(
    tid: str, doc_code: str, file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "transporter", tid)
    return await _document_upload_impl(
        pool, supabase, "transporter", tid, doc_code, f"transporter/{tid}/{doc_code}", file, user
    )


@router.get("/{tid}/documents/{doc_code}/files")
async def list_transporter_document_files(
    tid: str, doc_code: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    await _resolve_entity(pool, tid, "transporter", tid)
    return await _document_files_impl(pool, supabase, "transporter", tid, doc_code)


@router.patch("/{tid}/drivers/{did}/documents/{doc_code}")
async def patch_driver_document(
    tid: str, did: str, doc_code: str, body: DocumentPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "driver", did)
    return await _document_patch_impl(pool, "driver", did, doc_code, body, user)


@router.post("/{tid}/drivers/{did}/documents/{doc_code}/file")
async def upload_driver_document_file(
    tid: str, did: str, doc_code: str, file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "driver", did)
    return await _document_upload_impl(
        pool, supabase, "driver", did, doc_code, f"driver/{did}/{doc_code}", file, user
    )


@router.get("/{tid}/drivers/{did}/documents/{doc_code}/files")
async def list_driver_document_files(
    tid: str, did: str, doc_code: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    await _resolve_entity(pool, tid, "driver", did)
    return await _document_files_impl(pool, supabase, "driver", did, doc_code)


@router.patch("/{tid}/vehicles/{vid}/documents/{doc_code}")
async def patch_vehicle_document(
    tid: str, vid: str, doc_code: str, body: DocumentPatchBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "vehicle", vid)
    return await _document_patch_impl(pool, "vehicle", vid, doc_code, body, user)


@router.post("/{tid}/vehicles/{vid}/documents/{doc_code}/file")
async def upload_vehicle_document_file(
    tid: str, vid: str, doc_code: str, file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    await _resolve_entity(pool, tid, "vehicle", vid)
    return await _document_upload_impl(
        pool, supabase, "vehicle", vid, doc_code, f"vehicle/{vid}/{doc_code}", file, user
    )


@router.get("/{tid}/vehicles/{vid}/documents/{doc_code}/files")
async def list_vehicle_document_files(
    tid: str, vid: str, doc_code: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    await _resolve_entity(pool, tid, "vehicle", vid)
    return await _document_files_impl(pool, supabase, "vehicle", vid, doc_code)


# ── DRIVERS ───────────────────────────────────────────────────────

@router.post("/{tid}/drivers")
async def add_driver(
    tid: str, body: AddDriverBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", tid)
    if not exists:
        raise HTTPException(404, "No encontrado")

    rut_body, dv = split_rut(body.rut)
    driver = await pool.fetchrow("SELECT id FROM app.drivers WHERE rut = $1", rut_body)

    if driver:
        driver_id = driver["id"]
        active = await pool.fetchrow(
            "SELECT transporter_id FROM app.drivers WHERE id = $1", driver_id,
        )
        current_transporter_id = active["transporter_id"] if active else None
        if current_transporter_id and str(current_transporter_id) == tid:
            raise HTTPException(409, f"El conductor {body.rut} ya está asignado a esta empresa")
        if current_transporter_id:
            raise HTTPException(
                409,
                f"El conductor {body.rut} ya está asignado a otra empresa "
                f"({current_transporter_id}). Use POST "
                f"/transporters/{current_transporter_id}/drivers/{driver_id}/transfer para transferirlo.",
            )
        await pool.execute(
            "UPDATE app.drivers SET full_name = $2, transporter_id = $3, updated_at = NOW() WHERE id = $1",
            driver_id, body.name, tid,
        )
    else:
        driver_id = await pool.fetchval(
            """
            INSERT INTO app.drivers (rut, dv, rut_dv_valid, full_name, source, transporter_id)
            VALUES ($1, $2, (app.rut_dv($1) = upper($2)), $3, 'manual', $4)
            RETURNING id
            """,
            rut_body, dv, body.name, tid,
        )

    return {"data": {"id": str(driver_id), "rut": _format_rut(rut_body, dv), "name": body.name}}


@router.patch("/{tid}/drivers/{did}")
async def patch_driver(
    tid: str, did: str, body: PatchDriverBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    if body.rut is None and body.name is None and body.governance is None:
        raise HTTPException(422, "Ningún campo enviado")

    await _resolve_entity(pool, tid, "driver", did)

    touched: list[str] = []
    sets: list[str] = []
    vals: list = [did]

    if body.rut is not None:
        rut_body, dv = split_rut(body.rut)
        vals += [rut_body, dv]
        sets.append(f"rut = ${len(vals) - 1}, dv = ${len(vals)}")
        touched.append("rut")
    if body.name is not None:
        vals.append(body.name)
        sets.append(f"full_name = ${len(vals)}")
        touched.append("full_name")

    doc_updates: dict[str, str] = {}
    if body.governance is not None:
        gov = body.governance.model_dump(exclude_none=True)
        if "id_expiry" in gov:
            vals.append(gov.pop("id_expiry"))
            sets.append(f"id_expiry = ${len(vals)}")
            touched.append("id_expiry")
        if "license_expiry" in gov:
            vals.append(gov.pop("license_expiry"))
            sets.append(f"license_expiry = ${len(vals)}")
            touched.append("license_expiry")
        doc_updates = gov

    if sets:
        vals.append(touched)
        sets.append(
            f"manually_edited_fields = (SELECT ARRAY(SELECT DISTINCT unnest("
            f"COALESCE(manually_edited_fields, '{{}}') || ${len(vals)}::text[])))"
        )
        sets.append("updated_at = NOW()")
        await pool.execute(f"UPDATE app.drivers SET {', '.join(sets)} WHERE id = $1", *vals)

    for doc_code, status in doc_updates.items():
        await _upsert_document(pool, "driver", did, doc_code, {"status": status}, user["sub"])

    row = await pool.fetchrow("SELECT id, rut, dv, full_name FROM app.drivers WHERE id = $1", did)
    return {"data": {"id": str(row["id"]), "rut": _format_rut(row["rut"], row["dv"]), "name": row["full_name"]}}


@router.delete("/{tid}/drivers/{did}")
async def remove_driver(
    tid: str, did: str,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    result = await pool.execute(
        "UPDATE app.drivers SET transporter_id = NULL WHERE id = $1 AND transporter_id = $2",
        did, tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    return {"ok": True}


@router.post("/{tid}/drivers/{did}/transfer")
async def transfer_driver(
    tid: str, did: str, body: TransferBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    if body.to_transporter_id == tid:
        raise HTTPException(422, "La empresa destino debe ser distinta de la actual")

    dest = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", body.to_transporter_id)
    if not dest:
        raise HTTPException(404, "Empresa destino no encontrada")

    result = await pool.execute(
        "UPDATE app.drivers SET transporter_id = $1 WHERE id = $2 AND transporter_id = $3",
        body.to_transporter_id, did, tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "El conductor no está asignado actualmente a esta empresa")

    await pool.execute(
        """
        INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        VALUES ($1::uuid, 'driver', $2::uuid, 'transfer', 'transporter_id', $3::jsonb, $4::jsonb, 'api')
        """,
        user["sub"], did, json.dumps({"transporter_id": tid}), json.dumps({"transporter_id": body.to_transporter_id}),
    )
    return {"ok": True, "driver_id": did, "from_transporter_id": tid, "to_transporter_id": body.to_transporter_id}


# ── VEHICLES ──────────────────────────────────────────────────────

@router.post("/{tid}/vehicles")
async def add_vehicle(
    tid: str, body: AddVehicleBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    if body.kind == "rampla":
        raise HTTPException(422, "Use POST /{tid}/trailers para agregar ramplas")

    exists = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", tid)
    if not exists:
        raise HTTPException(404, "No encontrado")

    plate = body.plate.strip().upper()
    vehicle = await pool.fetchrow("SELECT id FROM app.vehicles WHERE plate = $1", plate)

    if vehicle:
        vehicle_id = vehicle["id"]
        active = await pool.fetchrow(
            "SELECT transporter_id FROM app.vehicles WHERE id = $1", vehicle_id,
        )
        current_transporter_id = active["transporter_id"] if active else None
        if current_transporter_id and str(current_transporter_id) == tid:
            raise HTTPException(409, f"El vehículo {plate} ya está asignado a esta empresa")
        if current_transporter_id:
            raise HTTPException(
                409,
                f"El vehículo {plate} ya está asignado a otra empresa ({current_transporter_id}). "
                f"Use POST /transporters/{current_transporter_id}/vehicles/{vehicle_id}/transfer para transferirlo.",
            )
        await pool.execute(
            "UPDATE app.vehicles SET kind = $2, type_label = COALESCE($3, type_label), "
            "transporter_id = $4, updated_at = NOW() WHERE id = $1",
            vehicle_id, body.kind, body.type_label, tid,
        )
    else:
        vehicle_id = await pool.fetchval(
            "INSERT INTO app.vehicles (plate, kind, type_label, source, transporter_id) "
            "VALUES ($1, $2, $3, 'manual', $4) RETURNING id",
            plate, body.kind, body.type_label, tid,
        )

    return {"data": {"id": str(vehicle_id), "type": body.type_label or body.kind, "plate": plate}}


@router.patch("/{tid}/vehicles/{vid}")
async def patch_vehicle(
    tid: str, vid: str, body: PatchVehicleBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    if body.plate is None and body.type_label is None and body.governance is None:
        raise HTTPException(422, "Ningún campo enviado")

    await _resolve_entity(pool, tid, "vehicle", vid)

    touched: list[str] = []
    sets: list[str] = []
    vals: list = [vid]

    if body.plate is not None:
        vals.append(body.plate.strip().upper())
        sets.append(f"plate = ${len(vals)}")
        touched.append("plate")
    if body.type_label is not None:
        vals.append(body.type_label)
        sets.append(f"type_label = ${len(vals)}")
        touched.append("type_label")

    doc_updates: dict[str, str] = {}
    if body.governance is not None:
        gov = body.governance.model_dump(exclude_none=True)
        for field in ("circ_permit_expiry", "tech_inspection_expiry", "gas_emissions_expiry", "soap_insurance_expiry"):
            if field in gov:
                vals.append(gov.pop(field))
                sets.append(f"{field} = ${len(vals)}")
                touched.append(field)
        if "year" in gov:
            vals.append(gov.pop("year"))
            sets.append(f"year = ${len(vals)}")
            touched.append("year")
        doc_updates = gov

    if sets:
        vals.append(touched)
        sets.append(
            f"manually_edited_fields = (SELECT ARRAY(SELECT DISTINCT unnest("
            f"COALESCE(manually_edited_fields, '{{}}') || ${len(vals)}::text[])))"
        )
        sets.append("updated_at = NOW()")
        await pool.execute(f"UPDATE app.vehicles SET {', '.join(sets)} WHERE id = $1", *vals)

    for doc_code, status in doc_updates.items():
        await _upsert_document(pool, "vehicle", vid, doc_code, {"status": status}, user["sub"])

    row = await pool.fetchrow("SELECT id, plate, kind, type_label FROM app.vehicles WHERE id = $1", vid)
    return {"data": {"id": str(row["id"]), "type": row["type_label"] or row["kind"], "plate": row["plate"]}}


@router.delete("/{tid}/vehicles/{vid}")
async def remove_vehicle(
    tid: str, vid: str,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    result = await pool.execute(
        "UPDATE app.vehicles SET transporter_id = NULL WHERE id = $1 AND transporter_id = $2",
        vid, tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    return {"ok": True}


@router.post("/{tid}/vehicles/{vid}/transfer")
async def transfer_vehicle(
    tid: str, vid: str, body: TransferBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    if body.to_transporter_id == tid:
        raise HTTPException(422, "La empresa destino debe ser distinta de la actual")

    dest = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", body.to_transporter_id)
    if not dest:
        raise HTTPException(404, "Empresa destino no encontrada")

    result = await pool.execute(
        "UPDATE app.vehicles SET transporter_id = $1 WHERE id = $2 AND transporter_id = $3",
        body.to_transporter_id, vid, tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "El vehículo no está asignado actualmente a esta empresa")

    await pool.execute(
        """
        INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        VALUES ($1::uuid, 'vehicle', $2::uuid, 'transfer', 'transporter_id', $3::jsonb, $4::jsonb, 'api')
        """,
        user["sub"], vid, json.dumps({"transporter_id": tid}), json.dumps({"transporter_id": body.to_transporter_id}),
    )
    return {"ok": True, "vehicle_id": vid, "from_transporter_id": tid, "to_transporter_id": body.to_transporter_id}


# ── TRAILERS (app.vehicles con kind='rampla') ──────────────────────

@router.post("/{tid}/trailers")
async def add_trailer(
    tid: str, body: AddTrailerBody,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", tid)
    if not exists:
        raise HTTPException(404, "No encontrado")

    plate = body.plate.strip().upper()
    vehicle = await pool.fetchrow("SELECT id FROM app.vehicles WHERE plate = $1", plate)

    if vehicle:
        vehicle_id = vehicle["id"]
        active = await pool.fetchrow(
            "SELECT transporter_id FROM app.vehicles WHERE id = $1", vehicle_id,
        )
        current_transporter_id = active["transporter_id"] if active else None
        if current_transporter_id and str(current_transporter_id) == tid:
            raise HTTPException(409, f"La rampla {plate} ya está asignada a esta empresa")
        if current_transporter_id:
            raise HTTPException(409, f"La rampla {plate} ya está asignada a otra empresa ({current_transporter_id})")
        await pool.execute(
            "UPDATE app.vehicles SET transporter_id = $2, updated_at = NOW() WHERE id = $1",
            vehicle_id, tid,
        )
    else:
        vehicle_id = await pool.fetchval(
            "INSERT INTO app.vehicles (plate, kind, type_label, source, transporter_id) "
            "VALUES ($1, 'rampla', $2, 'manual', $3) RETURNING id",
            plate, body.type_label, tid,
        )

    return {"data": {"id": str(vehicle_id), "plate": plate}}


@router.delete("/{tid}/trailers/{trid}")
async def remove_trailer(
    tid: str, trid: str,
    pool=Depends(get_pool), user=Depends(require_editor),
):
    result = await pool.execute(
        "UPDATE app.vehicles SET transporter_id = NULL WHERE id = $1 AND transporter_id = $2",
        trid, tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    return {"ok": True}


# ── CONTACTS (app.transporter_contacts) ────────────────────────────

@router.get("/{tid}/contacts")
async def list_contacts(tid: str, pool=Depends(get_pool), _=Depends(get_current_user)):
    rows = await pool.fetch(
        "SELECT role, name, phone, email FROM app.transporter_contacts WHERE transporter_id = $1 ORDER BY role",
        tid,
    )
    return {"data": [dict(r) for r in rows]}


@router.post("/{tid}/contacts")
async def upsert_contact(
    tid: str, body: ContactPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    exists = await pool.fetchval("SELECT id FROM app.transporters WHERE id = $1", tid)
    if not exists:
        raise HTTPException(404, "Empresa no encontrada")
    row = await pool.fetchrow(
        """
        INSERT INTO app.transporter_contacts (transporter_id, role, name, phone, email)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (transporter_id, role) DO UPDATE SET
            name = COALESCE($3, app.transporter_contacts.name),
            phone = COALESCE($4, app.transporter_contacts.phone),
            email = COALESCE($5, app.transporter_contacts.email)
        RETURNING role, name, phone, email
        """,
        tid, body.role, body.name, body.phone, body.email,
    )
    await pool.execute(
        "INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, source) "
        "VALUES ($1::uuid, 'transporter_contact', $2::uuid, 'upsert', $3, 'api')",
        user["sub"], tid, body.role,
    )
    return {"data": dict(row)}


@router.patch("/{tid}/contacts/{role}")
async def patch_contact(
    tid: str, role: str, body: ContactPatchBody, pool=Depends(get_pool), user=Depends(require_editor),
):
    if body.role != role:
        raise HTTPException(422, "El rol del body debe coincidir con el de la URL")
    return await upsert_contact(tid, body, pool, user)


@router.delete("/{tid}/contacts/{role}")
async def delete_contact(
    tid: str, role: str, pool=Depends(get_pool), user=Depends(require_editor),
):
    result = await pool.execute(
        "DELETE FROM app.transporter_contacts WHERE transporter_id = $1 AND role = $2", tid, role,
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Contacto no encontrado")
    await pool.execute(
        "INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, source) "
        "VALUES ($1::uuid, 'transporter_contact', $2::uuid, 'delete', $3, 'api')",
        user["sub"], tid, role,
    )
    return {"ok": True}


# ── ALTA/BAJA MANUAL (baja_override) ───────────────────────────────
# Desactivación/reactivación manual de transporter/driver/vehicle vía
# columnas baja_override/baja_reason/baja_notes/baja_by/baja_at (Checkpoint
# A Task 1). app.v_transporter_operational_status debe reflejar
# baja_override=true como 'no_operativa' independiente del status previo.

async def _set_baja(pool, table: str, entity_id: str, override: bool, body: Optional[BajaBody], user) -> dict:
    if override:
        row = await pool.fetchrow(
            f"""
            UPDATE app.{table} SET
                baja_override = true, baja_reason = $2, baja_notes = $3,
                baja_by = $4::uuid, baja_at = NOW(), updated_at = NOW()
            WHERE id = $1 RETURNING id
            """,
            entity_id, body.reason, body.notes, user["sub"],
        )
    else:
        row = await pool.fetchrow(
            f"""
            UPDATE app.{table} SET
                baja_override = false, baja_reason = NULL, baja_notes = NULL,
                baja_by = NULL, baja_at = NULL, updated_at = NOW()
            WHERE id = $1 RETURNING id
            """,
            entity_id,
        )
    if not row:
        raise HTTPException(404, "No encontrado")
    action = "deactivate" if override else "reactivate"
    await pool.execute(
        "INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, source) "
        "VALUES ($1::uuid, $2, $3::uuid, $4, 'baja_override', 'api')",
        user["sub"], table.rstrip("s") if table != "vehicles" else "vehicle", entity_id, action,
    )
    return {"ok": True, "id": entity_id, "action": action}


@router.post("/{tid}/deactivate")
async def deactivate_transporter(tid: str, body: BajaBody, pool=Depends(get_pool), user=Depends(require_admin)):
    return await _set_baja(pool, "transporters", tid, True, body, user)


@router.post("/{tid}/reactivate")
async def reactivate_transporter(tid: str, pool=Depends(get_pool), user=Depends(require_admin)):
    return await _set_baja(pool, "transporters", tid, False, None, user)


@router.post("/{tid}/drivers/{did}/deactivate")
async def deactivate_driver(tid: str, did: str, body: BajaBody, pool=Depends(get_pool), user=Depends(require_admin)):
    await _resolve_entity(pool, tid, "driver", did)
    return await _set_baja(pool, "drivers", did, True, body, user)


@router.post("/{tid}/drivers/{did}/reactivate")
async def reactivate_driver(tid: str, did: str, pool=Depends(get_pool), user=Depends(require_admin)):
    await _resolve_entity(pool, tid, "driver", did)
    return await _set_baja(pool, "drivers", did, False, None, user)


@router.post("/{tid}/vehicles/{vid}/deactivate")
async def deactivate_vehicle(tid: str, vid: str, body: BajaBody, pool=Depends(get_pool), user=Depends(require_admin)):
    await _resolve_entity(pool, tid, "vehicle", vid)
    return await _set_baja(pool, "vehicles", vid, True, body, user)


@router.post("/{tid}/vehicles/{vid}/reactivate")
async def reactivate_vehicle(tid: str, vid: str, pool=Depends(get_pool), user=Depends(require_admin)):
    await _resolve_entity(pool, tid, "vehicle", vid)
    return await _set_baja(pool, "vehicles", vid, False, None, user)


# ── DELETE (admin) — desactivación lógica, preserva historial relacional ──
# Nota de diseño: el legacy hacía DELETE físico sobre la fila jsonb; acá
# desactivar (is_active=false) es lo correcto porque hay FKs (assignments,
# insurance_policies, audit_log) que dependen de la empresa — un hard delete
# rompería el historial que el módulo de Seguros y la auditoría necesitan.

@router.delete("/{tid}")
async def delete_transporter(
    tid: str,
    pool=Depends(get_pool),
    _=Depends(require_admin),
):
    result = await pool.execute(
        "UPDATE app.transporters SET is_active = false, updated_at = NOW() WHERE id = $1",
        tid,
    )
    if result == "UPDATE 0":
        raise HTTPException(404, "No encontrado")
    return {"ok": True}
