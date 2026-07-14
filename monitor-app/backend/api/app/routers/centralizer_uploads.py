"""Router del upload EETT (Task 3, plan `.superpowers/sdd/task-3-brief.md`):
orquesta el flujo completo `POST` (subida+preview) -> `approve`/`reject` ->
`apply`. Reemplaza el pipeline Mage/dbt congelado que alimentaba
`silver.stg_centralizer_*` (ver AGENTLOG.md).

Consume `parse_centralizer_workbook` (Task 1) y `compute_diff` (Task 2), y
reusa el patrón de subida a Storage (`document_storage.upload_document_version`)
y el patrón de upsert de documentos (`_upsert_document` de
`routers/transporters.py`) ya existentes — no se reimplementa ninguno de los
dos desde cero.

Contrato de consumo de `field_diffs` heredado de Task 2 (no escrito en
ningún otro lado): cada entrada trae `field` con prefijo `"documents."` para
diffs de documentos (ej. `"documents.rol_sii"`) vs. nombre de columna nativo
sin prefijo (ej. `"business_name"`) — `_apply_field_diffs` hace el split.
Cada entrada trae además `"conflict": bool`; sólo se aplican las que tienen
`conflict is False`. Toda la entidad se salta si `change_type == 'conflict'`.

Decisión de diseño — "matched" para `last_matched_upload_id`/`last_matched_at`:
se marca todo transporter que aparece en la hoja Empresas del upload y
resuelve a un id (nuevo o existente), sin importar su `change_type`
(incluye 'unchanged' y 'conflict') — la semántica es "este transporter fue
visto en el último upload del centralizador", no "se le escribieron campos
nuevos". Sólo se excluyen huérfanos (que ya no generan `EntityDiff`, quedan
en `parse_errors` desde Task 2).

Decisión de diseño — `apply` no confía en el diff del preview: vuelve a
descargar el archivo desde Storage, re-parsea y recalcula el diff con la
misma conexión (`conn`) que abre la transacción — evita aplicar sobre datos
que cambiaron entre el preview y el apply. `pg_advisory_xact_lock` con una
clave fija (`zlib.crc32(b"centralizer_upload")`) serializa applies
concurrentes del mismo (o de cualquier) upload; el chequeo de
`status == 'approved'` se repite DENTRO de la transacción (además del
chequeo inicial fuera de ella) para que dos requests de apply concurrentes
que pasen ambos el chequeo inicial no terminen aplicando dos veces — el
segundo se bloquea en el advisory lock hasta que el primero commitea
(`status` pasa a `'applied'`) y entonces falla su propio re-chequeo.
"""
from __future__ import annotations

import json
import re
import zlib
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile

from ..auth import get_current_user, get_supabase, require_admin, require_editor
from ..db import get_pool
from ..schemas.centralizer_upload import ColumnMappingResolutionBody, UploadRejectBody
from ..services.centralizer_diff import DiffResult, EntityDiff, compute_diff
from ..services.centralizer_parser import find_unresolved_columns, parse_centralizer_workbook
from ..utils.document_storage import COMPLIANCE_BUCKET, upload_document_version
from .transporters import _upsert_document

router = APIRouter(prefix="/centralizer-uploads", tags=["centralizer-uploads"])

# Clave fija para pg_advisory_xact_lock — un solo namespace de lock para todo
# el flujo de apply de centralizer uploads (serializa applies concurrentes,
# no hace falta una clave distinta por upload: el chequeo de status dentro
# de la transacción ya distingue cuál upload es cuál).
ADVISORY_LOCK_KEY = zlib.crc32(b"centralizer_upload")

_ENTITY_TABLE = {"transporter": "transporters", "driver": "drivers", "vehicle": "vehicles"}
_SHEET_ENTITY_TYPE = {"Empresas": "transporter", "Conductores": "driver", "Vehiculos_Equipos": "vehicle"}
_DOC_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")


