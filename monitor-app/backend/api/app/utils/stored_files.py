"""Versionado generalizado de archivos (app.stored_files) — plan §1.4/§1.5.

Cubre tanto compliance_documents como insurance_policies (owner_type
polimórfico). Reusa el patrón de sanitización de nombre de archivo y la
whitelist de mime types ya validados en producción por app/routers/trips.py
(bitácora de viajes) — mismo problema de InvalidKey de Supabase Storage con
nombres reales (espacios angostos, paréntesis, etc.).
"""
import re
import unicodedata

from fastapi import HTTPException, UploadFile

COMPLIANCE_BUCKET = "compliance-docs"
STORED_FILE_MAX_BYTES = 10 * 1024 * 1024
ALLOWED_STORED_FILE_MIMES = {
    "application/pdf", "image/png", "image/jpeg", "image/webp",
    "image/heic", "image/heif",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}
SIGNED_URL_TTL_SECONDS = 3600


def safe_storage_name(file_name: str) -> str:
    """Nombre seguro para la key de Supabase Storage (mismo patrón que
    trips._safe_storage_name — ver test_attachment_storage_key_is_sanitized)."""
    normalized = unicodedata.normalize("NFKD", file_name)
    ascii_name = normalized.encode("ascii", "ignore").decode()
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", ascii_name).strip("._")
    return safe or "archivo"


async def next_version(pool, owner_type: str, owner_id) -> int:
    v = await pool.fetchval(
        "SELECT COALESCE(MAX(version), 0) FROM app.stored_files "
        "WHERE owner_type = $1 AND owner_id = $2::uuid",
        owner_type, str(owner_id),
    )
    return (v or 0) + 1


async def upload_owner_file(
    pool, supabase, *, owner_type: str, owner_id, key_prefix: str,
    file: UploadFile, uploaded_by: str,
) -> dict:
    """Valida mime/tamaño, sube a Storage, inserta la versión en
    app.stored_files. No actualiza la fila dueña (compliance_documents /
    insurance_policies) — eso lo hace el caller, que conoce esa tabla."""
    mime = file.content_type or ""
    if mime not in ALLOWED_STORED_FILE_MIMES:
        raise HTTPException(422, f"Tipo de archivo no permitido: {file.filename} ({mime})")
    data = await file.read()
    if len(data) > STORED_FILE_MAX_BYTES:
        raise HTTPException(422, f"Archivo supera 10MB: {file.filename}")

    version = await next_version(pool, owner_type, owner_id)
    storage_path = f"{key_prefix}/v{version}_{safe_storage_name(file.filename or 'archivo')}"

    try:
        supabase.storage.from_(COMPLIANCE_BUCKET).upload(
            storage_path, data, {"content-type": mime}
        )
    except Exception as e:
        raise HTTPException(502, f"Error subiendo {file.filename}: {e}")

    row = await pool.fetchrow(
        """
        INSERT INTO app.stored_files
          (owner_type, owner_id, storage_path, file_name, mime_type, size_bytes, version, uploaded_by)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::uuid)
        RETURNING id, owner_type, owner_id, storage_path, file_name, mime_type, size_bytes, version, uploaded_by, uploaded_at
        """,
        owner_type, str(owner_id), storage_path, file.filename or "archivo", mime, len(data), version, uploaded_by,
    )
    return dict(row)


async def list_owner_files(pool, supabase, *, owner_type: str, owner_id) -> list[dict]:
    rows = await pool.fetch(
        """
        SELECT id, storage_path, file_name, mime_type, size_bytes, version, uploaded_by, uploaded_at
        FROM app.stored_files
        WHERE owner_type = $1 AND owner_id = $2::uuid
        ORDER BY version DESC
        """,
        owner_type, str(owner_id),
    )
    out = []
    for r in rows:
        d = dict(r)
        try:
            signed = supabase.storage.from_(COMPLIANCE_BUCKET).create_signed_url(
                d["storage_path"], SIGNED_URL_TTL_SECONDS
            )
            d["url"] = signed.get("signedURL") or signed.get("signedUrl")
        except Exception:
            d["url"] = None
        out.append(d)
    return out
