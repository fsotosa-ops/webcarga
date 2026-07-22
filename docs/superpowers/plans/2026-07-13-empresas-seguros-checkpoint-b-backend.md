# Empresas/Seguros — Checkpoint B: repuntar backend roto + features nuevas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Checkpoint A (migración de esquema, `docs/superpowers/plans/2026-07-12-empresas-seguros-checkpoint-a-schema.md`) dropeó `app.compliance_documents`, `app.compliance_doc_catalog`-dependendencies antiguas, `app.driver_assignments`/`app.vehicle_assignments`, `app.stored_files`, `app.insurance_doc_catalog`/`app.insurance_documents`. El backend (`monitor-app/backend/api/app/routers/transporters.py`, `routers/insurance.py`, `utils/stored_files.py`) nunca se actualizó — sigue consultando esas tablas. Confirmado por lectura directa: casi todos los endpoints de `transporters.py` y varios de `insurance.py` fallan hoy contra Supabase real con "relation does not exist". Los 36 tests de pytest existentes pasan igual porque usan `AsyncMock` para el pool — no detectan este desfase de schema. Este checkpoint (1) repunta todo el backend afectado al schema nuevo, y (2) agrega las features nuevas ya planificadas (contactos editables, alta/baja, `registry_url`, `operational_status`).

**Architecture:** Mismo patrón ya establecido en el proyecto (FastAPI + asyncpg raw SQL, sin ORM, respuestas ensambladas a mano). El versionado de archivos que dependía de `app.stored_files` se reemplaza por: subir a una ruta de Storage nueva cada vez (sin tabla de contador de versión) + registrar el valor anterior en `app.audit_log` (decisión ya tomada en el plan de Checkpoint A, §2.2/decisión 4) — el historial de versiones se reconstruye consultando `audit_log`, no una tabla dedicada.

**Tech Stack:** Python 3.11, FastAPI, asyncpg, pytest con mocks (`AsyncMock`) — mismo patrón que el resto de la suite.

## Global Constraints

- Venv correcto: `monitor-app/backend/api/venv` (NO `.venv` ni anaconda — ver memoria del proyecto). Todos los comandos `pytest`/`python` corren con ese venv activado.
- Supabase project: `viclzoftiudkepqnhekv`. Cualquier migración SQL nueva usa `mcp__claude_ai_Supabase__apply_migration` + archivo espejo en `monitor-app/backend/supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql`, commiteado.
- Los tests de este proyecto mockean el pool asyncpg (`AsyncMock`) — no hay DB real en CI. Cada task que toque una query SQL debe, además de actualizar los tests mockeados, dejar evidencia en su reporte de que la query se probó a mano contra Supabase real (`execute_sql`) al menos una vez con datos reales, ya que el mock no puede detectar SQL inválido.
- No renombrar columnas/tablas existentes — solo repuntar queries a las tablas que sí sobrevivieron Checkpoint A (`app.transporter_documents`/`driver_documents`/`vehicle_documents`, `app.drivers.transporter_id`/`app.vehicles.transporter_id`, `app.compliance_doc_catalog` que se mantiene).
- `manual_override=true` por defecto en cualquier PATCH manual de documento (comportamiento ya existente, preservar).
- Nada se pushea a remoto — todo en `dev` local, mismo patrón que Checkpoint A.
- No tocar `extraction_service` ni el pipeline de trips — fuera de alcance total.

---

### Task 1: Migración — `app.insurance_policy_documents` (reemplaza `insurance_doc_catalog`/`insurance_documents`, dropeadas sin reemplazo en Checkpoint A)

**Contexto**: Checkpoint A dropeó `app.insurance_doc_catalog` e `app.insurance_documents` (autorizado explícitamente por el usuario) sin diseñar un reemplazo — ese hueco se cierra acá, con el mismo patrón de tabla angosta que `app.transporter_documents` (Checkpoint A Task 3), no el patrón polimórfico/catálogo-pesado que se retiró.

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260713000001_insurance_policy_documents.sql`

**Interfaces:**
- Produces: `app.insurance_policy_documents(policy_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)`, PK `(policy_id, doc_name)`. Consumido por Task 5.

- [ ] **Step 1: Escribir y aplicar la migración**

```sql
CREATE TABLE app.insurance_policy_documents (
  policy_id   uuid NOT NULL REFERENCES app.insurance_policies(id) ON DELETE CASCADE,
  doc_name    text NOT NULL,
  status      app.compliance_status,
  expiry_date date,
  storage_path text,
  notes       text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, doc_name)
);

ALTER TABLE app.insurance_policy_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_policy_documents_select ON app.insurance_policy_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY insurance_policy_documents_insert ON app.insurance_policy_documents
  FOR INSERT TO authenticated WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));
CREATE POLICY insurance_policy_documents_update ON app.insurance_policy_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));
CREATE POLICY insurance_policy_documents_delete ON app.insurance_policy_documents
  FOR DELETE TO authenticated USING (app.current_user_role() IN ('admin', 'owner'));
```
Nota: consolidado desde cero en `_select`/`_insert`/`_update`/`_delete` (mismo patrón final que Checkpoint A dejó en `transporter_documents` tras su propio fix de revisión) — no crear un par `_read`/`_write` que después haya que volver a consolidar.

- [ ] **Step 2: Verificar**

```sql
SELECT count(*) FROM app.insurance_policy_documents;  -- 0, tabla nueva
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='app' AND tablename='insurance_policy_documents' ORDER BY policyname;
-- 4 filas: _select/_insert/_update/_delete
```

- [ ] **Step 3: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260713000001_insurance_policy_documents.sql
git commit -m "feat(db): app.insurance_policy_documents — reemplaza insurance_doc_catalog/insurance_documents dropeadas en Checkpoint A"
```

---

### Task 2: Nuevo `app/utils/document_storage.py` — reemplaza el versionado basado en `app.stored_files`

