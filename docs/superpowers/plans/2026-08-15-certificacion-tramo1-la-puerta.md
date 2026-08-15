# Certificación · Tramo 1 — La puerta de carga

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) o superpowers:executing-plans para implementar este plan tarea por tarea. Los pasos usan `- [ ]` para seguimiento.

**Goal:** Que se puedan volcar los 2.000 documentos pendientes a la bandeja global sin elegir una empresa de antemano, verlos todos con sus sugerencias, clasificarlos en lote, y deshacer el lote si salió mal.

**Architecture:** Tres cambios de backend sobre la cola de ingesta que ya existe —una puerta de carga sin empresa, una cola que deja de esconder los archivos con sugerencia, y un deshacer de lote— y el cableado de esos tres en `TriageWorkbench`, que ya acepta `carrierId` opcional y por lo tanto ya sabe ser global. **No se toca el esquema de la base.** Nada de este tramo depende de la migración del historial, que es del Tramo 3.

**Tech Stack:** FastAPI + asyncpg + pytest (`AsyncMock`) · Next.js 14 App Router + React Query + Tailwind + vitest + Testing Library · Supabase Storage.

**Spec:** `docs/superpowers/specs/2026-08-15-certificacion-rediseno-design.md`

## Global Constraints

- **Español neutral, nunca voseo.** En la interfaz y en los comentarios: "Elige", "Arrastra", "Selecciona". Nunca "Elegí", "Verificá", "Arrastrá".
- **Cero emojis.** Íconos sólo de `lucide-react`.
- **Nunca la palabra "hueco" ni "slot" en la interfaz.** Los textos son `Elegir a qué corresponde`, `A qué corresponde este documento`, `Lo que falta · N documentos`, `faltan N`.
- **Todo botón de lote nombra la cantidad exacta:** `Asignar los 3 a…`, nunca `Asignar seleccionados`.
- **Ninguna operación en lote se entrega sin su deshacer.**
- **Tokens visuales existentes de `app/globals.css`.** `--accent #1cb9ec`, `--ink #192a3e` (clase `text-text-primary`), `--border #dfe0eb` (clase `border-border`). No se introduce paleta nueva.
- **Rojo `#b00020` tiene un solo significado en el módulo:** hay archivos esperando que los ubiquen.
- Backend: correr pytest con `monitor-app/backend/api/venv`, no `.venv` ni anaconda.
- Al agregar una dependencia a `pyproject.toml`, editar también el `Dockerfile` en el mismo commit. Este tramo no agrega ninguna.
- Trabajar sobre la rama `dev`. No promover a `main`.
- **El código muerto se borra en el mismo commit que lo deja muerto.** Si una tarea deja un
  componente, un método de cliente, un endpoint, un tipo o un test sin ningún llamador, se elimina
  ahí mismo — no se deja "por si acaso" ni se difiere a una limpieza posterior. Verificar con
  `grep -rn "<nombre>" --include="*.ts" --include="*.tsx" --include="*.py"` antes de borrar: un
  nombre que parece sin uso puede estar referenciado con otra grafía.

---

## File Structure

**Backend** (`monitor-app/backend/api/`)

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `app/routers/document_ingest.py` | Endpoints de la cola de ingesta | Modificar: extraer `_ingest_files`, agregar `POST /files`, ampliar el filtro de `GET /items`, agregar `POST /items/undo-classify` |
| `app/schemas/document_ingest.py` | Contratos de la bandeja | Modificar: agregar `UndoClassifyBody` y `UndoClassifyResult` |
| `tests/test_document_ingest.py` | Tests de la bandeja | Modificar: casos nuevos |

**Frontend** (`monitor-app/frontend/`)

| Archivo | Responsabilidad | Cambio |
|---|---|---|
| `lib/api/documentIngest.ts` | Cliente de la cola | Modificar: `upload` acepta empresa opcional, agregar `undoClassify` |
| `components/compliance/TriageDropzone.tsx` | **Nuevo.** La zona de carga con sus cuatro estados | Crear |
| `components/compliance/TriageDropzone.test.tsx` | **Nuevo.** | Crear |
| `components/compliance/TriageWorkbench.tsx` | La bandeja completa | Modificar: usar `TriageDropzone`, quitar la condición `carrierId`, guardar el último lote para deshacer |
| `components/compliance/TriageBulkBar.tsx` | Barra de acciones de la selección | Modificar: los botones nombran la cantidad |
| `components/compliance/TriageUndoNotice.tsx` | **Nuevo.** El aviso de deshacer | Crear |
| `components/compliance/TriageUndoNotice.test.tsx` | **Nuevo.** | Crear |

`TriageDropzone` y `TriageUndoNotice` son archivos nuevos y no ampliaciones de `TriageWorkbench` porque ese archivo ya tiene 307 líneas y cuatro responsabilidades. Cada uno tiene una sola: recibir archivos, y ofrecer revertir.

---

## Task 1: Carga global, sin empresa

Hoy `POST /document-ingest/{carrier_id}/files` **exige** una empresa. Por eso la bandeja global no tiene puerta: la zona de arrastre de `TriageWorkbench` está detrás de `{canEdit && carrierId && (…)}`. Este es el bloqueo real para meter los 2.000 documentos.

