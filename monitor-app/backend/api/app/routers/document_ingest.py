"""Bandeja de documentos sin clasificar, por empresa (HU-01).

El problema que resuelve: hasta ahora solo se podía subir un archivo a un
compliance_record que YA existía y que había que elegir de antemano. Pero los
documentos llegan en bloque y con nombres que no dicen nada (`IMG_4905.PNG`,
`3.jpeg`), así que quien carga no sabe todavía a qué requisito va cada uno.

Acá el archivo entra sin declarar nada y espera en staging. NADA toca
public.compliance_records hasta que una persona lo clasifica explícitamente.
Ningún archivo se descarta solo: lo que no se clasifica queda en la bandeja
de esa empresa hasta que alguien lo resuelva o lo elimine.
"""
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from ..auth import get_current_user, get_supabase, require_editor
from ..db import get_pool
from ..routers.compliance import _apply_stored_document
from ..schemas.document_ingest import (
    ClassifyBatchBody, ClassifyBody, IngestUploadResult, MoveItemsBody, TrayPage,
    UndoClassifyBody, UndoClassifyResult,
)
from ..utils.document_storage import (
    delete_document_version, resolve_signed_url, upload_document_version,
)

router = APIRouter(prefix="/document-ingest", tags=["document-ingest"])

_MAX_FILES_PER_UPLOAD = 50


async def _ingest_files(conn, supabase, *, carrier_id, files, actor):
    """Sube N archivos a staging y los deja en la bandeja, sin clasificarlos.

    `carrier_id` puede ser None: la tanda que llega por correo mezcla empresas
    y quien carga todavía no sabe de quién es nada. Obligarlo a elegir una
    empresa antes de soltar los archivos convierte la bandeja en un buscador.

    Procesamiento por archivo, no todo-o-nada: un MIME inválido no tumba el
    resto del lote (mismo criterio que POST /compliance-records/bulk-file).
    """
    items: list[dict] = []
    errors: list[dict] = []

    batch_id = await conn.fetchval(
        """
        INSERT INTO public.document_ingest_batches
            (carrier_id, source, status, created_by, total_files)
        VALUES ($1, 'UPLOAD', 'REVIEW', $2, $3)
        RETURNING id::text
        """,
        carrier_id, actor, len(files),
    )

    for file in files:
        try:
            uploaded = await upload_document_version(
                supabase, key_prefix=f"staging/{batch_id}", file=file,
            )
        except HTTPException as exc:
            errors.append({"file_name": file.filename or "archivo", "error": str(exc.detail)})
            continue

        row = await conn.fetchrow(
            """
            INSERT INTO public.document_ingest_items
                (batch_id, storage_path, file_name, mime_type, size_bytes, match_status)
            VALUES ($1, $2, $3, $4, $5, 'UNMATCHED')
            RETURNING id::text, file_name, mime_type, size_bytes, storage_path, match_status
            """,
            batch_id, uploaded["storage_path"], uploaded["file_name"],
            uploaded["mime_type"], uploaded["size_bytes"],
        )
        items.append(dict(row))

    await conn.execute(
        "UPDATE public.document_ingest_batches SET unmatched = $2 WHERE id = $1",
        batch_id, len(items),
    )
    return batch_id, items, errors


def _check_upload_size(files: list[UploadFile]) -> None:
    if not files:
        raise HTTPException(422, "Se requiere al menos un archivo")
    if len(files) > _MAX_FILES_PER_UPLOAD:
        raise HTTPException(422, f"Máximo {_MAX_FILES_PER_UPLOAD} archivos por carga")