async def _load_extra_mappings(pool) -> dict[str, dict[str, tuple[str, Any]]]:
    """Carga las resoluciones guardadas en app.centralizer_column_mappings y
    las convierte al mismo shape que los dicts *_COLUMNS del parser
    ('doc'/'ignore') — para que parse_centralizer_workbook/find_unresolved_columns
    las combinen sin lógica especial."""
    rows = await pool.fetch("SELECT sheet_name, excel_header, doc_code FROM app.centralizer_column_mappings")
    result: dict[str, dict[str, tuple[str, Any]]] = {}
    for r in rows:
        sheet_map = result.setdefault(r["sheet_name"], {})
        sheet_map[r["excel_header"]] = ("ignore", None) if r["doc_code"] is None else ("doc", r["doc_code"])
    return result


def _download_and_parse(supabase, storage_path: str, extra_mappings: dict | None = None):
    """Descarga el archivo desde Storage y lo parsea — reusado por `apply`
    (que nunca confía en el diff del preview), por `GET /{upload_id}` (que
    nunca persiste el diff, lo recalcula en cada lectura), y por
    `resolve_column_mappings`."""
    try:
        raw = supabase.storage.from_(COMPLIANCE_BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(502, f"Error descargando el archivo desde Storage: {e}")
    try:
        return parse_centralizer_workbook(raw, extra_mappings)
    except ValueError as e:
        raise HTTPException(422, f"Error re-parseando el archivo: {e}")


# ── Helpers de apply ─────────────────────────────────────────────────────

def _iso(v):
    if v is None:
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


async def _apply_field_diffs(conn, entity_type: str, entity_id, field_diffs: list[dict], user: dict) -> None:
    """Aplica sólo los `field_diffs` sin conflicto: nativos van a un UPDATE
    directo de la tabla de la entidad, documentos van a `_upsert_document`
    (reusa exactamente esa función de routers/transporters.py).
    `manual_override=False` explícito: esto viene del Excel fuente, no de
    una edición manual vía UI — si no se pasa, `_upsert_document` defaultea
    a True, lo que marcaría erróneamente el documento como editado a mano y
    lo blindaría contra futuros uploads automáticos."""
    table = _ENTITY_TABLE[entity_type]
    native_sets: list[str] = []
    native_vals: list = [entity_id]

    for fd in field_diffs:
        if fd["conflict"]:
            continue
        field = fd["field"]
        if field.startswith("documents."):
            doc_code = field[len("documents."):]
            await _upsert_document(
                conn, entity_type, entity_id, doc_code,
                {"status": fd["new"], "manual_override": False}, user["sub"],
            )
        else:
            native_vals.append(fd["new"])
            native_sets.append(f"{field} = ${len(native_vals)}")

    if native_sets:
        await conn.execute(
            f"UPDATE app.{table} SET {', '.join(native_sets)}, updated_at = NOW() WHERE id = $1",
            *native_vals,
        )


async def _apply_transporter(conn, ed: EntityDiff, user: dict) -> Optional[str]:
    """Retorna el id (str) del transporter resultante — se usa tanto para
    marcar `last_matched_upload_id` como para resolver el FK de
    drivers/vehicles de la misma hoja Empresas. `None` sólo puede pasar si
    ni existe ni se creó, lo cual no debería ocurrir dado el contrato de
    `compute_diff` (todo transporter row produce 'new' o matchea algo)."""
    parsed_row = ed["parsed_row"]

    if ed["change_type"] == "new":
        transporter_id = await conn.fetchval(
            "INSERT INTO app.transporters (rut, dv, rut_dv_valid, business_name, source) "
            "VALUES ($1, $2, $3, $4, 'centralizer_upload') RETURNING id",
            ed["entity_key"], parsed_row.get("dv"), parsed_row.get("rut_dv_valid", False),
            parsed_row.get("business_name"),
        )
        await _apply_field_diffs(conn, "transporter", transporter_id, ed["field_diffs"], user)
        return str(transporter_id)

    if ed["existing_id"] is None:
        return None

    if ed["change_type"] == "updated":
        await _apply_field_diffs(conn, "transporter", ed["existing_id"], ed["field_diffs"], user)
    # 'unchanged' y 'conflict': no se tocan campos, pero sigue "matcheado".
    return ed["existing_id"]


async def _apply_driver_or_vehicle(
    conn, ed: EntityDiff, entity_type: str, user: dict, rut_to_transporter_id: dict[str, str],
) -> None:
    """`change_type == 'conflict'` se salta por completo (brief: ni
    reasignación de transporter_id ni campos). Para drivers/vehicles
    existentes cuyo transporter_rut en el Excel apunta a un transporter_id
    distinto del actual, reasigna con un solo UPDATE (mismo patrón que
    `transfer_driver`/`transfer_vehicle`) + audit_log SÓLO si es una
    reasignación real (transporter_id anterior no nulo) — una asignación
    nueva (antes NULL) no es una 'transferencia'."""
    if ed["change_type"] == "conflict":
        return

    table = _ENTITY_TABLE[entity_type]
    parsed_row = ed["parsed_row"]
    transporter_id = rut_to_transporter_id.get(parsed_row.get("transporter_rut"))

    if ed["change_type"] == "new":
        if entity_type == "driver":
            entity_id = await conn.fetchval(
                "INSERT INTO app.drivers (rut, dv, rut_dv_valid, full_name, source, transporter_id) "
                "VALUES ($1, $2, $3, $4, 'centralizer_upload', $5) RETURNING id",
                ed["entity_key"], parsed_row.get("dv"), parsed_row.get("rut_dv_valid", False),
                parsed_row.get("full_name"), transporter_id,
            )
        else:
            entity_id = await conn.fetchval(
                "INSERT INTO app.vehicles (plate, kind, type_label, source, transporter_id) "
                "VALUES ($1, $2, $3, 'centralizer_upload', $4) RETURNING id",
                ed["entity_key"], parsed_row.get("kind"), parsed_row.get("type_label"), transporter_id,
            )
        await _apply_field_diffs(conn, entity_type, entity_id, ed["field_diffs"], user)
        return

    entity_id = ed["existing_id"]

    if transporter_id is not None:
        row = await conn.fetchrow(
            f"""
            WITH old AS (SELECT transporter_id AS old_id FROM app.{table} WHERE id = $2)
            UPDATE app.{table} t SET transporter_id = $1, updated_at = NOW()
            WHERE t.id = $2 AND t.transporter_id IS DISTINCT FROM $1
            RETURNING (SELECT old_id FROM old) AS old_transporter_id
            """,
            transporter_id, entity_id,
        )
        if row is not None and row["old_transporter_id"] is not None:
            await conn.execute(
                """
                INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
                VALUES ($1::uuid, $2, $3::uuid, 'transfer', 'transporter_id', $4::jsonb, $5::jsonb, 'centralizer_upload')
                """,
                user["sub"], entity_type, entity_id,
                json.dumps({"transporter_id": str(row["old_transporter_id"])}),
                json.dumps({"transporter_id": str(transporter_id)}),
            )

    if ed["change_type"] == "updated":
        await _apply_field_diffs(conn, entity_type, entity_id, ed["field_diffs"], user)


async def _apply_diff(conn, diff: DiffResult, upload_id: str, user: dict) -> set[str]:
    matched_transporter_ids: set[str] = set()
    # Sembrado con empresas ya existentes que Conductores/Vehiculos_Equipos
    # referencian pero que la hoja Empresas de ESTE upload no trae (upload
    # parcial, ver `centralizer_diff.compute_diff`) — no entran a
    # `matched_transporter_ids` (no "aparecieron" en este upload), solo
    # resuelven el FK.
    rut_to_transporter_id: dict[str, str] = dict(diff.get("transporter_id_by_rut", {}))

    for ed in diff["transporters"]:
        tid = await _apply_transporter(conn, ed, user)
        if tid:
            rut_to_transporter_id[ed["entity_key"]] = tid
            matched_transporter_ids.add(tid)

    for ed in diff["drivers"]:
        await _apply_driver_or_vehicle(conn, ed, "driver", user, rut_to_transporter_id)

    for ed in diff["vehicles"]:
        await _apply_driver_or_vehicle(conn, ed, "vehicle", user, rut_to_transporter_id)

    if matched_transporter_ids:
        await conn.execute(
            "UPDATE app.transporters SET last_matched_upload_id = $1, last_matched_at = NOW() "
            "WHERE id = ANY($2::uuid[])",
            upload_id, list(matched_transporter_ids),
        )

    return matched_transporter_ids


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("")
async def upload_and_preview(
    file: UploadFile = File(...),
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_editor),
):
    raw = await file.read()
    await file.seek(0)
    stored = await upload_document_version(supabase, key_prefix="centralizer-uploads", file=file)

    extra_mappings = await _load_extra_mappings(pool)

    try:
        unresolved = find_unresolved_columns(raw, extra_mappings)
    except ValueError as e:
        upload_id = await pool.fetchval(
            """
            INSERT INTO app.centralizer_uploads
              (upload_kind, file_name, storage_path, uploaded_by, status, parse_errors)
            VALUES ('centralizer', $1, $2, $3::uuid, 'failed', $4::jsonb)
            RETURNING id
            """,
            stored["file_name"], stored["storage_path"], user["sub"],
            json.dumps([{"reason": str(e)}]),
        )
        raise HTTPException(422, {"message": str(e), "upload_id": str(upload_id)})

    if unresolved:
        upload_id = await pool.fetchval(
            """
            INSERT INTO app.centralizer_uploads
              (upload_kind, file_name, storage_path, uploaded_by, status)
            VALUES ('centralizer', $1, $2, $3::uuid, 'pending_mapping')
            RETURNING id
            """,
            stored["file_name"], stored["storage_path"], user["sub"],
        )
        return {"upload_id": str(upload_id), "status": "pending_mapping", "unresolved_columns": unresolved}

    parsed = parse_centralizer_workbook(raw, extra_mappings)
    diff = await compute_diff(pool, parsed)
    all_parse_errors = [*parsed["parse_errors"], *diff["parse_errors"]]

    upload_id = await pool.fetchval(
        """
        INSERT INTO app.centralizer_uploads
          (upload_kind, file_name, storage_path, uploaded_by, status, sheet_summary, parse_errors)
        VALUES ('centralizer', $1, $2, $3::uuid, 'previewed', $4::jsonb, $5::jsonb)
        RETURNING id
        """,
        stored["file_name"], stored["storage_path"], user["sub"],
        json.dumps(parsed["sheet_summary"]), json.dumps(all_parse_errors),
    )

    return {
        "upload_id": str(upload_id),
        "sheet_summary": parsed["sheet_summary"],
        "parse_errors": all_parse_errors,
        "diff": diff,
    }


