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
    ClassifyBatchBody, IngestUploadResult, MoveItemsBody, TrayPage,
    UndoClassifyBody, UndoClassifyResult, unclassified_predicate,
)
from ..services.audit import log_change
from ..services.document_matcher import classify_match, match_document
from ..services.matcher_io import cargar_catalogo, cargar_universo
from ..utils.document_storage import (
    delete_document_version, resolve_signed_url, upload_document_version,
)

router = APIRouter(prefix="/document-ingest", tags=["document-ingest"])

_MAX_FILES_PER_UPLOAD = 50

_SQL_COLA = """
    SELECT i.id::text, i.file_name, i.mime_type, i.size_bytes,
           i.storage_path, i.match_status, i.created_at,
           COALESCE(i.carrier_id, b.carrier_id)::text AS carrier_id,
           c.business_name                            AS carrier_name,
           i.confidence,
           r.name                                     AS suggested_requirement_name,
           jsonb_array_length(i.candidates)           AS candidate_count,
           -- Las dos señales de colisión, derivadas en la MISMA pasada.
           -- Se cuentan sobre toda la cola filtrada, no sobre la página:
           -- las window functions corren después del WHERE y antes del
           -- LIMIT, que es exactamente lo que hace falta.
           --
           -- LA GUARDA DE NULL NO ES OPCIONAL: sin ella, los items sin
           -- destino (entity_id NULL) caen todos en la misma partición y
           -- la pantalla diría que reclaman el mismo casillero.
           CASE WHEN i.entity_id IS NOT NULL AND i.requirement_id IS NOT NULL
                THEN count(*) OVER (PARTITION BY i.entity_id, i.requirement_id)
                ELSE 1 END                            AS mismo_casillero,
           -- `ELSE NULL` y no `ELSE 1`: sin hash NO SE SABE si esta
           -- duplicado, y decir 1 seria afirmar que no lo esta. Era el mismo
           -- valor con dos sentidos que ya se resolvio para `mismo_casillero`
           -- con `casillero_ocupado`. La asimetria con su vecina de arriba es
           -- real: ahi "sin destino" significa literalmente "no reclama
           -- ningun casillero", un solo sentido, asi que el 1 esta bien.
           CASE WHEN i.content_sha256 IS NOT NULL
                THEN count(*) OVER (PARTITION BY i.content_sha256)
                ELSE NULL END                         AS mismo_contenido,
           -- La colision que las window functions NO pueden ver: el ocupante
           -- ya fue confirmado, salio de la cola y no esta en ninguna
           -- particion. Es justo el caso destructivo — confirmar este item
           -- reemplaza un documento que hoy es valido.
           --
           -- EXISTS y no JOIN a proposito: un JOIN a compliance_records
           -- multiplicaria la fila si algun dia hay mas de un registro
           -- vigente por (entity_id, requirement_id), y una cola que muestra
           -- el mismo archivo dos veces es peor que una que no avisa.
           -- Y aca NO va la guarda de NULL que llevan sus dos vecinas de
           -- arriba, aunque la simetria la pida: un EXISTS correlacionado con
           -- NULL no encuentra fila y devuelve `false`, nunca NULL. Se probo
           -- empiricamente al escribir esto — sacarle la guarda no cambiaba
           -- ningun resultado, o sea que ningun test podia defenderla.
           --
           -- La diferencia con las vecinas es real y vale entenderla: una
           -- window function SI agrupa los NULL entre si, y sin su guarda
           -- todos los items sin destino caen en la misma particion. Dejar
           -- aca una guarda inerte haria leer las tres como decorativas, y
           -- entonces alguien sacaria una de las que si sostienen algo.
           EXISTS (
               SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = i.entity_id
                  AND cr.requirement_id = i.requirement_id
                  AND cr.is_current = true
                  AND cr.file_url IS NOT NULL) AS casillero_ocupado
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
"""