`document_ingest_batches.carrier_id` ya es `NULL`-able, así que no hace falta tocar el esquema.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py:30-89`
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Produces: `POST /api/v1/document-ingest/files` → `IngestUploadResult` (`{batch_id, items, errors}`), idéntico al de la ruta con empresa.
- Produces: `_ingest_files(conn, supabase, *, carrier_id: str | None, files: list[UploadFile], actor: str) -> tuple[str, list[dict], list[dict]]` devolviendo `(batch_id, items, errors)`.

- [ ] **Step 1: Escribir el test que falla**

En `tests/test_document_ingest.py`, después del test `test_upload_lands_files_in_tray_without_touching_compliance`:

```python
def test_upload_without_carrier_lands_in_the_global_tray():
    """La tanda mezclada que llega por correo no tiene una empresa todavía.

    Obligar a elegir una antes de poder soltar los archivos es justo lo que
    impide cargar los 2.000 pendientes: quien carga no sabe de quién es nada.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "batch-global"
    conn.fetchrow.return_value = {
        "id": "item-1", "file_name": "doc1.pdf", "mime_type": "application/pdf",
        "size_bytes": 12, "storage_path": "staging/batch-global/x_doc1.pdf",
        "match_status": "UNMATCHED",
    }
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/files",
        files=[("files", ("doc1.pdf", b"contenido", "application/pdf"))],
    )

    assert res.status_code == 201
    assert res.json()["batch_id"] == "batch-global"
    assert len(res.json()["items"]) == 1

    # El lote se crea con carrier_id NULL: el archivo entra sin dueño.
    insert = next(c for c in conn.fetchval.await_args_list
                  if "document_ingest_batches" in c.args[0])
    assert insert.args[1] is None


def test_global_upload_respects_the_file_limit():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    client = make_client(pool, supabase=_storage_ok())

    res = client.post(
        "/api/v1/document-ingest/files",
        files=[("files", (f"d{i}.pdf", b"x", "application/pdf")) for i in range(51)],
    )

    assert res.status_code == 422
    assert "50" in res.json()["detail"]
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest \
  tests/test_document_ingest.py::test_upload_without_carrier_lands_in_the_global_tray \
  tests/test_document_ingest.py::test_global_upload_respects_the_file_limit -v
```

Esperado: FAIL con `404 Not Found` — la ruta no existe.

- [ ] **Step 3: Extraer el cuerpo compartido**

En `app/routers/document_ingest.py`, reemplazar el cuerpo de `upload_to_tray` por una llamada a un helper nuevo. Agregar el helper **antes** de las rutas:

```python
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
```

- [ ] **Step 4: Agregar la ruta global y reescribir la existente**

Reemplazar `upload_to_tray` completo por estas dos rutas. **La ruta sin empresa va primero** por claridad de lectura; no hay colisión de rutas porque `/files` tiene un segmento y `/{carrier_id}/files` tiene dos.

```python
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
```

- [ ] **Step 5: Correr los tests de la bandeja completos**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/test_document_ingest.py -v
```

Esperado: PASS, incluidos los tests viejos de la ruta con empresa — el refactor no debe cambiar su comportamiento.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "feat(ingesta): carga a la bandeja global, sin elegir empresa

El endpoint exigia carrier_id en la ruta, asi que la bandeja global no
tenia puerta de entrada. Es el bloqueo real para meter los 2.000
documentos pendientes: la tanda que llega por correo mezcla empresas y
quien carga no sabe de quien es nada.

document_ingest_batches.carrier_id ya era nullable — no se toca el esquema.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: La cola deja de esconder lo que tiene sugerencia

`GET /items` filtra `WHERE i.match_status = 'UNMATCHED'`. Los archivos que el clasificador resolvió con `AUTO`, `SUGGESTED` o `AMBIGUOUS` **no aparecen en ninguna parte**: quedan en la base sin superficie que los muestre. Con el clasificador funcionando, la bandeja se vería casi vacía mientras cientos de archivos esperan confirmación.

**Files:**
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py:92-146` (el bloque `where` de `list_queue`)
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces: `GET /api/v1/document-ingest/items` devuelve además las filas con `match_status` en `AUTO`, `SUGGESTED`, `AMBIGUOUS`. Sigue excluyendo `COMMITTED` y `DISCARDED`. El contrato `TrayPage` no cambia.

- [ ] **Step 1: Escribir el test que falla**

```python
def test_queue_shows_files_that_already_have_a_suggestion():
    """AUTO, SUGGESTED y AMBIGUOUS son trabajo pendiente, no trabajo hecho.

    Filtrar solo UNMATCHED los dejaba sin ninguna superficie que los muestre:
    el clasificador los resuelve, la bandeja los esconde y nadie los confirma.
    """
    pool = AsyncMock()
    pool.fetchval.return_value = 4
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get("/api/v1/document-ingest/items")

    assert res.status_code == 200
    sql = pool.fetch.await_args.args[0]
    assert "COMMITTED" in sql and "DISCARDED" in sql
    assert "match_status = 'UNMATCHED'" not in sql


def test_queue_binds_exactly_the_parameters_it_references():
    """Guarda contra el bug recurrente: sustituir $n a mano no prueba el binding.

    Si el SQL referencia $3 pero se pasan 2 argumentos, Postgres tira
    IndeterminateDatatypeError en vivo y ningun AsyncMock lo detecta.
    """
    import re
    pool = AsyncMock()
    pool.fetchval.return_value = 0
    pool.fetch.return_value = []
    client = make_client(pool)

    client.get("/api/v1/document-ingest/items?carrier_id=c1&limit=10&offset=5")

    for call in (pool.fetch.await_args, pool.fetchval.await_args):
        sql, args = call.args[0], call.args[1:]
        referenciados = {int(n) for n in re.findall(r"\$(\d+)", sql)}
        assert referenciados == set(range(1, len(args) + 1)), (
            f"SQL referencia {sorted(referenciados)} pero recibe {len(args)} argumentos"
        )
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest \
  tests/test_document_ingest.py::test_queue_shows_files_that_already_have_a_suggestion -v
```

Esperado: FAIL en `assert "match_status = 'UNMATCHED'" not in sql`.

- [ ] **Step 3: Ampliar el filtro**

En `list_queue`, reemplazar el bloque `where`:

```python
    # AUTO, SUGGESTED y AMBIGUOUS son trabajo pendiente: el clasificador los
    # resolvio pero nadie los confirmo todavia. Filtrar solo UNMATCHED los
    # dejaba sin ninguna superficie que los muestre.
    where = """
        WHERE i.match_status NOT IN ('COMMITTED', 'DISCARDED')
          AND ($1::uuid IS NULL OR COALESCE(i.carrier_id, b.carrier_id) = $1::uuid)
    """
```

- [ ] **Step 4: Correr los tests**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/test_document_ingest.py -v
```

Esperado: PASS.

- [ ] **Step 5: Verificar el SQL contra la base real**

No basta con los mocks. Correr contra producción, **con parámetros, no con literales sustituidos**:

```sql
PREPARE q(uuid, int, int) AS
SELECT i.id::text, i.file_name, i.match_status,
       COALESCE(i.carrier_id, b.carrier_id)::text AS carrier_id
FROM public.document_ingest_items i
JOIN public.document_ingest_batches b ON b.id = i.batch_id
WHERE i.match_status NOT IN ('COMMITTED', 'DISCARDED')
  AND ($1::uuid IS NULL OR COALESCE(i.carrier_id, b.carrier_id) = $1::uuid)
ORDER BY i.created_at, i.file_name
LIMIT $2 OFFSET $3;

EXECUTE q(NULL, 10, 0);
DEALLOCATE q;
```

Esperado: ejecuta sin error. Hoy devuelve 0 filas porque la bandeja está vacía; eso es correcto y no invalida la prueba — lo que se verifica es que el SQL es válido y que el binding calza.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "fix(ingesta): la cola escondia todo lo que tenia sugerencia

GET /items filtraba match_status = 'UNMATCHED', asi que los archivos que
el clasificador resolvia como AUTO, SUGGESTED o AMBIGUOUS no aparecian en
ninguna superficie: quedaban en la base esperando una confirmacion que
nadie podia dar.

Pasa a excluir solo COMMITTED y DISCARDED. Se agrega el test de binding
de parametros, que es la clase de bug que los AsyncMock no ven.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Deshacer una clasificación en lote

Hoy corregir un documento mal clasificado es de a uno (HU-03). Una asignación de 200 archivos a la empresa equivocada no tiene vuelta atrás razonable, y sin deshacer no se puede entregar la asignación en lote.

**Alcance honesto de este tramo:** se revierte sólo cuando el requisito **no tenía un documento anterior**. Si lo tenía, la aplicación pisó el archivo previo y restaurarlo requiere el historial de versiones, que es del Tramo 3. Esos casos se devuelven en `errors` con un motivo legible, en vez de dejar el registro en un estado a medias.

Hoy eso cubre prácticamente todo: 4.895 de 4.990 registros están en `MISSING`.

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/document_ingest.py`
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py` (agregar al final)
- Test: `monitor-app/backend/api/tests/test_document_ingest.py`

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: `POST /api/v1/document-ingest/items/undo-classify` con cuerpo `UndoClassifyBody {item_ids: list[str]}` → `UndoClassifyResult {reverted: list[str], errors: list[{item_id, error}]}`.

- [ ] **Step 1: Escribir los schemas**

En `app/schemas/document_ingest.py`, al final:

```python
class UndoClassifyBody(BaseModel):
    """Revierte una clasificación en lote.

    Se identifica por los mismos item_ids que devolvió `classify-batch` en
    `applied`. No hace falta un registro de operaciones: quien deshace es
    quien acaba de aplicar, y tiene los ids a mano.
    """
    item_ids: list[str]


class UndoClassifyItemError(BaseModel):
    item_id: str
    error: str


class UndoClassifyResult(BaseModel):
    reverted: list[str]
    errors: list[UndoClassifyItemError]
```

- [ ] **Step 2: Escribir los tests que fallan**

```python
# ── Deshacer en lote ───────────────────────────────────────────────────────

def _committed_item(item_id="item-1", record_id="rec-1"):
    return {
        "id": item_id, "compliance_record_id": record_id,
        "match_status": "COMMITTED", "metadata": {},
    }


def test_undo_returns_the_files_to_the_tray_and_empties_the_requirement():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [_committed_item()]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/undo-classify",
        json={"item_ids": ["item-1"]},
    )

    assert res.status_code == 200
    assert res.json()["reverted"] == ["item-1"]

    sql_ejecutado = " ".join(str(c.args[0]) for c in conn.execute.await_args_list)
    # El requisito vuelve a estar vacío...
    assert "compliance_records" in sql_ejecutado
    assert "'MISSING'" in sql_ejecutado
    # ...y el archivo vuelve a la bandeja, no se pierde.
    assert "'UNMATCHED'" in sql_ejecutado


def test_undo_refuses_when_the_requirement_had_a_previous_document():
    """Sin historial de versiones no se puede restaurar lo que se piso.

    Devolverlo como error es honesto; revertir a MISSING borraria un documento
    que era valido antes de la operacion.
    """
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetch.return_value = [{
        "id": "item-1", "compliance_record_id": "rec-1", "match_status": "COMMITTED",
        "metadata": {"storage_path": "docs/rec-1/anterior.pdf"},
    }]
    client = make_client(pool)

    res = client.post(
        "/api/v1/document-ingest/items/undo-classify",
        json={"item_ids": ["item-1"]},
    )

    assert res.status_code == 200
    assert res.json()["reverted"] == []
    assert "documento anterior" in res.json()["errors"][0]["error"]


def test_undo_rejects_an_empty_selection():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.post("/api/v1/document-ingest/items/undo-classify", json={"item_ids": []})
    assert res.status_code == 422
```

- [ ] **Step 3: Correr y verificar que fallan**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest \
  tests/test_document_ingest.py -k undo -v
```

Esperado: FAIL con `404 Not Found`.

- [ ] **Step 4: Implementar el endpoint**

En `app/routers/document_ingest.py`, agregar **dos** imports. Primero `json`, que hoy **no está
importado en este archivo** y el endpoint lo necesita — sin esto es un `NameError` en ejecución que
ningún test de mock detecta si el `metadata` llega como dict. Va como primera línea de imports,
antes del bloque de `fastapi`:

```python
import json

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
```

Y ampliar el bloque de schemas existente:

```python
from ..schemas.document_ingest import (
    ClassifyBatchBody, ClassifyBody, IngestUploadResult, MoveItemsBody, TrayPage,
    UndoClassifyBody, UndoClassifyResult,
)
```

Y al final del archivo:

```python
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
                # Si el storage_path guardado no es el de este archivo, el
                # requisito ya fue pisado por otra carga posterior.
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
```

- [ ] **Step 5: Marcar el reemplazo al aplicar, para que el deshacer lo detecte**

El chequeo del paso anterior lee `metadata.replaced_storage_path`, que hoy no se escribe. En `app/routers/compliance.py`, dentro de `_apply_stored_document`, agregar la marca al construir `metadata`:

```python
    metadata = {
        "storage_path": storage_path, "file_name": file_name,
        "mime_type": mime_type, "size_bytes": size_bytes,
    }
    # Deja rastro de que este documento piso a otro. Sin esta marca, deshacer
    # la clasificacion volveria el requisito a MISSING y borraria un documento
    # que era valido antes de la operacion.
    if old_storage_path:
        metadata["replaced_storage_path"] = old_storage_path
```

- [ ] **Step 6: Correr los tests de backend completos**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q
```

Esperado: PASS, 555+ tests. Verificar que `tests/test_compliance.py` sigue verde — se tocó `_apply_stored_document`.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/app/routers/compliance.py \
        monitor-app/backend/api/app/schemas/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "feat(ingesta): deshacer una clasificacion en lote

Sin esto no se puede entregar la asignacion en lote: corregir es de a uno
y 200 archivos en la empresa equivocada no tendrian vuelta atras.

No revierte cuando el requisito ya tenia un documento antes — restaurarlo
exige el historial de versiones. Esos casos vuelven en errors en vez de
dejar el registro a medias. _apply_stored_document ahora deja la marca
replaced_storage_path para que el deshacer pueda detectarlo.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: El cliente de API

**Files:**
- Modify: `monitor-app/frontend/lib/api/documentIngest.ts`
- Test: `monitor-app/frontend/lib/api/documentIngest.test.ts` (crear si no existe)

**Interfaces:**
- Consumes: `POST /files` (Task 1), `POST /items/undo-classify` (Task 3).
- Produces: `documentIngestApi.upload(carrierId: string | undefined, files: File[])` y `documentIngestApi.undoClassify(itemIds: string[]): Promise<UndoClassifyResult>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `monitor-app/frontend/lib/api/documentIngest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', () => ({ apiFetch: vi.fn() }))
import { apiFetch } from './client'
import { documentIngestApi } from './documentIngest'

beforeEach(() => vi.mocked(apiFetch).mockReset().mockResolvedValue({} as never))

describe('documentIngestApi.upload', () => {
  it('sin empresa pega a la puerta global', async () => {
    await documentIngestApi.upload(undefined, [new File(['x'], 'doc1.pdf')])
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/document-ingest/files')
  })

  it('con empresa pega a la puerta de esa empresa', async () => {
    await documentIngestApi.upload('c1', [new File(['x'], 'doc1.pdf')])
    expect(vi.mocked(apiFetch).mock.calls[0][0]).toBe('/api/v1/document-ingest/c1/files')
  })
})

describe('documentIngestApi.undoClassify', () => {
  it('manda los ids del lote que se acaba de aplicar', async () => {
    await documentIngestApi.undoClassify(['a', 'b'])
    const [url, init] = vi.mocked(apiFetch).mock.calls[0]
    expect(url).toBe('/api/v1/document-ingest/items/undo-classify')
    expect(JSON.parse(init!.body as string)).toEqual({ item_ids: ['a', 'b'] })
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run lib/api/documentIngest.test.ts
```

Esperado: FAIL — `upload` exige `carrierId: string` y `undoClassify` no existe.

- [ ] **Step 3: Implementar**

En `lib/api/documentIngest.ts`, reemplazar `upload` y agregar `undoClassify`:

```ts
export type UndoClassifyResult = {
  reverted: string[]
  errors:   { item_id: string; error: string }[]
}
```

```ts
  /** Sube archivos a la bandeja. Sin `carrierId` van a la bandeja global —
   *  la tanda que llega por correo mezcla empresas y quien carga todavía no
   *  sabe de quién es nada. */
  upload: (carrierId: string | undefined, files: File[]) => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const url = carrierId
      ? `/api/v1/document-ingest/${carrierId}/files`
      : '/api/v1/document-ingest/files'
    return apiFetch<IngestUploadResult>(url, { method: 'POST', body: form })
  },
```

Y al final del objeto:

```ts
  /** Revierte una clasificación en lote: vacía los requisitos y devuelve los
   *  archivos a la bandeja. Se le pasan los mismos ids que `classifyBatch`
   *  devolvió en `applied`. */
  undoClassify: (itemIds: string[]) =>
    apiFetch<UndoClassifyResult>('/api/v1/document-ingest/items/undo-classify', {
      method: 'POST', body: JSON.stringify({ item_ids: itemIds }),
    }),
```

- [ ] **Step 4: Ajustar el único llamador que pasaba empresa obligatoria**

`uploadAndClassify` llama a `documentIngestApi.upload(params.carrierId, [params.file])`. Sigue compilando sin cambios porque `string` satisface `string | undefined`. Verificar con:

```bash
cd monitor-app/frontend && npx tsc --noEmit
```

Esperado: sin salida.

- [ ] **Step 5: Correr los tests**

```bash
cd monitor-app/frontend && npx vitest run lib/api/documentIngest.test.ts
```

Esperado: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/lib/api/documentIngest.ts \
        monitor-app/frontend/lib/api/documentIngest.test.ts
git commit -m "feat(compliance): el cliente sabe cargar sin empresa y deshacer un lote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: La zona de carga, con sus cuatro estados

Hoy la zona de arrastre de `TriageWorkbench` vive detrás de `{canEdit && carrierId && (…)}`: en la bandeja global no existe. Y en cualquiera de los dos casos es una línea de 11px sin estados — con 2.000 archivos subiendo no dice nada.

Sale a archivo propio porque `TriageWorkbench` ya tiene 307 líneas y cuatro responsabilidades.

**Files:**
- Create: `monitor-app/frontend/components/compliance/TriageDropzone.tsx`
- Create: `monitor-app/frontend/components/compliance/TriageDropzone.test.tsx`

**Interfaces:**
- Consumes: nada — recibe todo por props.
- Produces:

```ts
interface Props {
  carrierName?: string          // sin nombre = bandeja global
  vacia:        boolean         // no hay archivos en la bandeja
  subiendo:     boolean
  enVuelo?:     number          // cuántos archivos tiene esta tanda
  errores:      { file_name: string; error: string }[]
  onArchivos:   (files: FileList | File[]) => void
}
export function TriageDropzone(props: Props): JSX.Element
```

**Sobre el avance.** La subida es **un solo request con N archivos**, así que no existe
"1.284 de 2.000": el navegador no informa cuántos van. Mostrar una barra que se llena sería
inventar un dato. La barra es **indeterminada** y el texto dice cuántos archivos tiene la tanda,
que sí se sabe. Un avance real exigiría subir por tandas y contarlas, y eso es otro alcance.

- [ ] **Step 1: Escribir el test que falla**

Crear `monitor-app/frontend/components/compliance/TriageDropzone.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriageDropzone } from './TriageDropzone'

const base = {
  vacia: false, subiendo: false, errores: [], onArchivos: vi.fn(),
}

describe('TriageDropzone', () => {
  // Es el estado real de hoy: 0 archivos en la bandeja.
  it('vacía, la zona es la pantalla y explica qué pasa al soltar', () => {
    render(<TriageDropzone {...base} vacia />)
    expect(screen.getByText(/arrastra aquí los documentos/i)).toBeInTheDocument()
    expect(screen.getByText(/nada queda certificado hasta que lo confirmes/i)).toBeInTheDocument()
  })

  it('con archivos ya cargados se encoge, pero sigue existiendo', () => {
    render(<TriageDropzone {...base} />)
    expect(screen.getByText(/suelta archivos en cualquier parte/i)).toBeInTheDocument()
    expect(screen.queryByText(/nada queda certificado/i)).not.toBeInTheDocument()
  })

  // 2.000 archivos tardan. Sin señal de que algo pasa, la gente se queda mirando.
  it('subiendo dice cuántos van en la tanda y avisa que puede cerrar la pestaña', () => {
    render(<TriageDropzone {...base} subiendo enVuelo={2000} />)
    expect(screen.getByText(/2\.000 archivos/)).toBeInTheDocument()
    expect(screen.getByText(/puedes cerrar esta pestaña/i)).toBeInTheDocument()
  })

  // El navegador no informa cuantos archivos van dentro de un solo request:
  // una barra que se llena seria un dato inventado.
  it('la barra es indeterminada, no finge un avance que no existe', () => {
    render(<TriageDropzone {...base} subiendo enVuelo={2000} />)
    const barra = screen.getByRole('progressbar')
    expect(barra).not.toHaveAttribute('aria-valuenow')
    expect(barra).toHaveAttribute('aria-label', expect.stringMatching(/subiendo/i))
  })

  // Un archivo que falla no puede tumbar la tanda ni desaparecer sin aviso.
  it('lista los archivos que fallaron con su motivo', () => {
    render(<TriageDropzone {...base} errores={[{ file_name: 'raro.exe', error: 'Tipo no permitido' }]} />)
    expect(screen.getByText(/raro\.exe/)).toBeInTheDocument()
    expect(screen.getByText(/tipo no permitido/i)).toBeInTheDocument()
  })

  it('en la bandeja de una empresa dice de quién son los archivos', () => {
    render(<TriageDropzone {...base} vacia carrierName="Transportes Charlotte Spa" />)
    expect(screen.getByText(/transportes charlotte spa/i)).toBeInTheDocument()
  })

  it('soltar archivos los entrega al padre', () => {
    const onArchivos = vi.fn()
    render(<TriageDropzone {...base} vacia onArchivos={onArchivos} />)
    const file = new File(['x'], 'doc1.pdf', { type: 'application/pdf' })
    fireEvent.drop(screen.getByTestId('triage-dropzone'), { dataTransfer: { files: [file] } })
    expect(onArchivos).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageDropzone.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar el componente**

Crear `monitor-app/frontend/components/compliance/TriageDropzone.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Loader2, UploadCloud } from 'lucide-react'

interface Props {
  /** Sin nombre = la bandeja global. Con nombre = la de esa empresa. */
  carrierName?: string
  /** No hay archivos esperando. La zona pasa a ocupar la pantalla. */
  vacia:      boolean
  subiendo:   boolean
  /** Cuántos archivos tiene la tanda en vuelo. No hay avance parcial: es un
   *  solo request con N archivos y el navegador no informa cuántos van. */
  enVuelo?:   number
  errores:    { file_name: string; error: string }[]
  onArchivos: (files: FileList | File[]) => void
}

/** La puerta de carga, con sus cuatro estados.
 *
 *  Vacía la zona ES la pantalla: la bandeja global es el lugar donde se
 *  vuelcan los 2.000 documentos, así que esconder la carga tras un botón
 *  chico es esconder el trabajo principal. Con archivos ya cargados se
 *  encoge a una barra y le deja el espacio a la lista — pero no desaparece.
 */
export function TriageDropzone({
  carrierName, vacia, subiendo, enVuelo, errores, onArchivos,
}: Props) {
  const [encima, setEncima] = useState(false)

  const deQuien = carrierName ? `los documentos de ${carrierName}` : 'los documentos'

  if (subiendo) {
    const cuantos = enVuelo ?? 0
    return (
      <div className="border border-border rounded-xl bg-white p-4">
        <div className="flex items-center gap-2 mb-2.5">
          <Loader2 size={14} className="motion-safe:animate-spin text-accent" />
          <span className="text-xs font-semibold text-text-primary">
            Subiendo {cuantos.toLocaleString('es-CL')}{' '}
            {cuantos === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>
        {/* Barra indeterminada: es un solo request con N archivos y el
            navegador no informa cuantos van. Una barra que se llena seria un
            dato inventado. */}
        <div
          role="progressbar"
          aria-label="Subiendo archivos"
          className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
        >
          <span className="block h-full w-1/3 bg-accent rounded-full motion-safe:animate-pulse" />
        </div>
        <p className="mt-2.5 text-[11px] text-gray-500 leading-relaxed">
          Puedes cerrar esta pestaña. El proceso sigue y al volver vas a encontrar
          los archivos en la bandeja.
        </p>
      </div>
    )
  }

  const zona = (
    <label
      data-testid="triage-dropzone"
      onDragOver={e => { e.preventDefault(); setEncima(true) }}
      onDragLeave={() => setEncima(false)}
      onDrop={e => { e.preventDefault(); setEncima(false); onArchivos(e.dataTransfer.files) }}
      className={`block border-[1.5px] border-dashed rounded-xl bg-white cursor-pointer transition-colors ${
        encima ? 'border-accent bg-accent/5' : 'border-border hover:border-accent/50'
      } ${vacia ? 'px-5 py-10 text-center' : 'px-4 py-2.5 flex items-center gap-2.5'}`}
    >
      <UploadCloud size={vacia ? 26 : 14} className={vacia ? 'text-gray-400 mx-auto' : 'text-gray-400'} />
      {vacia ? (
        <>
          <p className="mt-2.5 text-sm font-semibold text-text-primary">
            Arrastra aquí {deQuien}
          </p>
          <p className="mt-1 text-xs text-gray-500 leading-relaxed max-w-md mx-auto">
            Puedes soltar carpetas enteras. Se agrupan por empresa o por tipo y tú
            confirmas: nada queda certificado hasta que lo confirmes.
          </p>
          <p className="mt-3 text-[11px] text-accent font-semibold">
            o elige archivos desde tu computador
          </p>
        </>
      ) : (
        <span className="text-[11px] text-gray-500">
          Suelta archivos en cualquier parte de esta pantalla para agregarlos a la bandeja
        </span>
      )}
      <input
        type="file" multiple className="hidden"
        aria-label={`Arrastra aquí ${deQuien}`}
        onChange={e => onArchivos(e.target.files ?? [])}
      />
    </label>
  )

  if (!errores.length) return zona

  return (
    <div className="space-y-1.5">
      {zona}
      <ul className="space-y-0.5">
        {errores.map(e => (
          <li key={e.file_name} className="text-[11px] text-red-600">
            {e.file_name}: {e.error}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageDropzone.test.tsx
```

Esperado: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/TriageDropzone.tsx \
        monitor-app/frontend/components/compliance/TriageDropzone.test.tsx
git commit -m "feat(compliance): zona de carga con sus cuatro estados

Vacia la zona ES la pantalla — la bandeja global es donde se vuelcan los
2.000 documentos, esconder la carga tras un boton chico es esconder el
trabajo principal. Subiendo muestra avance y avisa que puede cerrar la
pestana. Con archivos se encoge pero no desaparece.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: El aviso de deshacer

**Files:**
- Create: `monitor-app/frontend/components/compliance/TriageUndoNotice.tsx`
- Create: `monitor-app/frontend/components/compliance/TriageUndoNotice.test.tsx`

**Interfaces:**
- Consumes: nada — recibe todo por props.
- Produces:

```ts
interface Props {
  mensaje:    string
  onDeshacer: () => void
  onCerrar:   () => void
  deshaciendo?: boolean
}
export function TriageUndoNotice(props: Props): JSX.Element
```

- [ ] **Step 1: Escribir el test que falla**

Crear `monitor-app/frontend/components/compliance/TriageUndoNotice.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TriageUndoNotice } from './TriageUndoNotice'

const base = { mensaje: '38 archivos asignados a Transportes Charlotte Spa',
               onDeshacer: vi.fn(), onCerrar: vi.fn() }

describe('TriageUndoNotice', () => {
  it('dice qué pasó y ofrece revertirlo', () => {
    render(<TriageUndoNotice {...base} />)
    expect(screen.getByText(/38 archivos asignados/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /deshacer/i })).toBeInTheDocument()
  })

  it('deshacer avisa al padre', () => {
    const onDeshacer = vi.fn()
    render(<TriageUndoNotice {...base} onDeshacer={onDeshacer} />)
    fireEvent.click(screen.getByRole('button', { name: /deshacer/i }))
    expect(onDeshacer).toHaveBeenCalled()
  })

  // No se desvanece solo: una asignacion de 200 archivos se revisa con calma.
  it('no se cierra solo — hay que cerrarlo a mano', () => {
    vi.useFakeTimers()
    const onCerrar = vi.fn()
    render(<TriageUndoNotice {...base} onCerrar={onCerrar} />)
    vi.advanceTimersByTime(30_000)
    expect(onCerrar).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('mientras revierte no se puede pedir dos veces', () => {
    render(<TriageUndoNotice {...base} deshaciendo />)
    expect(screen.getByRole('button', { name: /deshaciendo/i })).toBeDisabled()
  })

  it('es un aviso, no una alerta que interrumpa', () => {
    render(<TriageUndoNotice {...base} />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageUndoNotice.test.tsx
```

Esperado: FAIL — el módulo no existe.

- [ ] **Step 3: Implementar**

Crear `monitor-app/frontend/components/compliance/TriageUndoNotice.tsx`:

```tsx
'use client'

import { Check, Loader2, X } from 'lucide-react'

interface Props {
  mensaje:      string
  onDeshacer:   () => void
  onCerrar:     () => void
  deshaciendo?: boolean
}

/** El aviso de que una operación en lote se aplicó, con su deshacer.
 *
 *  No se desvanece a los tres segundos a propósito: una asignación de 200
 *  archivos se revisa con calma, y un aviso que huye convierte el deshacer
 *  en una carrera. Se cierra cuando la persona lo cierra.
 */
export function TriageUndoNotice({ mensaje, onDeshacer, onCerrar, deshaciendo }: Props) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-xl bg-text-primary text-white px-4 py-3"
    >
      <Check size={14} className="text-accent shrink-0" />
      <span className="text-xs flex-1 min-w-0">{mensaje}</span>
      <button
        type="button"
        onClick={onDeshacer}
        disabled={deshaciendo}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-accent border border-white/25 rounded-lg px-3 py-1.5 hover:bg-white/10 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer shrink-0"
      >
        {deshaciendo
          ? <><Loader2 size={11} className="motion-safe:animate-spin" /> Deshaciendo…</>
          : 'Deshacer'}
      </button>
      <button
        type="button" onClick={onCerrar} aria-label="Cerrar aviso"
        className="text-white/60 hover:text-white transition-colors cursor-pointer shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Correr los tests**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageUndoNotice.test.tsx
```

Esperado: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/compliance/TriageUndoNotice.tsx \
        monitor-app/frontend/components/compliance/TriageUndoNotice.test.tsx
git commit -m "feat(compliance): aviso de deshacer para las operaciones en lote

No se desvanece a los tres segundos: una asignacion de 200 archivos se
revisa con calma, y un aviso que huye convierte el deshacer en una carrera.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: La barra de lote nombra la cantidad exacta

`TriageBulkBar` dice "Mover" y "Descartar" sin decir cuántos. Con un filtro puesto, "todo" es ambiguo, y ahí es donde se asignan 2.000 archivos a la empresa equivocada.

**Files:**
- Modify: `monitor-app/frontend/components/compliance/TriageBulkBar.tsx`
- Modify: `monitor-app/frontend/components/compliance/TriageBulkBar.test.tsx`

**Interfaces:**
- Consumes: nada nuevo. Las props existentes (`selectedCount`, `targetIds`, `currentCarrierId`, `onDiscard`, `onClear`, `onMoved`) no cambian.
- Produces: los textos visibles pasan a incluir la cantidad.

**Estado actual, para que no haya que adivinar.** El botón de confirmación ya nombra la cantidad
(`Sí, descartar {selectedCount}`); el que **no** lo hace es el botón inicial, que dice `Descartar`
a secas. Ese es el único texto que cambia.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `components/compliance/TriageBulkBar.test.tsx`:

```tsx
// Con un filtro puesto, "todo" es ambiguo: es la causa numero uno de
// asignaciones masivas erroneas.
it('los botones dicen la cantidad exacta, nunca "seleccionados"', () => {
  render(<TriageBulkBar
    selectedCount={3}
    targetIds={['a', 'b', 'c']}
    currentCarrierId="c1"
    onDiscard={vi.fn()}
    onClear={vi.fn()}
    onMoved={vi.fn()}
  />)
  expect(screen.getByRole('button', { name: /descartar los 3/i })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /^descartar$/i })).not.toBeInTheDocument()
})

it('con un solo archivo concuerda en singular', () => {
  render(<TriageBulkBar
    selectedCount={1}
    targetIds={['a']}
    currentCarrierId="c1"
    onDiscard={vi.fn()}
    onClear={vi.fn()}
    onMoved={vi.fn()}
  />)
  expect(screen.getByRole('button', { name: /descartar 1 archivo/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageBulkBar.test.tsx
```

Esperado: FAIL — el botón dice "Descartar" a secas.

- [ ] **Step 3: Agregar el helper**

En `components/compliance/TriageBulkBar.tsx`, arriba del componente, después del `interface Props`:

```tsx
/** "1 archivo" / "los 38". El boton tiene que nombrar la cantidad exacta:
 *  con un filtro puesto, "seleccionados" no dice si son los 40 que ves o los
 *  2.000 que calzan, y esa ambiguedad es la causa numero uno de asignaciones
 *  masivas erroneas. */
function cuantos(n: number) {
  return n === 1 ? '1 archivo' : `los ${n}`
}
```

- [ ] **Step 4: Usarlo en el botón inicial de descartar**

Reemplazar el bloque del botón que hoy dice `Descartar`:

```tsx
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80 hover:text-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40 rounded px-1"
        >
          <Trash2 size={12} /> Descartar
        </button>
```

por:

```tsx
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="flex items-center gap-1.5 text-[11px] font-semibold text-white/80 hover:text-white transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-white/40 rounded px-1"
        >
          <Trash2 size={12} /> Descartar {cuantos(selectedCount)}
        </button>
```

El botón de confirmación (`Sí, descartar {selectedCount}`) **no se toca**: ya nombra la cantidad.

- [ ] **Step 5: Correr los tests**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageBulkBar.test.tsx
```

Esperado: PASS. Si algún test viejo buscaba `/^descartar$/i`, actualizarlo — el comportamiento cambió a propósito.

- [ ] **Step 6: Commit**

```bash
git add monitor-app/frontend/components/compliance/TriageBulkBar.tsx \
        monitor-app/frontend/components/compliance/TriageBulkBar.test.tsx
git commit -m "fix(compliance): los botones de lote nombran la cantidad exacta

Con un filtro puesto, 'seleccionados' no dice si son los 40 que ves o los
2.000 que calzan. Esa ambiguedad es la causa numero uno de asignaciones
masivas erroneas.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: Cablear todo en la bandeja

Une las piezas: la zona de carga funciona sin empresa, el lote aplicado deja su aviso de deshacer, y el deshacer devuelve los archivos a la bandeja.

**Files:**
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.tsx`
- Modify: `monitor-app/frontend/components/compliance/TriageWorkbench.test.tsx`

**Interfaces:**
- Consumes: `TriageDropzone` (Task 5), `TriageUndoNotice` (Task 6), `documentIngestApi.upload(carrierId | undefined, files)` y `documentIngestApi.undoClassify(itemIds)` (Task 4).
- Produces: nada nuevo hacia afuera. Las props de `TriageWorkbench` no cambian.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `components/compliance/TriageWorkbench.test.tsx`:

```tsx
// El bloqueo real para meter los 2.000 documentos: sin empresa no habia
// forma de soltar archivos.
it('sin empresa igual se pueden cargar archivos', async () => {
  renderWorkbench({})   // helper existente del archivo, sin carrierId
  expect(await screen.findByTestId('triage-dropzone')).toBeInTheDocument()
})

it('aplicar un lote deja el aviso de deshacer', async () => {
  vi.mocked(documentIngestApi.classifyBatch).mockResolvedValue({
    applied: ['i1', 'i2'], errors: [],
  })
  renderWorkbench({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
  await aplicarLote()   // helper existente del archivo
  expect(await screen.findByRole('status')).toHaveTextContent(/2 archivos/)
  expect(screen.getByRole('button', { name: /deshacer/i })).toBeInTheDocument()
})

it('deshacer revierte exactamente el lote que se acaba de aplicar', async () => {
  vi.mocked(documentIngestApi.classifyBatch).mockResolvedValue({
    applied: ['i1', 'i2'], errors: [],
  })
  vi.mocked(documentIngestApi.undoClassify).mockResolvedValue({ reverted: ['i1', 'i2'], errors: [] })
  renderWorkbench({ carrierId: 'c1', carrierName: 'Transportes Charlotte Spa' })
  await aplicarLote()
  fireEvent.click(await screen.findByRole('button', { name: /deshacer/i }))
  await waitFor(() =>
    expect(documentIngestApi.undoClassify).toHaveBeenCalledWith(['i1', 'i2']),
  )
})
```

Agregar `undoClassify: vi.fn()` al `vi.mock('@/lib/api/documentIngest', …)` del archivo.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
cd monitor-app/frontend && npx vitest run components/compliance/TriageWorkbench.test.tsx
```

Esperado: FAIL — no hay zona de arrastre sin empresa y no existe el aviso.

- [ ] **Step 3: Reemplazar la zona de arrastre**

En `TriageWorkbench.tsx`, borrar el bloque `{canEdit && carrierId && (<label …>…</label>)}` (líneas 181-202) y el bloque `{errors.map(…)}` que le sigue, y poner en su lugar:

```tsx
      {canEdit && (
        <TriageDropzone
          carrierName={carrierName}
          vacia={!queueQuery.isPending && total === 0}
          subiendo={uploadMutation.isPending}
          // React Query conserva las variables de la mutación en vuelo: es de
          // donde sale cuántos archivos tiene la tanda que se está subiendo.
          enVuelo={uploadMutation.variables?.length}
          errores={errors}
          onArchivos={handleFiles}
        />
      )}
```

Agregar los imports:

```tsx
import { TriageDropzone } from './TriageDropzone'
import { TriageUndoNotice } from './TriageUndoNotice'
```

- [ ] **Step 4: Quitar la empresa obligatoria de la subida**

En `uploadMutation`, cambiar:

```tsx
    mutationFn: (files: File[]) => documentIngestApi.upload(carrierId, files),
```

(quitando el `!`, ahora que el cliente acepta `undefined`).

- [ ] **Step 5: Guardar el último lote y ofrecer deshacerlo**

Agregar el estado junto a los otros `useState` del componente:

```tsx
  // El ultimo lote aplicado, para poder revertirlo. No hace falta un registro
  // de operaciones: quien deshace es quien acaba de aplicar.
  const [ultimoLote, setUltimoLote] = useState<{ ids: string[]; mensaje: string } | null>(null)
```

En el `onSuccess` de la mutación que llama a `classifyBatch`, agregar:

```tsx
      if (res.applied.length) {
        setUltimoLote({
          ids: res.applied,
          mensaje: res.applied.length === 1
            ? '1 archivo clasificado'
            : `${res.applied.length} archivos clasificados`,
        })
      }
```

Agregar la mutación de deshacer:

```tsx
  const undoMutation = useMutation({
    mutationFn: (ids: string[]) => documentIngestApi.undoClassify(ids),
    onSuccess: res => {
      setUltimoLote(null)
      qc.invalidateQueries({ queryKey: queueKey })
      qc.invalidateQueries({ queryKey: ['certification-status'] })
      if (res.errors.length) {
        setNotice(
          `No se pudieron revertir ${res.errors.length}: el requisito ya tenía un documento anterior`,
        )
      }
    },
  })
```

Y renderizar el aviso justo debajo de la zona de carga:

```tsx
      {ultimoLote && (
        <TriageUndoNotice
          mensaje={ultimoLote.mensaje}
          deshaciendo={undoMutation.isPending}
          onDeshacer={() => undoMutation.mutate(ultimoLote.ids)}
          onCerrar={() => setUltimoLote(null)}
        />
      )}
```

- [ ] **Step 6: Correr la suite completa de frontend**

```bash
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run
```

Esperado: `tsc` sin salida; vitest en verde con los tests nuevos sumados a los 769 existentes.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/components/compliance/TriageWorkbench.tsx \
        monitor-app/frontend/components/compliance/TriageWorkbench.test.tsx
git commit -m "feat(compliance): la bandeja global gana su puerta de carga y su deshacer

La zona de arrastre vivia detras de {canEdit && carrierId}: en la bandeja
global no existia, y ese era el bloqueo real para meter los 2.000
documentos. Ahora usa TriageDropzone con sus cuatro estados y sube sin
empresa. Aplicar un lote deja su aviso de deshacer con los ids exactos.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: Verificación en local, antes de tocar staging

El acuerdo con el usuario: **se levanta en local, él lo mira, y sólo si lo aprueba se despliega.**

**Files:** ninguno. Es verificación.

- [ ] **Step 1: Correr las dos suites completas**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build
```

Esperado: backend en verde; `tsc` sin salida; vitest en verde; build exitoso.

- [ ] **Step 2: Levantar el frontend en local**

```bash
cd monitor-app/frontend && npm run dev
```

Apunta a la API de dev mediante `.env.local`. **No levantar el backend local**: este sandbox no resuelve el DNS de Supabase, y esa limitación ya está documentada. Si `.next` da problemas de caché, `rm -rf .next` y reiniciar.

- [ ] **Step 3: Recorrido manual con Playwright**

Usar el MCP de Playwright, **nunca la extensión de Chrome**. Verificar en `http://localhost:3000/dashboard/compliance?vista=documentos`:

1. La bandeja vacía muestra la zona grande con "Arrastra aquí los documentos" y la frase sobre confirmar.
2. Existe una zona de arrastre **sin haber elegido empresa**.
3. Subir 2 archivos de prueba: aparecen en la lista.
4. Seleccionar los 2: el botón dice "Descartar los 2", no "Descartar".
5. Clasificarlos: aparece el aviso "2 archivos clasificados" con su botón Deshacer.
6. Deshacer: los 2 vuelven a la bandeja y el requisito queda vacío otra vez.
7. Tomar captura de cada paso.

- [ ] **Step 4: Limpiar los datos de prueba**

Verificar contra Supabase que la base quedó como estaba:

```sql
SELECT count(*) FILTER (WHERE match_status <> 'DISCARDED') AS items_vivos,
       (SELECT count(*) FROM public.document_ingest_batches) AS lotes,
       (SELECT count(*) FROM public.compliance_records WHERE status <> 'MISSING') AS registros_cubiertos
FROM public.document_ingest_items;
```

Esperado: `items_vivos = 0`, y `registros_cubiertos = 95`, el mismo número que antes de empezar. Si algún registro quedó alterado, revertirlo antes de seguir.

- [ ] **Step 5: Mostrar el resultado al usuario y esperar su aprobación**

Presentar las capturas y el resumen. **No desplegar sin su visto bueno.**

- [ ] **Step 6: Desplegar a staging, sólo con aprobación**

```bash
git push origin dev
gh run watch --exit-status
```

El push a `dev` dispara `deploy-frontend.yml` y el deploy de la Monitor API. Verificar que ambos terminan en verde.

---

## Task 10: Limpieza — retirar la puerta de clasificación de a uno

`documentIngestApi.classify` **no tiene ningún llamador** en el frontend, y su endpoint
`POST /items/{item_id}/classify` sigue vivo en el backend. Quedó superado por `classifyBatch`, que
con un archivo hace exactamente lo mismo. Dos caminos para la misma operación terminan divergiendo,
y ya pasó una vez en este módulo.

**Verificar antes de borrar**, no confiar en este párrafo:

```bash
cd monitor-app/frontend && grep -rn "\.classify(" --include="*.tsx" --include="*.ts" app components lib hooks
```

Si aparece algún llamador, **no borrar** y reportarlo: significa que algo cambió desde que se escribió
este plan.

**Files:**
- Modify: `monitor-app/frontend/lib/api/documentIngest.ts` (quitar `classify` y el tipo `ClassifyBody` si queda sin uso)
- Modify: `monitor-app/backend/api/app/routers/document_ingest.py` (quitar `classify_item`)
- Modify: `monitor-app/backend/api/app/schemas/document_ingest.py` (quitar `ClassifyBody` si queda sin uso)
- Modify: `monitor-app/backend/api/tests/test_document_ingest.py` (quitar sus tests)

**Interfaces:**
- Consumes: nada.
- Produces: nada. Es una resta.

- [ ] **Step 1: Verificar que no hay llamadores**

Correr el `grep` de arriba, más el del backend:

```bash
cd monitor-app/backend/api && grep -rn "classify_item" app/ tests/ --include="*.py" | grep -v __pycache__
```

Esperado: sólo su propia definición y sus tests.

- [ ] **Step 2: Borrar el método del cliente**

En `lib/api/documentIngest.ts`, quitar el método `classify` completo. Si `ClassifyBody` queda sin
ninguna referencia, quitar también el tipo. Verificar con `grep -rn "ClassifyBody" --include="*.ts" --include="*.tsx" .`
antes de quitarlo: `ClassifyBatchBody` es otro tipo y sí se usa.

- [ ] **Step 3: Borrar el endpoint y sus tests**

En `app/routers/document_ingest.py`, quitar la función `classify_item` y su decorador
`@router.post("/items/{item_id}/classify")`. En `tests/test_document_ingest.py`, quitar los tests que
peguen a esa ruta. En `app/schemas/document_ingest.py`, quitar `ClassifyBody` **sólo si** queda sin
referencias — `ClassifyBatchBody` es distinto y se conserva.

- [ ] **Step 4: Correr las dos suites**

```bash
cd monitor-app/backend/api && ./venv/bin/python -m pytest tests/ -q
cd monitor-app/frontend && npx tsc --noEmit && npx vitest run
```

Esperado: verde en ambas. Si `tsc` reclama por `ClassifyBody`, es que sí tenía uso: restaurar el tipo
y dejar sólo el endpoint borrado.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/lib/api/documentIngest.ts \
        monitor-app/backend/api/app/routers/document_ingest.py \
        monitor-app/backend/api/app/schemas/document_ingest.py \
        monitor-app/backend/api/tests/test_document_ingest.py
git commit -m "refactor(ingesta): retira la puerta de clasificacion de a uno

classify quedo sin llamadores cuando classifyBatch paso a cubrir tambien
el caso de un archivo. Dos caminos para la misma operacion terminan
divergiendo, y en este modulo ya paso una vez.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Cobertura del Tramo 1 del spec

| Requisito del spec | Dónde |
|---|---|
| Carga global sin empresa | Tareas 1, 4, 5, 8 |
| Cola que devuelve todos los estados no confirmados | Tarea 2 |
| Bandeja con sus cuatro estados | Tarea 5 |
| Lista plana con selección múltiple | **Ya existe** — `TriageFileTable` + `TriageBulkBar`. La Tarea 7 sólo corrige que los botones nombren la cantidad |
| Deshacer en lote | Tareas 3, 6, 8 |

## Qué queda fuera de este tramo

Va a los planes 2 y 3, y está en el spec:

- El embudo de certificación, el cajón que se abre hacia abajo, el alta con tipo de gestión y el sistema visual completo → **Tramo 2**.
- Las pilas agrupadas con desambiguación por sujeto, la migración del índice único y las renovaciones con historial → **Tramo 3**.
- El deshacer duradero (revertir una operación de hace tres días). Este tramo entrega el deshacer inmediato, que cubre el error recién cometido. La reversión posterior puede leerse de `audit_log`, donde `_apply_stored_document` ya deja rastro.
- Los dos requisitos condicionales de empresa (*Seguro EETT*, *Seguro RC Empresa*): pendientes de negocio, no se siembran.