@router.get("")
async def list_uploads(
    page: int = Query(1, ge=1), limit: int = Query(20, ge=1, le=100),
    pool=Depends(get_pool), _=Depends(get_current_user),
):
    offset = (page - 1) * limit
    rows = await pool.fetch(
        """
        SELECT c.id, c.upload_kind, c.file_name, c.status, c.uploaded_by, c.uploaded_at, c.sheet_summary,
               c.approved_by, c.approved_at, c.applied_at, c.rejected_by, c.rejected_at, c.rejection_reason,
               COALESCE(up.full_name, up.email) AS uploaded_by_name,
               COALESCE(ap.full_name, ap.email) AS approved_by_name,
               COALESCE(rp.full_name, rp.email) AS rejected_by_name
        FROM app.centralizer_uploads c
        LEFT JOIN public.profiles up ON up.id = c.uploaded_by
        LEFT JOIN public.profiles ap ON ap.id = c.approved_by
        LEFT JOIN public.profiles rp ON rp.id = c.rejected_by
        ORDER BY c.uploaded_at DESC
        LIMIT $1 OFFSET $2
        """,
        limit, offset,
    )
    count = await pool.fetchval("SELECT COUNT(*) FROM app.centralizer_uploads")
    return {"data": [dict(r) for r in rows], "count": count, "page": page, "limit": limit}