**Files:**
- Create: `monitor-app/backend/api/app/utils/document_storage.py`
- Test: `monitor-app/backend/api/tests/test_document_storage.py`
- (No modificar `app/utils/stored_files.py` todavía — Task 3/5 dejan de importarlo, se puede borrar recién al final si nada más lo usa; verificar con `grep -rn "stored_files" app/` antes de decidir si se borra en Task 3/5's cleanup step)

**Interfaces:**
- Produces:
  - `async def upload_document_version(supabase, *, key_prefix: str, file: UploadFile) -> dict` — retorna `{"storage_path": str, "file_name": str, "mime_type": str, "size_bytes": int}`. NO escribe en la base — el caller decide en qué tabla/fila guardar `storage_path`.
  - `async def log_document_replacement(pool, *, entity_type: str, entity_id, doc_name: str, old_status, old_expiry_date, old_storage_path, actor: str) -> None` — inserta en `app.audit_log` (`action='document_replace'`, `field=doc_name`, `old_value` jsonb con `{status, expiry_date, storage_path}`, `new_value=null`, `source='api'`). Se llama ANTES del UPDATE que pisa la fila, con los valores viejos ya leídos por el caller.
  - `async def get_document_history(pool, supabase, *, entity_type: str, entity_id, doc_name: str) -> list[dict]` — consulta `app.audit_log` filtrando `entity_type`, `entity_id`, `field=doc_name`, `action='document_replace'`, ordenado `occurred_at DESC`; por cada fila con `old_value->>'storage_path'` no nulo, genera una signed URL (mismo bucket `COMPLIANCE_BUCKET`, mismo patrón `create_signed_url` que `stored_files.list_owner_files` ya usaba) y devuelve `[{"storage_path": ..., "status": ..., "expiry_date": ..., "replaced_at": ..., "replaced_by": ..., "url": ...}, ...]`.
- Consumes: reusa `safe_storage_name`, `COMPLIANCE_BUCKET`, `STORED_FILE_MAX_BYTES`, `ALLOWED_STORED_FILE_MIMES`, `SIGNED_URL_TTL_SECONDS` de `app/utils/stored_files.py` (import directo, no duplicar las constantes).

- [ ] **Step 1: Escribir el test que falla primero**

```python
# tests/test_document_storage.py
import pytest
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from app.utils.document_storage import (
    upload_document_version, log_document_replacement, get_document_history,
)


@pytest.mark.asyncio
async def test_upload_document_version_returns_new_path_no_db_write():
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/pdf"
    file.filename = "licencia.pdf"

    async def fake_read():
        return b"contenido"
    file.read = fake_read

    result = await upload_document_version(
        supabase, key_prefix="driver/abc-123/licencia", file=file,
    )

    assert result["file_name"] == "licencia.pdf"
    assert result["mime_type"] == "application/pdf"
    assert result["size_bytes"] == len(b"contenido")
    assert result["storage_path"].startswith("driver/abc-123/licencia/")
    assert "licencia.pdf" in result["storage_path"]
    supabase.storage.from_.assert_called_with("compliance-docs")


@pytest.mark.asyncio
async def test_upload_document_version_two_calls_produce_different_paths():
    """Cada reemplazo debe ir a una ruta NUEVA — nunca se sobrescribe el blob anterior."""
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/pdf"
    file.filename = "licencia.pdf"

    async def fake_read():
        return b"v1"
    file.read = fake_read

    r1 = await upload_document_version(supabase, key_prefix="driver/abc-123/licencia", file=file)

    async def fake_read2():
        return b"v2"
    file.read = fake_read2

    r2 = await upload_document_version(supabase, key_prefix="driver/abc-123/licencia", file=file)

    assert r1["storage_path"] != r2["storage_path"]


@pytest.mark.asyncio
async def test_upload_document_version_rejects_disallowed_mime():
    supabase = MagicMock()
    file = MagicMock()
    file.content_type = "application/zip"
    file.filename = "archivo.zip"

    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc:
        await upload_document_version(supabase, key_prefix="x", file=file)
    assert exc.value.status_code == 422


@pytest.mark.asyncio
async def test_log_document_replacement_inserts_audit_row_with_old_values():
    pool = AsyncMock()

    await log_document_replacement(
        pool, entity_type="driver", entity_id="abc-123", doc_name="licencia",
        old_status="ok", old_expiry_date=date(2026, 1, 1), old_storage_path="driver/abc-123/licencia/v1_x.pdf",
        actor="user-1",
    )

    pool.execute.assert_called_once()
    call_args = pool.execute.call_args
    assert "app.audit_log" in call_args[0][0]
    assert "document_replace" in call_args[0]


@pytest.mark.asyncio
async def test_get_document_history_returns_prior_versions_with_signed_url():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "old_value": '{"status": "ok", "expiry_date": "2026-01-01", "storage_path": "driver/abc-123/licencia/v1_x.pdf"}',
        "occurred_at": datetime(2026, 1, 5, tzinfo=timezone.utc),
        "actor": "user-1",
    }]
    supabase = MagicMock()
    supabase.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://signed.example/x"}

    result = await get_document_history(
        pool, supabase, entity_type="driver", entity_id="abc-123", doc_name="licencia",
    )

    assert len(result) == 1
    assert result[0]["storage_path"] == "driver/abc-123/licencia/v1_x.pdf"
    assert result[0]["status"] == "ok"
    assert result[0]["url"] == "https://signed.example/x"
    assert result[0]["replaced_by"] == "user-1"
```
Nota: si el proyecto no tiene `pytest-asyncio` configurado, revisar cómo `tests/test_trip_create.py` u otro test async existente maneja esto (`@pytest.mark.asyncio` puede no ser necesario si el resto de la suite usa `TestClient` síncrono sobre endpoints async — en ese caso, ajustar estos tests a probar las funciones a través de un endpoint real con `TestClient` en vez de llamarlas directo, seguir el patrón que ya use el resto de `tests/`).

- [ ] **Step 2: Correr el test, confirmar que falla** (el módulo no existe todavía)

Run: `cd monitor-app/backend/api && source venv/bin/activate && pytest tests/test_document_storage.py -v`
Expected: FAIL con `ModuleNotFoundError: No module named 'app.utils.document_storage'`

- [ ] **Step 3: Implementar**

```python
# app/utils/document_storage.py
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
```

- [ ] **Step 4: Correr el test, confirmar que pasa**

Run: `pytest tests/test_document_storage.py -v`
Expected: PASS (5/5)

- [ ] **Step 5: Commit**

```bash
git add app/utils/document_storage.py tests/test_document_storage.py
git commit -m "feat(api): document_storage.py — reemplaza versionado de app.stored_files por ruta-nueva + audit_log"
```

---

### Task 3: Repuntar helpers de documentos en `transporters.py` (transporter/driver/vehicle) a las 3 tablas angostas

**Files:**
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (líneas 78-197: `_docs_by_entity`, `_resolve_entity`, `_upsert_document`, `_serialize_document`, `_document_patch_impl`, `_document_upload_impl`, `_document_files_impl`)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py` (tests que ejercitan estos helpers/endpoints de documentos)

**Interfaces:**
- Consumes: `app.transporter_documents`/`driver_documents`/`vehicle_documents` (Checkpoint A Task 3, PK `(entity_id, doc_name)`), `upload_document_version`/`log_document_replacement`/`get_document_history` (Task 2).
- Produces: mismas firmas de endpoint HTTP que hoy (`PATCH /transporters/{tid}/documents/{doc_code}`, `POST .../file`, `GET .../files` — y los equivalentes `/drivers/{did}/documents/...` y `/vehicles/{vid}/documents/...`), mismo contrato de respuesta JSON — Task 6 (frontend, checkpoint C) no debería necesitar cambios si esta firma se preserva.

- [ ] **Step 1: Leer el estado actual completo de las funciones a reemplazar**

Ya leídas en esta sesión — líneas 78-197 de `transporters.py` (`_docs_by_entity`, `_resolve_entity`, `_upsert_document`, `_serialize_document`, `_document_patch_impl`, `_document_upload_impl`, `_document_files_impl`) y sus 4 usos en `get_transporter` (líneas 413-414, 416-427, 469-477) y en los 9 endpoints de documentos (líneas 590-675).

- [ ] **Step 2: Reemplazar los helpers**

Cada tipo de entidad tiene su propia tabla ahora (no hay `entity_type` como parámetro genérico dentro de una sola tabla) — el helper recibe el nombre de tabla como parámetro para no triplicar código:

```python
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
    row = await pool.fetchrow(
        f"""
        INSERT INTO app.{table} ({fk}, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7::uuid, NOW())
        ON CONFLICT ({fk}, doc_name) DO UPDATE SET
            status       = COALESCE($3, app.{table}.status),
            expiry_date  = COALESCE($4, app.{table}.expiry_date),
            storage_path = COALESCE($5, app.{table}.storage_path),
            notes        = COALESCE($6, app.{table}.notes),
            updated_by   = $7::uuid,
            updated_at   = NOW()
        RETURNING *
        """,
        str(entity_id), doc_code, data.get("status"), data.get("expiry_date"),
        data.get("storage_path"), data.get("notes"), updated_by,
    )
    return dict(row)


def _serialize_document(row: dict, entity_type: str, entity_id) -> dict:
    return {
        "entity_type": entity_type,
        "entity_id": str(entity_id),
        "doc_code": row["doc_name"],
        "status": row["status"],
        "expiry_date": _iso(row["expiry_date"]),
        "storage_path": row["storage_path"],
        "notes": row["notes"],
        "updated_at": _iso(row["updated_at"]),
    }


async def _document_patch_impl(pool, entity_type, entity_id, doc_code, body: DocumentPatchBody, user):
    data = body.model_dump(exclude_none=True, exclude={"manual_override", "file_url"})
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
```
Nota: `DocumentPatchBody.file_url` (schema existente en `transporter_relational.py:134`) ya no tiene tabla que lo sostenga (los links externos por URL, si se quieren mantener como feature separada de "subir archivo", pueden guardarse en `notes` o requieren su propia columna — **no inventar una columna nueva sin decidirlo explícitamente; si el frontend actual depende de `file_url` como link pegado (no archivo subido), reportar esto como NEEDS_CONTEXT antes de continuar**, no asumir en silencio cuál es el comportamiento correcto).

- [ ] **Step 3: Actualizar `get_transporter` (líneas 413-427, 469-477)**

Cambiar `_docs_by_entity(pool, "driver", driver_ids)` / `"vehicle"` (ya compatibles con la nueva firma, sin cambios en el call site). Cambiar el query de `company_doc_rows` (líneas 416-427) de:
```sql
FROM app.compliance_doc_catalog c
LEFT JOIN app.compliance_documents cd
  ON cd.entity_type = 'transporter' AND cd.entity_id = $1 AND cd.doc_code = c.doc_code
WHERE c.entity_type = 'transporter'
```
a:
```sql
FROM app.compliance_doc_catalog c
LEFT JOIN app.transporter_documents cd
  ON cd.transporter_id = $1 AND cd.doc_name = c.doc_code
WHERE c.entity_type = 'transporter'
```
Y el bloque `documents = [...]` (líneas 469-477) que arma la respuesta desde `company_doc_rows` — cambiar `r["doc_code"]`/`r["file_url"]` según lo que la query nueva devuelva (la query ya no trae `file_url`, solo `storage_path` — ajustar el dict de salida para no referenciar una columna que no existe).

- [ ] **Step 4: Actualizar los 9 endpoints de documentos (líneas 590-675)** para pasar `str(entity_id)` correctamente donde el nuevo `_document_upload_impl`/`_document_files_impl` lo requieran — la firma de los endpoints HTTP no cambia, solo el cuerpo que llama a los helpers ya reemplazados.

- [ ] **Step 5: Actualizar tests mockeados**

Leer `tests/test_transporters_relational.py` completo primero. Cualquier test que mockee `pool.fetch`/`pool.fetchval` con una query que referencie `compliance_documents`/`driver_assignments`/`vehicle_assignments` en sus asserts de `call_args` (si los hay) debe actualizarse a las tablas nuevas. Los tests que solo verifican el JSON de respuesta (no el SQL exacto) probablemente sigan pasando sin cambios — pero agregar al menos 1 test nuevo por endpoint de documentos que verifique explícitamente que la tabla correcta (`app.transporter_documents`/`driver_documents`/`vehicle_documents`) aparece en la query ejecutada (`pool.fetchrow.call_args[0][0]` contiene el nombre de tabla esperado), para que un futuro desfase de schema como este se detecte en CI sin depender de Supabase real.

- [ ] **Step 6: Verificar contra Supabase real (mitiga el punto ciego del mock)**

Usar `mcp__claude_ai_Supabase__execute_sql` para correr a mano (no vía pytest) al menos: el INSERT/UPDATE de `_upsert_document` contra un `doc_code`/entidad real de prueba (una empresa de test, revertir después), y el SELECT de `_docs_by_entity`. Confirmar que no hay error de sintaxis/columna inexistente. Documentar el resultado en el reporte.

- [ ] **Step 7: Correr toda la suite y confirmar verde**

Run: `cd monitor-app/backend/api && source venv/bin/activate && pytest tests/ -v`
Expected: todos los tests pasan (incluye los nuevos de Step 5).

- [ ] **Step 8: Commit**

```bash
git add app/routers/transporters.py app/tests/test_transporters_relational.py
git commit -m "fix(api): repunta helpers de documentos de transporters.py a las tablas angostas de Checkpoint A"
```
(ajustar el path de add si `tests/` no está bajo `app/` — usar la ruta real del repo: `monitor-app/backend/api/app/routers/transporters.py monitor-app/backend/api/tests/test_transporters_relational.py`)

---

### Task 3b: Restaurar `file_url` (link pegado) y `manual_override` en las 3 tablas angostas de documentos

**Contexto (hallazgo NEEDS_CONTEXT de Task 3)**: al diseñar `app.transporter_documents`/`driver_documents`/`vehicle_documents` en Checkpoint A, se omitieron dos columnas que sí existían en la vieja `compliance_documents` y que son funciones reales y activas en el frontend (`TransporterDocumentsPanel.tsx`): `file_url` (botón "Pegar link", alternativa a subir archivo) y `manual_override` (badge "manual" + botón "Revertir a valor del pipeline"). `manual_override` además es necesario para la arquitectura de Checkpoint D (el flujo de upload+diff detecta conflicto cuando `manual_override=true`, ver plan arquitectónico §2.3 "conflict_reason: manual_override_active"). Con el pipeline externo ya congelado (Checkpoint A Task 6), `manual_override=true` por defecto sigue siendo el comportamiento correcto: cualquier PATCH/upload desde la app es, por definición, edición manual.

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260713020000_restore_document_file_url_and_override.sql`
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (helpers de Task 3: `_upsert_document`, `_serialize_document`, `_document_patch_impl`, `get_transporter`'s `company_doc_rows`)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Produces: columna `file_url text` y `manual_override boolean NOT NULL DEFAULT true` en las 3 tablas de Checkpoint A **y también en `app.insurance_policy_documents`** (creada en Task 1 de este mismo checkpoint con el mismo hueco — se corrige acá para que Task 5 no se tropiece con lo mismo). Consumido por Task 5.

- [ ] **Step 1: Migración**

```sql
ALTER TABLE app.transporter_documents      ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.driver_documents           ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.vehicle_documents          ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
ALTER TABLE app.insurance_policy_documents ADD COLUMN file_url text, ADD COLUMN manual_override boolean NOT NULL DEFAULT true;
```
Aplicar vía `mcp__claude_ai_Supabase__apply_migration` (project_id `viclzoftiudkepqnhekv`), verificar con `information_schema.columns`, commitear el archivo solo.

**Hallazgo adicional de la revisión de Task 3 (agregar a este task, no abrir uno nuevo)**: `_serialize_document` (Task 3) también dejó de devolver la clave `id` en la respuesta — las tablas angostas no tienen columna `id` propia, PK es compuesta `(fk, doc_name)`. Antes de tocar `_serialize_document` en el Step 2 de abajo, grepear `monitor-app/frontend/` por `TransporterDocument`/`TransporterDocumentPatchResult` (`lib/types.ts`) y sus usos para confirmar si el frontend lee `.id` de la respuesta de un documento. Si lo lee (por ejemplo para armar una key de React o para llamar a `.../documents/{doc_code}/files`, que ya usa `doc_code` no `id` así que probablemente no lo necesita) — documentar el hallazgo en el reporte. Si no se usa, no hace falta agregar nada (las tablas no tienen un id natural que darle sin inventar uno).

- [ ] **Step 2: Rewire en `transporters.py`**

`_upsert_document`: agregar `file_url`/`manual_override` al INSERT/ON CONFLICT (mismo patrón `COALESCE` que los demás campos; `manual_override` se fuerza a `true` en cada PATCH manual salvo que el body pida explícitamente `false` — mismo comportamiento que tenía `compliance_documents` antes de Checkpoint A: `data.get("manual_override", True)`).

`_serialize_document`: agregar `"file_url": row["file_url"], "manual_override": row["manual_override"],` al dict.

`_document_patch_impl`: quitar `"manual_override"` y `"file_url"` del set `exclude={...}` — ambos vuelven a ser campos válidos del PATCH. Confirmar que el botón "Revertir" (`PATCH` con `{"manual_override": false}` como único campo) ya no cae en el 422 "Ningún campo enviado".

`get_transporter`'s `company_doc_rows` query: volver a incluir `cd.file_url, cd.manual_override` en el SELECT (revertir el drop que Task 3 hizo por necesidad); el bloque `documents = [...]` recupera esas dos claves en el dict de salida.

- [ ] **Step 3: Test que falla primero, luego pasa** — al menos un test que ejercite el flujo completo: PATCH con `{"file_url": "https://..."}` como único campo (debe guardar, no 422); PATCH con `{"manual_override": false}` como único campo (debe guardar, no 422); GET de la ficha de empresa devuelve `file_url`/`manual_override` en cada documento.

- [ ] **Step 4: Verificar contra Supabase real** — mismo criterio que Task 3 Step 6 (INSERT/UPDATE de prueba con `file_url`/`manual_override`, revertir después).

- [ ] **Step 5: Correr toda la suite, confirmar verde.**

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260713020000_restore_document_file_url_and_override.sql monitor-app/backend/api/app/routers/transporters.py monitor-app/backend/api/tests/test_transporters_relational.py
git commit -m "fix(db,api): restaura file_url y manual_override en tablas angostas de documentos — funciones reales del frontend omitidas en Checkpoint A"
```

---

### Task 4: Repuntar asignación driver/vehicle en `transporters.py` a `transporter_id` directo (sin assignment tables)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (`_LIST_FROM` líneas 201-219, `list_transporters` sin cambio de firma, `get_transporter` líneas 376-411, `add_driver`/`patch_driver`/`remove_driver`/`transfer_driver` líneas 679-826, `add_vehicle`/`patch_vehicle`/`remove_vehicle`/`transfer_vehicle`/`add_trailer`/`remove_trailer` líneas 831-1028)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Consumes: `app.drivers.transporter_id`, `app.vehicles.transporter_id` (Checkpoint A Task 2). `app.audit_log` para transferencias (ya usado, sin cambio de patrón).
- Produces: mismas firmas de endpoint (`GET /transporters`, `GET /{tid}`, `POST/PATCH/DELETE /{tid}/drivers[/{did}]`, `.../vehicles[/{vid}]`, `.../trailers[/{trid}]`, `POST .../transfer`).

- [ ] **Step 1: Repuntar `_LIST_FROM` (líneas 201-219)**

```python
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
"""
```

- [ ] **Step 2: Repuntar `get_transporter` (líneas 376-411)** — reemplazar los 3 `SELECT ... FROM app.driver_assignments da JOIN app.drivers d ...`/`app.vehicle_assignments va JOIN app.vehicles v ...` por selects directos:
```python
driver_rows = await pool.fetch(
    "SELECT id, rut, dv, full_name, id_expiry, license_expiry, avance_total "
    "FROM app.drivers WHERE transporter_id = $1 ORDER BY full_name", tid,
)
vehicle_rows = await pool.fetch(
    "SELECT id, plate, kind, type_label, year, circ_permit_expiry, tech_inspection_expiry, "
    "gas_emissions_expiry, soap_insurance_expiry FROM app.vehicles "
    "WHERE transporter_id = $1 AND kind <> 'rampla' ORDER BY plate", tid,
)
trailer_rows = await pool.fetch(
    "SELECT id, plate FROM app.vehicles WHERE transporter_id = $1 AND kind = 'rampla' ORDER BY plate", tid,
)
```

- [ ] **Step 3: Repuntar `add_driver` (líneas 679-724)** — en vez de `INSERT INTO app.driver_assignments`, hacer `UPDATE app.drivers SET transporter_id = $1 WHERE id = $2` (o setearlo en el mismo INSERT si el conductor es nuevo). La lógica de "ya asignado a otra empresa → sugerir transfer" se mantiene, pero el chequeo de "activo" pasa a `SELECT transporter_id FROM app.drivers WHERE id = $1` en vez de la assignment table.

- [ ] **Step 4: Repuntar `patch_driver`/`remove_driver`/`transfer_driver` (líneas 727-826)** — `remove_driver`: `UPDATE app.drivers SET transporter_id = NULL WHERE id = $1 AND transporter_id = $2` (ya no hay `valid_to`, la desasignación es simplemente limpiar el FK). `transfer_driver`: `UPDATE app.drivers SET transporter_id = $1 WHERE id = $2 AND transporter_id = $3` en una sola sentencia (ya no hay que cerrar+abrir una fila de asignación); mantener el `INSERT INTO app.audit_log (...action='transfer'...)` tal cual, ya no depende de las tablas dropeadas.

- [ ] **Step 5: Repuntar `add_vehicle`/`patch_vehicle`/`remove_vehicle`/`transfer_vehicle`/`add_trailer`/`remove_trailer` (líneas 831-1028)** — mismo patrón que Step 3/4 aplicado a `app.vehicles.transporter_id`.

- [ ] **Step 6: Actualizar tests mockeados** — mismo criterio que Task 3 Step 5: agregar al menos 1 test por endpoint de asignación que confirme la tabla/columna correcta en la query.

- [ ] **Step 7: Verificar contra Supabase real** — igual que Task 3 Step 6, para al menos `add_driver`/`remove_driver`/`transfer_driver` sobre datos de prueba, revertido después.

- [ ] **Step 8: Correr toda la suite, confirmar verde.**

Run: `pytest tests/ -v`

- [ ] **Step 9: Commit**

```bash
git add app/routers/transporters.py tests/test_transporters_relational.py
git commit -m "fix(api): repunta asignación driver/vehicle a transporter_id directo (sin assignment tables)"
```

---

### Task 5: Repuntar `insurance.py` — pólizas/documentos de póliza + `insurance_kpis`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/insurance.py` (`_upsert_insurance_document` líneas 84-110, `list_policy_documents`/`patch_policy_document`/`upload_policy_document_file`/`list_policy_document_files` líneas 366-451, `insurance_kpis` líneas 483-511, **y también `upload_policy_file`/`list_policy_files` líneas 355-380** — hallazgo adicional durante la ejecución de este task: ambos endpoints usan `utils/stored_files.py`'s `upload_owner_file`/`list_owner_files`, que leen/escriben `app.stored_files`, tabla genérica dropeada por Checkpoint A Task 7. No estaban en el análisis original de este plan. Repuntar a `document_storage.upload_document_version` (sin tabla de versión — el `storage_path` resultante se guarda directo en `app.insurance_policies.storage_path`, mismo patrón que ya usa `PolicyPatchBody`) + `document_storage.get_document_history`/`log_document_replacement` con un `doc_name` sintético fijo (p.ej. `"policy_file"`) para conservar el historial de reemplazos vía `audit_log`, mismo patrón que el resto de este checkpoint.)
- Modify: `monitor-app/backend/api/tests/test_insurance.py`

**Interfaces:**
- Consumes: `app.insurance_policy_documents` (Task 1), `upload_document_version`/`log_document_replacement`/`get_document_history` (Task 2).
- Produces: mismas firmas HTTP (`GET/PATCH .../documents`, `POST .../documents/{doc_code}/file`, `GET .../documents/{doc_code}/files`, `GET /insurance/kpis`).

Nota: no hay tabla-catálogo (`insurance_doc_catalog`) — el catálogo de `doc_code` válidos para pólizas pasa a ser una lista estática en Python (a diferencia de `compliance_doc_catalog`, que Checkpoint A mantuvo porque las vistas SQL de elegibilidad lo necesitan; acá no hay una vista SQL equivalente para seguros, así que Python alcanza).

- [ ] **Step 1: Definir el catálogo estático** en `insurance.py` (o un nuevo `app/utils/insurance_doc_catalog.py` si se prefiere separar) — los 4 `doc_code` reales que tenía `app.insurance_doc_catalog` (recuperados de la migración `20260711000001_insurance_documents.sql:19-23`, que sembró esa tabla antes de que Checkpoint A la dropeara):

```python
INSURANCE_DOC_CATALOG = [
    {"doc_code": "poliza_firmada",       "label": "Póliza firmada",          "has_expiry": False},
    {"doc_code": "certificado_vigencia", "label": "Certificado de vigencia", "has_expiry": True},
    {"doc_code": "endoso",               "label": "Endoso",                  "has_expiry": False},
    {"doc_code": "comprobante_pago",     "label": "Comprobante de pago",     "has_expiry": False},
]
```

- [ ] **Step 2: Repuntar `_upsert_insurance_document` (líneas 84-110)** — mismo patrón que `_upsert_document` de Task 3, contra `app.insurance_policy_documents` en vez de `app.insurance_documents`, validando `doc_code` contra `INSURANCE_DOC_CATALOG` en vez de una query a `insurance_doc_catalog`.

- [ ] **Step 3: Repuntar `list_policy_documents` (líneas 366-385)** — reemplazar el `LEFT JOIN app.insurance_documents d ON ... FROM app.insurance_doc_catalog c` por iterar `INSURANCE_DOC_CATALOG` en Python + un solo `SELECT * FROM app.insurance_policy_documents WHERE policy_id = $1` para mergear.

- [ ] **Step 4: Repuntar `patch_policy_document`/`upload_policy_document_file`/`list_policy_document_files` (líneas 388-451)** — mismo patrón que Task 3 Step 2 (`_document_upload_impl`/`_document_files_impl` de `document_storage.py`, reusados aquí con `entity_type="insurance_policy"` si `_DOC_TABLE`/`_DOC_FK_COL` se generalizan, o llamado directo a `upload_document_version`/`log_document_replacement`/`get_document_history` con los nombres de tabla/columna de `insurance_policy_documents` hardcodeados — decisión del implementador, ambas son válidas, preferir reusar si no complica la firma).

- [ ] **Step 5: Repuntar `insurance_kpis` (líneas 483-511)** — la CTE `incomplete` (líneas 498-503) usa `CROSS JOIN app.insurance_doc_catalog c LEFT JOIN app.insurance_documents d`. Reemplazar por una lógica equivalente contra `app.insurance_policy_documents` y `len(INSURANCE_DOC_CATALOG)` en Python (contar por póliza cuántos `doc_name` de la lista estática NO tienen `status='ok'` en `insurance_policy_documents`, sumar 1 si hay al menos uno).

- [ ] **Step 6: Actualizar tests mockeados** — mismo criterio que Task 3 Step 5.

- [ ] **Step 7: Verificar contra Supabase real** — igual que Task 3 Step 6, para `patch_policy_document` sobre una póliza de prueba real, revertido después.

- [ ] **Step 8: Correr toda la suite, confirmar verde.**

- [ ] **Step 9: Commit**

```bash
git add app/routers/insurance.py tests/test_insurance.py
git commit -m "fix(api): repunta documentos de póliza a app.insurance_policy_documents, catálogo estático en Python"
```

---

### Task 6: Limpieza — retirar `app/utils/stored_files.py` si quedó sin uso

**Files:**
- Delete (condicional): `monitor-app/backend/api/app/utils/stored_files.py`
- Modify (condicional): cualquier archivo que aún lo importe

- [ ] **Step 1: Confirmar que nada más lo usa**

Run: `grep -rn "utils.stored_files\|utils import stored_files\|from .stored_files\|from ..utils.stored_files" monitor-app/backend/api/app/ monitor-app/backend/api/tests/`
Si el único resultado es el `import` interno de `document_storage.py` hacia las constantes (`ALLOWED_STORED_FILE_MIMES` etc.) — **no borrar el archivo**, solo mover esas constantes a `document_storage.py` y actualizar el import, luego sí borrar `stored_files.py`. Si aparece cualquier otro router/archivo usándolo activamente para leer/escribir `app.stored_files` (la tabla dropeada), eso es un caso que Task 3/4/5 debieron haber cubierto y no cubrieron — reportar BLOCKED, no borrar nada, y listar los call sites encontrados.

- [ ] **Step 2: Si está limpio, mover las constantes y borrar**

Mover `COMPLIANCE_BUCKET`, `STORED_FILE_MAX_BYTES`, `ALLOWED_STORED_FILE_MIMES`, `SIGNED_URL_TTL_SECONDS`, `safe_storage_name` de `stored_files.py` a `document_storage.py`; actualizar el import en `document_storage.py` (ya no cruzado); borrar `stored_files.py`; borrar/fusionar su test file si existe uno dedicado (`tests/test_stored_files.py` o similar — buscarlo primero).

- [ ] **Step 3: Correr toda la suite, confirmar verde.**

- [ ] **Step 4: Commit**

```bash
git add -A -- app/utils/ tests/  # solo estos paths, no todo el repo
git commit -m "chore(api): retira utils/stored_files.py sin uso, sus constantes migran a document_storage.py"
```

---

### Task 7: CRUD de contactos (`app.transporter_contacts` — RLS y schema ya existen desde antes de Checkpoint A, sin endpoint hasta ahora)

**Files:**
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (agregar al final, antes de la sección DELETE)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Consumes: `ContactPatchBody` (ya existe en `schemas/transporter_relational.py:59-63`, sin ningún endpoint que lo use hasta ahora).
- Produces: `GET/POST/PATCH/DELETE /transporters/{tid}/contacts[/{role}]`.

- [ ] **Step 1: Escribir los tests que fallan primero** (patrón `make_client` ya existente en el test file, ver ejemplo de `test_list_includes_new_fields_and_alert_filter` en `tests/test_transporters_relational.py:36-52`)

```python
def test_list_contacts_returns_all_roles():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"role": "rep_legal", "name": "Juan Pérez", "phone": "+56911111111", "email": "juan@x.cl"},
    ]
    client = make_client(pool)
    res = client.get(f"/api/v1/transporters/{TID}/contacts")
    assert res.status_code == 200
    assert res.json()["data"][0]["role"] == "rep_legal"


def test_upsert_contact_requires_editor():
    pool = AsyncMock()
    client = make_client(pool, role="viewer", enforce_roles=True)
    res = client.post(f"/api/v1/transporters/{TID}/contacts", json={"role": "operacional", "name": "Ana"})
    assert res.status_code == 403


def test_upsert_contact_inserts_or_updates():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"role": "operacional", "name": "Ana Soto", "phone": None, "email": None}
    client = make_client(pool)
    res = client.post(f"/api/v1/transporters/{TID}/contacts", json={"role": "operacional", "name": "Ana Soto"})
    assert res.status_code == 200
    assert res.json()["data"]["name"] == "Ana Soto"


def test_delete_contact():
    pool = AsyncMock()
    pool.execute.return_value = "DELETE 1"
    client = make_client(pool)
    res = client.delete(f"/api/v1/transporters/{TID}/contacts/rep_legal")
    assert res.status_code == 200


def test_delete_contact_not_found():
    pool = AsyncMock()
    pool.execute.return_value = "DELETE 0"
    client = make_client(pool)
    res = client.delete(f"/api/v1/transporters/{TID}/contacts/rep_legal")
    assert res.status_code == 404
```

- [ ] **Step 2: Correr, confirmar que fallan** (endpoints no existen — 404 en vez de los status esperados)

- [ ] **Step 3: Implementar**

```python
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
```
Ubicar estos 4 endpoints en `transporters.py` inmediatamente antes de la sección `# ── DELETE (admin) ──` (línea 1031).

- [ ] **Step 4: Correr, confirmar que pasan**

- [ ] **Step 5: Verificar contra Supabase real** (INSERT/UPDATE/DELETE sobre una empresa de prueba, revertido después) — RLS de `transporter_contacts` ya existía antes de Checkpoint A, confirmar que sigue permitiendo `editor` como se espera.

- [ ] **Step 6: Commit**

```bash
git add app/routers/transporters.py tests/test_transporters_relational.py
git commit -m "feat(api): CRUD de contactos (app.transporter_contacts) — endpoint que faltaba desde antes de Checkpoint A"
```

---

### Task 8: Alta/baja manual (transporter/driver/vehicle)

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/transporter_relational.py` (agregar `BajaBody`)
- Modify: `monitor-app/backend/api/app/routers/transporters.py`
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Consumes: columnas `baja_override`/`baja_reason`/`baja_notes`/`baja_by`/`baja_at` (Checkpoint A Task 1, ya existen en `transporters`/`drivers`/`vehicles`).
- Produces: `POST /transporters/{tid}/deactivate`, `POST /transporters/{tid}/reactivate`, y los mismos dos para `/{tid}/drivers/{did}` y `/{tid}/vehicles/{vid}`.

- [ ] **Step 1: Schema nuevo**

```python
# transporter_relational.py, agregar:
class BajaBody(BaseModel):
    reason: Literal['documentacion_vencida', 'termino_mutuo_acuerdo', 'termino_penalizacion', 'otro']
    notes: Optional[str] = None
```

- [ ] **Step 2: Tests que fallan primero**

```python
def test_deactivate_transporter_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post(f"/api/v1/transporters/{TID}/deactivate", json={"reason": "documentacion_vencida"})
    assert res.status_code == 403


def test_deactivate_transporter_sets_baja_override():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": TID}
    client = make_client(pool)
    res = client.post(f"/api/v1/transporters/{TID}/deactivate", json={
        "reason": "termino_mutuo_acuerdo", "notes": "Fin de contrato",
    })
    assert res.status_code == 200
    update_call = [c for c in pool.execute.call_args_list if "baja_override" in c[0][0]]
    assert len(update_call) == 1


def test_reactivate_transporter_clears_baja_fields():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": TID}
    client = make_client(pool)
    res = client.post(f"/api/v1/transporters/{TID}/reactivate")
    assert res.status_code == 200


def test_deactivate_driver_and_vehicle():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"id": "driver-1"}
    client = make_client(pool)
    res = client.post(f"/api/v1/transporters/{TID}/drivers/driver-1/deactivate", json={"reason": "otro"})
    assert res.status_code == 200
```

- [ ] **Step 3: Implementar** (ubicar antes de la sección `# ── DELETE (admin) ──`)

```python
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
```
Import `BajaBody` en el bloque de imports de `schemas.transporter_relational` al inicio del archivo. Nota: `_resolve_entity` requiere que Task 3/4 ya estén aplicados (usa `transporter_id` directo) — este task depende de Task 3 y 4.

- [ ] **Step 4: Correr, confirmar que pasan.**

- [ ] **Step 5: Verificar contra Supabase real** (dar de baja y reactivar una empresa de prueba, confirmar `baja_override`/`operational_status` cambian como se espera, revertir).

- [ ] **Step 6: Commit**

```bash
git add app/schemas/transporter_relational.py app/routers/transporters.py tests/test_transporters_relational.py
git commit -m "feat(api): alta/baja manual para transporters/drivers/vehicles"
```

---

### Task 9: `registry_url` en Seguros

**Files:**
- Modify: `monitor-app/backend/api/app/schemas/insurance.py` (`PolicyPatchBody`)
- Modify: `monitor-app/backend/api/app/routers/insurance.py` (`_serialize_policy`, `patch_policy`)
- Modify: `monitor-app/backend/api/tests/test_insurance.py`

**Interfaces:**
- Consumes: `app.insurance_policies.registry_url` (Checkpoint A Task 1, ya existe).

- [ ] **Step 1: Test que falla primero**

```python
def test_patch_policy_registry_url():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "policy-1", "transporter_id": None, "rut": "12345678-9", "contractor_name": None,
        "client_group": None, "company": "Aseguradora X", "policy_number": "P-1", "endorsement": None,
        "coverage": None, "plate": None, "policy_type": None, "valid_from": None, "valid_to": None,
        "payment_url": None, "file_url": None, "storage_path": None, "registry_url": "https://aseguradora.cl/poliza/1",
        "updated_at": None,
    }
    client = make_client(pool)  # reusar el helper de test_insurance.py si existe uno equivalente a make_client
    res = client.patch("/api/v1/insurance/policies/policy-1", json={"registry_url": "https://aseguradora.cl/poliza/1"})
    assert res.status_code == 200
    assert res.json()["registry_url"] == "https://aseguradora.cl/poliza/1"
```
(Revisar primero el helper de creación de cliente ya usado en `tests/test_insurance.py` — probablemente análogo a `make_client` de `test_transporters_relational.py` pero puede tener otro nombre; usar el que ya exista, no crear uno duplicado.)

- [ ] **Step 2: Implementar**

`schemas/insurance.py`, agregar a `PolicyPatchBody`: `registry_url: Optional[str] = None`.

`routers/insurance.py`, `_serialize_policy` (línea 46-65): agregar `"registry_url": row["registry_url"],` al dict.

`patch_policy` (línea 306-329): agregar `registry_url = COALESCE($5, registry_url),` al UPDATE y `data.get("registry_url")` al final de los params.

- [ ] **Step 3: Correr, confirmar que pasa.**

- [ ] **Step 4: Commit**

```bash
git add app/schemas/insurance.py app/routers/insurance.py tests/test_insurance.py
git commit -m "feat(api): registry_url en pólizas de seguro"
```

---

### Task 10: `operational_status` + IDs legados expuestos en listado/ficha de transportistas

**Files:**
- Modify: `monitor-app/backend/api/app/routers/transporters.py` (`list_transporters` líneas 260-291, `get_transporter` líneas 483-506)
- Modify: `monitor-app/backend/api/tests/test_transporters_relational.py`

**Interfaces:**
- Consumes: `app.v_transporter_operational_status` (Checkpoint A Task 4).

- [ ] **Step 1: Test que falla primero**

```python
def test_list_includes_operational_status():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": TID, "admin_id": "100", "business_name": "Transportes Test", "rut": "12345678-9",
        "account_stage": "Operational", "driver_count": 0, "vehicle_count": 0, "trailer_count": 0,
        "tracto_count": 0, "has_manual_edits": False, "has_active_alerts": True, "in_admin": True,
        "clients": [], "avance_80_20": None, "avance_total": None, "compliance_pct": 0.0,
        "eligible": False, "insurance_ok": True, "policies_count": 0, "blocking_reasons": [],
        "operational_status": "no_operativa", "matched_by_upload": False,
    }]
    pool.fetchval.return_value = 1
    client = make_client(pool)
    res = client.get("/api/v1/transporters")
    assert res.json()["data"][0]["operational_status"] == "no_operativa"
```

- [ ] **Step 2: Implementar**

`_LIST_FROM` (post-Task-4): agregar `LEFT JOIN app.v_transporter_operational_status os ON os.transporter_id = t.id`.

`list_transporters` SELECT (línea 260-287): agregar `os.operational_status, os.matched_by_upload,` a la lista de columnas.

`get_transporter` (línea 483-506): agregar al dict de respuesta `"operational_status": ..., "matched_by_upload": ..., "admin_account_id": str(t["admin_account_id"]) if t["admin_account_id"] is not None else None,` — consultar `app.v_transporter_operational_status` por separado (mismo patrón que la query de `eligibility` en línea 429-433) ya que no está en el SELECT principal de `t`.

- [ ] **Step 3: Correr, confirmar que pasa.**

- [ ] **Step 4: Commit**

```bash
git add app/routers/transporters.py tests/test_transporters_relational.py
git commit -m "feat(api): expone operational_status y admin_account_id en listado/ficha de transportistas"
```

---

## Self-Review Notes (para el controller)

- **Orden de dependencia estricto**: Task 1→2 (infraestructura) → 3→4 (repuntar transporters.py, 4 depende de que 3 ya haya dejado el archivo compilando) → 5 (repuntar insurance.py, independiente de 3/4 pero depende de 2) → 6 (cleanup, depende de que 3/4/5 ya no usen `stored_files.py`) → 7/8/9/10 (features nuevas, 8 depende de 3/4 por `_resolve_entity`, 9/10 son independientes entre sí y de 7/8).
- Task 3/4/5 son las de mayor riesgo (repuntan código en producción activa, aunque no haya usuarios reales todavía) — mismo criterio de rigor que Checkpoint A: verificar contra Supabase real, no confiar solo en el mock.
- El punto ciego del mock (pytest verde no implica SQL válido) es una limitación estructural de la suite existente, no algo que este plan deba resolver por completo — Task 3/4/5 mitigan parcialmente pidiendo verificación manual contra Supabase real en cada task, no una solución definitiva (eso sería un proyecto aparte: tests de integración contra una DB de test real).