@router.post("/files", status_code=201, response_model=IngestUploadResult)
async def upload_to_global_tray(
    files: list[UploadFile] = File(...),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    """Sube N archivos a la bandeja global, sin empresa y sin clasificar.

    Es la puerta de la tanda mezclada. El archivo queda con carrier_id NULL
    hasta que alguien lo mueve a una empresa o lo clasifica directo.
    """
    _check_upload_size(files)
    async with pool.acquire() as conn:
        async with conn.transaction():
            batch_id, items, errors = await _ingest_files(
                conn, supabase, carrier_id=None, files=files, actor=user["sub"],
            )
    return {"batch_id": batch_id, "items": items, "errors": errors}


@router.post("/{carrier_id}/files", status_code=201, response_model=IngestUploadResult)
async def upload_to_tray(
    carrier_id: str,
    files: list[UploadFile] = File(...),
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    """Sube N archivos a la bandeja de una empresa, sin clasificarlos."""
    _check_upload_size(files)
    async with pool.acquire() as conn:
        async with conn.transaction():
            batch_id, items, errors = await _ingest_files(
                conn, supabase, carrier_id=carrier_id, files=files, actor=user["sub"],
            )
    return {"batch_id": batch_id, "items": items, "errors": errors}


@router.get("/items", response_model=TrayPage)
async def list_queue(
    carrier_id: str | None = None,
    limit: int = 200,
    offset: int = 0,
    pool=Depends(get_pool),
    _=Depends(get_current_user),
):
    """La cola global de documentos sin clasificar, agrupada por empresa.

    Sin `carrier_id` devuelve la cola completa: una bandeja que obliga a elegir
    una empresa antes de mostrar algo es un buscador, no una bandeja.

    NO firma URLs. Firmar es una llamada HTTP a Storage por archivo, y con los
    2.000 pendientes el request no termina. La vista previa se mira de a un
    archivo por vez, así que se firma en /items/{id}/preview-url.
    """
    limit = max(1, min(limit, 500))
    offset = max(0, offset)
    # AUTO, SUGGESTED y AMBIGUOUS son trabajo pendiente: el clasificador los
    # resolvio pero nadie los confirmo todavia. Filtrar solo UNMATCHED los
    # dejaba sin ninguna superficie que los muestre.
    where = """
        WHERE i.match_status NOT IN ('COMMITTED', 'DISCARDED')
          AND ($1::uuid IS NULL OR COALESCE(i.carrier_id, b.carrier_id) = $1::uuid)
    """
    total = await pool.fetchval(
        f"""
        SELECT count(*)
        FROM public.document_ingest_items i
        JOIN public.document_ingest_batches b ON b.id = i.batch_id
        {where}
        """,
        carrier_id,
    )
    rows = await pool.fetch(
        f"""
        SELECT i.id::text, i.file_name, i.mime_type, i.size_bytes,
               i.storage_path, i.match_status, i.created_at,
               COALESCE(i.carrier_id, b.carrier_id)::text AS carrier_id,
               c.business_name                            AS carrier_name,
               i.confidence,
               r.name                                     AS suggested_requirement_name,
               jsonb_array_length(i.candidates)           AS candidate_count
        FROM public.document_ingest_items i
        JOIN public.document_ingest_batches b ON b.id = i.batch_id
        LEFT JOIN public.carriers c
               ON c.id = COALESCE(i.carrier_id, b.carrier_id)
        LEFT JOIN public.compliance_requirements r ON r.id = i.requirement_id
        {where}
        -- file_name desempata: una carga masiva entra con el mismo created_at
        -- y sin desempate el orden queda arbitrario entre recargas. En una cola
        -- donde se selecciona por rango, eso hace que marques otra cosa.
        ORDER BY c.business_name NULLS LAST, i.created_at, i.file_name
        LIMIT $2 OFFSET $3
        """,
        carrier_id, limit, offset,
    )
    return {"total": total or 0, "rows": [dict(r) for r in rows]}


@router.get("/items/{item_id}/preview-url")
async def get_preview_url(
    item_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    _=Depends(get_current_user),
):
    """Firma la URL de un solo archivo, al enfocarlo en la bandeja."""
    storage_path = await pool.fetchval(
        "SELECT storage_path FROM public.document_ingest_items WHERE id = $1",
        item_id,
    )
    if not storage_path:
        raise HTTPException(404, "Documento no encontrado")
    return {"preview_url": resolve_signed_url(supabase, storage_path)}


@router.post("/items/{item_id}/classify")
async def classify_item(
    item_id: str,
    body: ClassifyBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Asigna un archivo de la bandeja a un requisito concreto.

    El compliance_record ya existe — lo sembró el template al crear la entidad
    — así que se busca por (entity_id, requirement_id), no se crea.

    Un item ya clasificado SE PUEDE volver a clasificar: es el caso del PDF
    que contiene padrón, permiso de circulación y revisión técnica en un solo
    archivo. Se asigna el mismo archivo a otro requisito sin duplicar el blob.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            item = await conn.fetchrow(
                "SELECT storage_path, file_name, mime_type, size_bytes, match_status "
                "FROM public.document_ingest_items WHERE id = $1",
                item_id,
            )
            if not item:
                raise HTTPException(404, "Documento no encontrado en la bandeja")
            if item["match_status"] == "DISCARDED":
                raise HTTPException(409, "Este documento fue eliminado de la bandeja")

            record = await conn.fetchrow(
                """
                SELECT id::text, entity_id::text, entity_type, status, expiration_date
                FROM public.compliance_records
                WHERE entity_id = $1 AND requirement_id = $2 AND is_current = true
                """,
                body.entity_id, body.requirement_id,
            )
            if not record:
                raise HTTPException(
                    404,
                    "Esa entidad no tiene ese requisito. Verificá la categoría y el tipo de documento.",
                )

            if body.expiration_date is None:
                needs_date = await conn.fetchval(
                    "SELECT COALESCE(has_expiration, false) "
                    "FROM public.compliance_requirements WHERE id = $1",
                    body.requirement_id,
                )
                if needs_date:
                    raise HTTPException(422, "Este documento requiere fecha de vencimiento")

            await _apply_stored_document(
                conn, record["id"],
                storage_path=item["storage_path"], file_name=item["file_name"],
                mime_type=item["mime_type"], size_bytes=item["size_bytes"],
                expiration_date=body.expiration_date, actor=user["sub"],
                entity_type=record["entity_type"], entity_id=record["entity_id"],
                old_status=record["status"],
            )

            await conn.execute(
                """
                UPDATE public.document_ingest_items SET
                    match_status = 'COMMITTED',
                    entity_type = $2, entity_id = $3, requirement_id = $4,
                    compliance_record_id = $5, expiration_date = $6, updated_at = NOW()
                WHERE id = $1
                """,
                item_id, body.entity_type, body.entity_id, body.requirement_id,
                record["id"], body.expiration_date,
            )

    return {"compliance_record_id": record["id"]}


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: str,
    pool=Depends(get_pool),
    supabase=Depends(get_supabase),
    user=Depends(require_editor),
):
    """Descarta un documento de la bandeja.

    Se marca DISCARDED (no se borra la fila) para conservar el rastro de que
    existió, y recién ahí se elimina el blob de staging.
    """
    async with pool.acquire() as conn:
        async with conn.transaction():
            item = await conn.fetchrow(
                "SELECT storage_path FROM public.document_ingest_items WHERE id = $1", item_id,
            )
            if not item:
                raise HTTPException(404, "Documento no encontrado en la bandeja")
            await conn.execute(
                "UPDATE public.document_ingest_items SET match_status = 'DISCARDED', "
                "updated_at = NOW() WHERE id = $1",
                item_id,
            )
    delete_document_version(supabase, item["storage_path"])
    return None


@router.post("/items/classify-batch")
async def classify_batch(
    body: ClassifyBatchBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Aplica el mismo requisito a N archivos de la bandeja.

    Es la operación que hace viable clasificar 2.000 documentos: con un archivo
    seleccionado equivale a clasificar de a uno, con quince aplica a los quince
    sin que la persona repita la elección.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    applied: list[str] = []
    errors: list[dict] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            items = await conn.fetch(
                "SELECT id::text, storage_path, file_name, mime_type, size_bytes, match_status "
                "FROM public.document_ingest_items WHERE id = ANY($1::uuid[])",
                body.item_ids,
            )
            if not items:
                raise HTTPException(404, "Ningún documento encontrado en la bandeja")

            record = await conn.fetchrow(
                """
                SELECT id::text, entity_id::text, entity_type, status, expiration_date
                FROM public.compliance_records
                WHERE entity_id = $1 AND requirement_id = $2 AND is_current = true
                """,
                body.entity_id, body.requirement_id,
            )
            if not record:
                raise HTTPException(
                    404,
                    "Esa entidad no tiene ese requisito. Verificá la categoría y el tipo de documento.",
                )

            if body.expiration_date is None:
                needs_date = await conn.fetchval(
                    "SELECT COALESCE(has_expiration, false) "
                    "FROM public.compliance_requirements WHERE id = $1",
                    body.requirement_id,
                )
                if needs_date:
                    raise HTTPException(422, "Este documento requiere fecha de vencimiento")

            for item in items:
                if item["match_status"] == "DISCARDED":
                    errors.append({"item_id": item["id"], "error": "Fue eliminado de la bandeja"})
                    continue
                await _apply_stored_document(
                    conn, record["id"],
                    storage_path=item["storage_path"], file_name=item["file_name"],
                    mime_type=item["mime_type"], size_bytes=item["size_bytes"],
                    expiration_date=body.expiration_date, actor=user["sub"],
                    entity_type=record["entity_type"], entity_id=record["entity_id"],
                    old_status=record["status"],
                )
                applied.append(item["id"])

            if applied:
                await conn.execute(
                    """
                    UPDATE public.document_ingest_items SET
                        match_status = 'COMMITTED',
                        entity_type = $2, entity_id = $3, requirement_id = $4,
                        compliance_record_id = $5, expiration_date = $6, updated_at = NOW()
                    WHERE id = ANY($1::uuid[])
                    """,
                    applied, body.entity_type, body.entity_id, body.requirement_id,
                    record["id"], body.expiration_date,
                )

    return {"applied": applied, "errors": errors}


@router.post("/items/move")
async def move_items(
    body: MoveItemsBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Reasigna archivos sin clasificar a otra empresa.

    Un solo UPDATE a propósito: mover cuarenta archivos en un bucle serían
    cuarenta statements. No toca compliance_records — estos archivos todavía
    no están aplicados a ningún requisito.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    async with pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE public.document_ingest_items SET carrier_id = $2, updated_at = NOW() "
            "WHERE id = ANY($1::uuid[])",
            body.item_ids, body.carrier_id,
        )
    return {"moved": int(str(result).rsplit(" ", 1)[-1])}


@router.post("/items/undo-classify", response_model=UndoClassifyResult)
async def undo_classify(
    body: UndoClassifyBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Revierte una clasificación en lote: vacía el requisito y devuelve el
    archivo a la bandeja.

    Sin esto no se puede entregar la asignación en lote: hoy corregir es de a
    uno, y 200 archivos en la empresa equivocada no tendrían vuelta atrás.

    NO revierte cuando el requisito ya tenía un documento antes: restaurarlo
    exige el historial de versiones, que todavía no existe. Esos casos vuelven
    en `errors` en vez de dejar el registro a medias — revertir a MISSING
    borraría un documento que era válido antes de la operación.

    El blob de staging NO se borra: el archivo vuelve a la bandeja y tiene que
    seguir siendo visible y clasificable.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    reverted: list[str] = []
    errors: list[dict] = []

    async with pool.acquire() as conn:
        async with conn.transaction():
            items = await conn.fetch(
                """
                SELECT i.id::text, i.compliance_record_id::text, i.match_status,
                       cr.metadata
                FROM public.document_ingest_items i
                LEFT JOIN public.compliance_records cr ON cr.id = i.compliance_record_id
                WHERE i.id = ANY($1::uuid[])
                """,
                body.item_ids,
            )
            if not items:
                raise HTTPException(404, "Ningún documento encontrado en la bandeja")

            for item in items:
                if item["match_status"] != "COMMITTED":
                    errors.append({"item_id": item["id"], "error": "No estaba clasificado"})
                    continue
                if not item["compliance_record_id"]:
                    errors.append({"item_id": item["id"], "error": "No estaba clasificado"})
                    continue

                metadata = item["metadata"] or {}
                if isinstance(metadata, str):
                    metadata = json.loads(metadata)
                # Si el requisito tenia un documento anterior, la aplicacion
                # lo piso y restaurarlo exige el historial de versiones.
                if metadata.get("replaced_storage_path"):
                    errors.append({
                        "item_id": item["id"],
                        "error": "El requisito tenía un documento anterior; no se puede revertir sin historial",
                    })
                    continue

                await conn.execute(
                    """
                    UPDATE public.compliance_records SET
                        status = 'MISSING', file_url = NULL, metadata = '{}'::jsonb,
                        expiration_date = NULL, updated_at = NOW()
                    WHERE id = $1
                    """,
                    item["compliance_record_id"],
                )
                reverted.append(item["id"])

            if reverted:
                await conn.execute(
                    """
                    UPDATE public.document_ingest_items SET
                        match_status = 'UNMATCHED',
                        entity_type = NULL, entity_id = NULL, requirement_id = NULL,
                        compliance_record_id = NULL, expiration_date = NULL,
                        updated_at = NOW()
                    WHERE id = ANY($1::uuid[])
                    """,
                    reverted,
                )

    return {"reverted": reverted, "errors": errors}