@router.get("/{upload_id}")
async def get_upload(
    upload_id: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), _=Depends(get_current_user),
):
    row = await pool.fetchrow(
        """
        SELECT c.*,
               COALESCE(up.full_name, up.email) AS uploaded_by_name,
               COALESCE(ap.full_name, ap.email) AS approved_by_name,
               COALESCE(rp.full_name, rp.email) AS rejected_by_name
        FROM app.centralizer_uploads c
        LEFT JOIN public.profiles up ON up.id = c.uploaded_by
        LEFT JOIN public.profiles ap ON ap.id = c.approved_by
        LEFT JOIN public.profiles rp ON rp.id = c.rejected_by
        WHERE c.id = $1
        """,
        upload_id,
    )
    if not row:
        raise HTTPException(404, "Upload no encontrado")

    data = dict(row)
    if data["status"] == "failed":
        data["diff"] = None
        data["unresolved_columns"] = None
    elif data["status"] == "pending_mapping":
        extra_mappings = await _load_extra_mappings(pool)
        try:
            raw = supabase.storage.from_(COMPLIANCE_BUCKET).download(data["storage_path"])
        except Exception as e:
            raise HTTPException(502, f"Error descargando el archivo desde Storage: {e}")
        data["diff"] = None
        data["unresolved_columns"] = find_unresolved_columns(raw, extra_mappings)
    else:
        extra_mappings = await _load_extra_mappings(pool)
        parsed = _download_and_parse(supabase, data["storage_path"], extra_mappings)
        data["diff"] = await compute_diff(pool, parsed)
        data["unresolved_columns"] = None
    return {"data": data}


