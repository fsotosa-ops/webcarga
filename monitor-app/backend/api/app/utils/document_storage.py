"""Reemplaza el versionado basado en app.stored_files (dropeada en
Checkpoint A) — cada reemplazo de documento sube a una ruta de Storage
NUEVA (nunca sobrescribe el blob anterior) y registra el valor previo en
app.audit_log en vez de una tabla de versiones dedicada. Decisión de
Checkpoint A §2.2/decisión 4.
"""
import json
from datetime import datetime, timezone

from fastapi import HTTPException, UploadFile

from .stored_files import (
    ALLOWED_STORED_FILE_MIMES,
    COMPLIANCE_BUCKET,
    SIGNED_URL_TTL_SECONDS,
    STORED_FILE_MAX_BYTES,
    safe_storage_name,
)


async def upload_document_version(supabase, *, key_prefix: str, file: UploadFile) -> dict:
    mime = file.content_type or ""
    if mime not in ALLOWED_STORED_FILE_MIMES:
        raise HTTPException(422, f"Tipo de archivo no permitido: {file.filename} ({mime})")
    data = await file.read()
    if len(data) > STORED_FILE_MAX_BYTES:
        raise HTTPException(422, f"Archivo supera 10MB: {file.filename}")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
    storage_path = f"{key_prefix}/{stamp}_{safe_storage_name(file.filename or 'archivo')}"

    try:
        supabase.storage.from_(COMPLIANCE_BUCKET).upload(storage_path, data, {"content-type": mime})
    except Exception as e:
        raise HTTPException(502, f"Error subiendo {file.filename}: {e}")

    return {
        "storage_path": storage_path,
        "file_name": file.filename or "archivo",
        "mime_type": mime,
        "size_bytes": len(data),
    }


async def log_document_replacement(
    pool, *, entity_type: str, entity_id, doc_name: str,
    old_status, old_expiry_date, old_storage_path, actor: str,
) -> None:
    old_value = json.dumps({
        "status": old_status,
        "expiry_date": old_expiry_date.isoformat() if old_expiry_date else None,
        "storage_path": old_storage_path,
    })
    await pool.execute(
        """
        INSERT INTO app.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        VALUES ($1::uuid, $2, $3::uuid, 'document_replace', $4, $5::jsonb, NULL, 'api')
        """,
        actor, entity_type, str(entity_id), doc_name, old_value,
    )


async def get_document_history(pool, supabase, *, entity_type: str, entity_id, doc_name: str) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT old_value, occurred_at, actor
        FROM app.audit_log
        WHERE entity_type = $1 AND entity_id = $2::uuid AND field = $3 AND action = 'document_replace'
        ORDER BY occurred_at DESC
        """,
        entity_type, str(entity_id), doc_name,
    )
    out = []
    for r in rows:
        old = r["old_value"]
        if isinstance(old, str):
            old = json.loads(old)
        storage_path = old.get("storage_path") if old else None
        url = None
        if storage_path:
            try:
                signed = supabase.storage.from_(COMPLIANCE_BUCKET).create_signed_url(storage_path, SIGNED_URL_TTL_SECONDS)
                url = signed.get("signedURL") or signed.get("signedUrl")
            except Exception:
                url = None
        out.append({
            "storage_path": storage_path,
            "status": old.get("status") if old else None,
            "expiry_date": old.get("expiry_date") if old else None,
            "replaced_at": r["occurred_at"].isoformat() if r["occurred_at"] else None,
            "replaced_by": r["actor"],
            "url": url,
        })
    return out