def _dedup_candidates(candidatos: list) -> list:
    """Un mismo RUT puede aparecer dos veces en el nombre del archivo
    (`F30_<rut>_ANEXO_<rut>.pdf`): `extract_ruts` no deduplica y el loop del
    motor tampoco, así que llegan dos candidatos que son la MISMA entidad.
    Sin esto, `classify_match` los ve empatados y declara AMBIGUOUS aunque no
    haya ninguna ambigüedad real — la Bandeja termina ofreciendo elegir entre
    una opción y ella misma.

    `match_document` ya devuelve la lista ordenada por confianza descendente,
    así que quedarse con la primera aparición de cada (entity_type, entity_id)
    es quedarse con la de mayor confianza.
    """
    vistos: set[tuple] = set()
    unicos = []
    for c in candidatos:
        clave = (c.entity_type, c.entity_id)
        if clave in vistos:
            continue
        vistos.add(clave)
        unicos.append(c)
    return unicos


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

    # UNA vez por lote, no una por archivo: el motor es puro justamente para
    # poder reusar lo cargado. Una carga de 50 documentos hace 2 consultas, no 100.
    #
    # El universo va acotado a la empresa cuando la hay, y eso es lo que mas
    # sube la precision: ~2 conductores y ~3 vehiculos contra 87 y 124.
    catalogo = await cargar_catalogo(conn)
    universo = await cargar_universo(conn, carrier_id)

    for file in files:
        try:
            uploaded = await upload_document_version(
                supabase, key_prefix=f"staging/{batch_id}", file=file,
            )
        except HTTPException as exc:
            errors.append({"file_name": file.filename or "archivo", "error": str(exc.detail)})
            continue

        # El archivo YA esta en storage. Si el motor falla, la fila entra
        # UNMATCHED —el comportamiento exacto de antes de esta ronda— en vez de
        # dejar un blob huerfano y mostrarle un error al operador sobre un
        # archivo que si se subio. El motivo queda en `error` (sin PII: solo
        # el tipo de excepcion y su mensaje, nunca el nombre del archivo) para
        # no perder el rastro en silencio.
        try:
            candidatos = _dedup_candidates(match_document(
                file_name=uploaded["file_name"], catalog=catalogo, universe=universo,
            ))
            motivo_error = None
        except Exception as exc:
            candidatos = []
            motivo_error = f"{type(exc).__name__}: {exc}"
        estado = classify_match(candidatos)
        mejor = candidatos[0] if candidatos else None
        # Un empate real (AMBIGUOUS) no tiene un ganador: elegir
        # candidatos[0] escribiria un desempate arbitrario, definido por el
        # orden de recorrido del motor (empresas -> vehiculos -> conductores),
        # no por una decision. La lista completa sigue en `candidates`: de ahi
        # sale la eleccion cuando classify-batch la preseleccione.
        ambiguo = estado == "AMBIGUOUS"

        row = await conn.fetchrow(
            """
            INSERT INTO public.document_ingest_items
                (batch_id, storage_path, file_name, mime_type, size_bytes,
                 match_status, entity_type, entity_id, requirement_id,
                 confidence, match_evidence, candidates, error, content_sha256)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid, $9::uuid, $10, $11::jsonb, $12::jsonb, $13, $14)
            RETURNING id::text, file_name, mime_type, size_bytes, storage_path, match_status
            """,
            batch_id, uploaded["storage_path"], uploaded["file_name"],
            uploaded["mime_type"], uploaded["size_bytes"],
            estado,
            mejor.entity_type if mejor and not ambiguo else None,
            mejor.entity_id if mejor and not ambiguo else None,
            mejor.requirement_id if mejor and not ambiguo else None,
            mejor.confidence if mejor and not ambiguo else None,
            json.dumps(mejor.evidence if mejor else {}),
            # La lista COMPLETA, para que AMBIGUOUS pueda ofrecer las dos
            # opciones en vez de obligar a empezar de cero.
            json.dumps([
                {"entity_type": c.entity_type, "entity_id": c.entity_id,
                 "requirement_id": c.requirement_id, "confidence": c.confidence,
                 "evidence": c.evidence}
                for c in candidatos
            ]),
            motivo_error,
            uploaded["content_sha256"],
        )
        items.append(dict(row))

    # Instrumentacion, no el badge de la Bandeja: ese sale de
    # unclassified_predicate() en compliance.py, no de estos contadores.
    # `matched_auto`/`matched_review` se crearon para medir si hace falta
    # sumar OCR/LLM y estaban en 0 desde que existe la columna.
    sin_resolver = sum(1 for i in items if i["match_status"] == "UNMATCHED")
    auto = sum(1 for i in items if i["match_status"] == "AUTO")
    para_revisar = sum(1 for i in items if i["match_status"] in ("SUGGESTED", "AMBIGUOUS"))
    await conn.execute(
        "UPDATE public.document_ingest_batches "
        "SET unmatched = $2, matched_auto = $3, matched_review = $4 WHERE id = $1",
        batch_id, sin_resolver, auto, para_revisar,
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
    #
    # El predicado sale de unclassified_predicate() y no se escribe a mano: es
    # el mismo que cuenta el "sin clasificar" por empresa en compliance.py.
    where = f"""
        WHERE {unclassified_predicate('i')}
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
        _SQL_COLA.format(where=where),
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


_UN_SOLO_ARCHIVO_POR_SLOT = (
    "Un lote no puede compartir el sujeto y el tipo de documento a la vez: "
    "cada archivo necesita un requisito distinto"
)


@router.post("/items/classify-batch")
async def classify_batch(
    body: ClassifyBatchBody,
    pool=Depends(get_pool),
    user=Depends(require_editor),
):
    """Aplica un archivo de la bandeja a un requisito concreto.

    **Regla del lote (diseño §7):** en una tanda una coordenada se comparte y
    la otra tiene que ser distinta en cada archivo; nunca las dos. Este
    endpoint fija las dos —`entity_id` y `requirement_id`—, así que admite un
    solo archivo.

    Sin ese límite, N archivos entraban en un loop sobre el mismo
    `compliance_record` y cada uno pisaba al anterior: quedaba el último y los
    N-1 restantes se volvían invisibles (marcados COMMITTED, excluidos de la
    cola) y además irreversibles, porque a partir del segundo
    `_apply_stored_document` escribe `replaced_storage_path` y el deshacer los
    rechaza. Marcar 31 licencias y asignarlas al mismo conductor destruía 30.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")
    if len(set(body.item_ids)) > 1:
        raise HTTPException(422, _UN_SOLO_ARCHIVO_POR_SLOT)

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
                    "Esa entidad no tiene ese requisito. Verifica la categoría y el tipo de documento.",
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
    """Asigna archivos sin clasificar a una empresa, y VUELVE A CLASIFICARLOS.

    Saber de qué empresa es un archivo es información nueva, y el match es una
    función del nombre Y de la empresa: sin ella el motor no tiene a quién
    proponerle un documento de empresa, y con ella sí. Dejar el match viejo
    seria guardar una respuesta calculada con menos datos de los que hay.

    Medido antes de esto: 67 archivos pasaron por la cola y NINGUNO produjo un
    candidato, porque el match corría una sola vez —al subir, sin empresa— y
    ninguna de sus ramas podía resolver sin un RUT o una patente en el nombre.

    No toca compliance_records — estos archivos todavía no están aplicados a
    ningún requisito.
    """
    if not body.item_ids:
        raise HTTPException(422, "Se requiere al menos un documento")

    async with pool.acquire() as conn:
        async with conn.transaction():
            result = await conn.execute(
                "UPDATE public.document_ingest_items SET carrier_id = $2, updated_at = NOW() "
                "WHERE id = ANY($1::uuid[])",
                body.item_ids, body.carrier_id,
            )

            # El MISMO motor y las MISMAS cargas que la subida. Reusarlos es lo
            # que evita que existan dos definiciones de "match" que se separen.
            catalogo = await cargar_catalogo(conn)
            universo = await cargar_universo(conn, body.carrier_id)

            # Sólo los que siguen sin clasificar: recalcular el match de uno ya
            # confirmado pisaría una decisión humana con una propuesta.
            pendientes = await conn.fetch(
                f"""
                SELECT id::text, file_name FROM public.document_ingest_items
                WHERE id = ANY($1::uuid[]) AND {unclassified_predicate('document_ingest_items')}
                """,
                body.item_ids,
            )
            for item in pendientes:
                try:
                    candidatos = _dedup_candidates(match_document(
                        file_name=item["file_name"], catalog=catalogo, universe=universo,
                    ))
                    motivo_error = None
                except Exception as exc:
                    candidatos = []
                    motivo_error = f"{type(exc).__name__}: {exc}"
                estado = classify_match(candidatos)
                mejor = candidatos[0] if candidatos else None
                # Mismo criterio que la subida: un empate no tiene ganador, y
                # elegir candidatos[0] escribiría un desempate arbitrario.
                ambiguo = estado == "AMBIGUOUS"
                await conn.execute(
                    """
                    UPDATE public.document_ingest_items SET
                        match_status = $2, entity_type = $3, entity_id = $4::uuid,
                        requirement_id = $5::uuid, confidence = $6,
                        match_evidence = $7::jsonb, candidates = $8::jsonb,
                        error = $9, updated_at = NOW()
                    WHERE id = $1::uuid
                    """,
                    item["id"], estado,
                    mejor.entity_type if mejor and not ambiguo else None,
                    mejor.entity_id if mejor and not ambiguo else None,
                    mejor.requirement_id if mejor and not ambiguo else None,
                    mejor.confidence if mejor and not ambiguo else None,
                    json.dumps(mejor.evidence if mejor else {}),
                    json.dumps([
                        {"entity_type": c.entity_type, "entity_id": c.entity_id,
                         "requirement_id": c.requirement_id, "confidence": c.confidence,
                         "evidence": c.evidence}
                        for c in candidatos
                    ]),
                    motivo_error,
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
                       cr.metadata, cr.entity_type, cr.entity_id::text AS entity_id,
                       cr.file_url
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
                # Deja rastro, igual que sus operaciones hermanas: aplicar
                # registra `document_upload` y reasignar `document_reassign`.
                # Sin esto la reversión vacía un registro de producción
                # (APPROVED_MANUAL → MISSING, y adiós file_url) sin que nada
                # permita saber después quién lo hizo ni qué archivo había.
                await log_change(
                    conn, actor=user["sub"], entity_type=item["entity_type"],
                    entity_id=item["entity_id"], action="document_undo_classify",
                    field="file_url", old_value=item["file_url"], new_value="bandeja",
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