@router.post("/{upload_id}/approve")
async def approve_upload(upload_id: str, pool=Depends(get_pool), user=Depends(require_admin)):
    result = await pool.execute(
        "UPDATE app.centralizer_uploads SET status = 'approved', approved_by = $2, approved_at = NOW() "
        "WHERE id = $1 AND status = 'previewed'",
        upload_id, user["sub"],
    )
    if result == "UPDATE 0":
        current = await pool.fetchval("SELECT status FROM app.centralizer_uploads WHERE id = $1", upload_id)
        if current is None:
            raise HTTPException(404, "Upload no encontrado")
        raise HTTPException(409, f"El upload está en estado '{current}', se requiere 'previewed' para aprobar")
    return {"ok": True, "status": "approved"}


@router.post("/{upload_id}/reject")
async def reject_upload(
    upload_id: str, body: UploadRejectBody,
    pool=Depends(get_pool), user=Depends(require_admin),
):
    result = await pool.execute(
        "UPDATE app.centralizer_uploads SET status = 'rejected', rejected_by = $2, rejected_at = NOW(), "
        "rejection_reason = $3 WHERE id = $1 AND status IN ('previewed', 'approved')",
        upload_id, user["sub"], body.reason,
    )
    if result == "UPDATE 0":
        current = await pool.fetchval("SELECT status FROM app.centralizer_uploads WHERE id = $1", upload_id)
        if current is None:
            raise HTTPException(404, "Upload no encontrado")
        raise HTTPException(
            409, f"El upload está en estado '{current}', sólo se puede rechazar desde 'previewed'/'approved'",
        )
    return {"ok": True, "status": "rejected"}


@router.post("/{upload_id}/apply")
async def apply_upload(
    upload_id: str,
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_admin),
):
    row = await pool.fetchrow(
        "SELECT id, status, storage_path FROM app.centralizer_uploads WHERE id = $1", upload_id,
    )
    if not row:
        raise HTTPException(404, "Upload no encontrado")
    if row["status"] != "approved":
        raise HTTPException(409, f"El upload está en estado '{row['status']}', se requiere 'approved' para aplicar")

    extra_mappings = await _load_extra_mappings(pool)
    parsed = _download_and_parse(supabase, row["storage_path"], extra_mappings)

    async with pool.acquire() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock($1)", ADVISORY_LOCK_KEY)

            # Re-chequeo DENTRO de la transacción, tras el lock: protege contra
            # dos requests de apply concurrentes que hayan pasado ambos el
            # chequeo de arriba antes de que cualquiera commiteara.
            current_status = await conn.fetchval(
                "SELECT status FROM app.centralizer_uploads WHERE id = $1 FOR UPDATE", upload_id,
            )
            if current_status != "approved":
                raise HTTPException(
                    409,
                    f"El upload está en estado '{current_status}', se requiere 'approved' para aplicar",
                )

            diff = await compute_diff(conn, parsed)
            matched_ids = await _apply_diff(conn, diff, upload_id, user)

            await conn.execute(
                "UPDATE app.centralizer_uploads SET status = 'applied', applied_at = NOW() WHERE id = $1",
                upload_id,
            )

    return {"ok": True, "status": "applied", "matched_transporters": len(matched_ids)}
