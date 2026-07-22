# Mapeo self-service de columnas nuevas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cuando el Excel EETT trae una columna que el parser no reconoce, en vez de bloquear todo el upload, mostrar una pantalla de mapeo (estilo Brevo) donde un admin resuelve cada columna (mapear a un documento existente, crear uno nuevo, o ignorarla) — la decisión queda guardada para futuras subidas.

**Architecture:** nueva tabla `app.centralizer_column_mappings` (header → doc_code, o NULL = ignorar). El parser combina el mapa estático de Python con estas filas antes de decidir si hay columnas sin resolver. Si las hay, el upload queda en un nuevo estado `pending_mapping` con un endpoint dedicado para resolverlas (admin-only) que re-parsea el mismo archivo ya en Storage una vez completo el mapeo.

**Tech Stack:** mismo stack que Checkpoint D/E — FastAPI+asyncpg backend, Next.js+TanStack Query+Tailwind frontend. Sin dependencias nuevas.

## Global Constraints

- Backend tests: `monitor-app/backend/api/venv` (`source venv/bin/activate`).
- Frontend: `npx tsc --noEmit` + `npx vitest run` en cada task; `npm run build` solo al final.
- No emojis — lucide-react.
- Nunca usar el archivo real de producción en tests — usar fixtures sintéticos.
- **No aplicar la migración a Supabase sin confirmación explícita del usuario** — mismo patrón ya seguido para Checkpoints A-F (escribir el archivo, pedir confirmación antes de `apply_migration`).
- Reusar patrones existentes: `_download_and_parse`/`_apply_diff` de `centralizer_uploads.py`, `useCanAdmin`, TanStack Query hooks (`useTripNotes.ts`), tabla de mocks `AsyncMock` de `test_centralizer_uploads.py`.

---

### Task 1: Migración — tabla `app.centralizer_column_mappings`

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260714000000_centralizer_column_mappings.sql`

**Interfaces:**
- Produces: tabla `app.centralizer_column_mappings(sheet_name, excel_header, doc_code, created_by, created_at)`, PK `(sheet_name, excel_header)` — consumida por Tasks 3-5.

- [ ] **Step 1: Escribir la migración**

```sql
CREATE TABLE app.centralizer_column_mappings (
  sheet_name text NOT NULL CHECK (sheet_name IN ('Empresas', 'Conductores', 'Vehiculos_Equipos')),
  excel_header text NOT NULL,
  doc_code text,  -- NULL = ignorar esta columna permanentemente
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_name, excel_header)
);

COMMENT ON TABLE app.centralizer_column_mappings IS
  'Resoluciones guardadas de columnas del Excel EETT que no estaban en el '
  'mapeo estático de centralizer_parser.py — evita que una columna nueva '
  'bloquee uploads futuros con el mismo header.';
```

- [ ] **Step 2: NO aplicar todavía**

Este archivo se escribe local. La aplicación a Supabase (`viclzoftiudkepqnhekv`) requiere confirmación explícita del usuario antes de ejecutar — pedirla al llegar a este punto durante la ejecución, igual que en checkpoints anteriores.

- [ ] **Step 3: Commit (solo el archivo de migración, no la aplicación)**

```bash
git add monitor-app/backend/supabase/migrations/20260714000000_centralizer_column_mappings.sql
git commit -m "feat(db): migración para app.centralizer_column_mappings (mapeo self-service de columnas)"
```

---

### Task 2: Backend — parser acepta mapeos extra y detecta columnas sin resolver sin lanzar

**Files:**
- Modify: `monitor-app/backend/api/app/services/centralizer_parser.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_parser.py`

**Interfaces:**
- Produces: `parse_centralizer_workbook(file_bytes, extra_mappings=None)` (parámetro nuevo, retrocompatible); `find_unresolved_columns(file_bytes, extra_mappings=None) -> list[{"sheet": str, "header": str}]` — consumido por Task 3-5.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/test_centralizer_parser.py`:

```python
def test_find_unresolved_columns_empty_when_all_known():
    with open('tests/fixtures/centralizer_sample.xlsx', 'rb') as f:
        raw = f.read()
    from app.services.centralizer_parser import find_unresolved_columns
    assert find_unresolved_columns(raw) == []


def test_find_unresolved_columns_detects_unknown_header():
    from openpyxl import Workbook
    from io import BytesIO
    from app.services.centralizer_parser import find_unresolved_columns

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Columna Totalmente Nueva'])
    ws.append(['Test SPA', '99999008', '6', 'x'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    result = find_unresolved_columns(buf.getvalue())
    assert result == [{'sheet': 'Empresas', 'header': 'Columna Totalmente Nueva'}]


def test_find_unresolved_columns_respects_extra_mappings():
    from openpyxl import Workbook
    from io import BytesIO
    from app.services.centralizer_parser import find_unresolved_columns

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Cuenta Banco Empresa'])
    ws.append(['Test SPA', '99999009', '7', 'OK'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    extra = {'Empresas': {'Cuenta Banco Empresa': ('doc', 'cuenta_banco_empresa')}}
    assert find_unresolved_columns(buf.getvalue(), extra) == []


def test_parse_centralizer_workbook_uses_extra_mappings():
    from openpyxl import Workbook
    from io import BytesIO
    from app.services.centralizer_parser import parse_centralizer_workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Cuenta Banco Empresa'])
    ws.append(['Test SPA', '99999010', '8', 'OK'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    extra = {'Empresas': {'Cuenta Banco Empresa': ('doc', 'cuenta_banco_empresa')}}
    result = parse_centralizer_workbook(buf.getvalue(), extra)
    assert result['parse_errors'] == []
    assert result['transporters'][0]['documents']['cuenta_banco_empresa'] == 'ok'


def test_parse_centralizer_workbook_extra_mapping_can_ignore_column():
    from openpyxl import Workbook
    from io import BytesIO
    from app.services.centralizer_parser import parse_centralizer_workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Columna Irrelevante'])
    ws.append(['Test SPA', '99999011', '9', 'algo'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    extra = {'Empresas': {'Columna Irrelevante': ('ignore', None)}}
    result = parse_centralizer_workbook(buf.getvalue(), extra)
    assert result['parse_errors'] == []
    assert 'Columna Irrelevante' not in result['transporters'][0]
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/test_centralizer_parser.py -k "unresolved or extra_mapping" -v`
Expected: FAIL — `find_unresolved_columns` no existe, `parse_centralizer_workbook` no acepta `extra_mappings`.

- [ ] **Step 3: Implementar**

En `app/services/centralizer_parser.py`, agregar después de `_KIND_MAP`:

```python
_SHEET_COLUMNS: dict[str, dict[str, tuple[str, Any]]] = {
    "Empresas": EMPRESAS_COLUMNS,
    "Conductores": CONDUCTORES_COLUMNS,
    "Vehiculos_Equipos": VEHICULOS_COLUMNS,
}
```

Reemplazar `parse_centralizer_workbook` completo:

```python
def find_unresolved_columns(
    file_bytes: bytes, extra_mappings: dict[str, dict[str, tuple[str, Any]]] | None = None,
) -> list[dict]:
    """Escanea los headers de las 3 hojas contra el mapa combinado (estático
    + extra_mappings, ej. desde app.centralizer_column_mappings) SIN parsear
    filas ni lanzar excepción — usado por el router para decidir si el
    upload puede procesarse directo o necesita la pantalla de mapeo."""
    wb = load_workbook(BytesIO(file_bytes), data_only=True)
    extra_mappings = extra_mappings or {}
    unresolved: list[dict] = []
    for sheet_name, column_map in _SHEET_COLUMNS.items():
        merged = {**column_map, **extra_mappings.get(sheet_name, {})}
        ws = _get_sheet(wb, sheet_name)
        header_row = next(ws.iter_rows(min_row=1, max_row=1))
        for cell in header_row:
            h = cell.value
            if h is None or str(h).strip() == "":
                continue
            if h not in merged:
                unresolved.append({"sheet": sheet_name, "header": h})
    return unresolved


def parse_centralizer_workbook(
    file_bytes: bytes, extra_mappings: dict[str, dict[str, tuple[str, Any]]] | None = None,
) -> ParsedUpload:
    """Orquesta el parseo de las 3 hojas (Empresas, Conductores,
    Vehiculos_Equipos) del Excel EETT hacia estructuras normalizadas.
    `extra_mappings` (sheet -> {header: (ctype, target)}) se combina con el
    mapa estático de cada hoja — viene de resoluciones guardadas en
    app.centralizer_column_mappings, no requiere tocar este archivo para
    columnas nuevas ya resueltas por un admin."""
    wb = load_workbook(BytesIO(file_bytes), data_only=True)
    extra_mappings = extra_mappings or {}

    empresas_rows, empresas_errors = _parse_sheet_rows(
        _get_sheet(wb, "Empresas"), "Empresas",
        {**EMPRESAS_COLUMNS, **extra_mappings.get("Empresas", {})},
        identity_kind="rut", required_field="business_name",
    )
    conductores_rows, conductores_errors = _parse_sheet_rows(
        _get_sheet(wb, "Conductores"), "Conductores",
        {**CONDUCTORES_COLUMNS, **extra_mappings.get("Conductores", {})},
        identity_kind="rut", required_field="full_name",
    )
    vehiculos_rows, vehiculos_errors = _parse_sheet_rows(
        _get_sheet(wb, "Vehiculos_Equipos"), "Vehiculos_Equipos",
        {**VEHICULOS_COLUMNS, **extra_mappings.get("Vehiculos_Equipos", {})},
        identity_kind="plate",
    )

    transporters = _dedupe_transporters(empresas_rows)

    for row in (*transporters, *conductores_rows, *vehiculos_rows):
        row.pop("_row", None)

    return {
        "transporters": transporters,
        "drivers": conductores_rows,
        "vehicles": vehiculos_rows,
        "sheet_summary": {
            "Empresas": len(transporters),
            "Conductores": len(conductores_rows),
            "Vehiculos_Equipos": len(vehiculos_rows),
        },
        "parse_errors": [*empresas_errors, *conductores_errors, *vehiculos_errors],
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `python -m pytest tests/test_centralizer_parser.py -v`
Expected: todos PASS (los 5 nuevos + los 10 existentes)

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/services/centralizer_parser.py monitor-app/backend/api/tests/test_centralizer_parser.py
git commit -m "feat(api): parser acepta mapeos extra y detecta columnas sin resolver sin bloquear"
```

---

### Task 3: Backend — `upload_and_preview` usa mapeos guardados, cae en `pending_mapping` si hay columnas nuevas

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Consumes: `find_unresolved_columns`, `parse_centralizer_workbook(raw, extra_mappings)` (Task 2).
- Produces: `_load_extra_mappings(pool)` helper; `POST /centralizer-uploads` puede responder `{upload_id, status: "pending_mapping", unresolved_columns}` en vez del preview normal.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/test_centralizer_uploads.py`:

```python
def test_upload_with_unresolved_column_returns_pending_mapping():
    from io import BytesIO
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Columna Nueva De Verdad'])
    ws.append(['Test SPA', '99999012', '0', 'x'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    pool = AsyncMock()
    pool.fetch.return_value = []  # _load_extra_mappings: sin mapeos guardados
    pool.fetchval.return_value = 'dddddddd-0000-0000-0000-000000000002'
    client = make_client(pool)

    res = client.post(
        "/api/v1/centralizer-uploads",
        files={"file": ("nuevo.xlsx", buf.getvalue(),
               "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )

    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "pending_mapping"
    assert data["unresolved_columns"] == [{"sheet": "Empresas", "header": "Columna Nueva De Verdad"}]
    insert_sql = pool.fetchval.call_args.args[0]
    assert "'pending_mapping'" in insert_sql


def test_upload_uses_saved_mapping_and_skips_pending_mapping():
    pool = AsyncMock()
    saved_mapping = [{"sheet_name": "Empresas", "excel_header": "Cuenta Banco Empresa", "doc_code": "cuenta_banco_empresa"}]
    pool.fetch.side_effect = [saved_mapping, [], [], []]  # _load_extra_mappings, luego compute_diff (transporters/drivers/vehicles)
    pool.fetchval.return_value = "eeeeeeee-0000-0000-0000-000000000003"

    client = make_client(pool)
    res = client.post(
        "/api/v1/centralizer-uploads",
        files={"file": (
            "centralizer_sample.xlsx", _fixture_bytes(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] != "pending_mapping"
    assert "diff" in res.json()
```

Nota: el segundo test reusa `centralizer_sample.xlsx` (no tiene "Cuenta Banco Empresa") solo para confirmar que el flujo normal sigue funcionando cuando `_load_extra_mappings` no encuentra columnas relevantes — el fixture en sí no necesita la columna nueva para validar que el camino "no pending_mapping" sigue vivo.

- [ ] **Step 2: Correr y verificar que fallan**

Run: `python -m pytest tests/test_centralizer_uploads.py -k "pending_mapping" -v`
Expected: FAIL — `status` no es `pending_mapping`, sigue lanzando 422 por columna no mapeada.

- [ ] **Step 3: Implementar**

Agregar helper después de `_download_and_parse` en `centralizer_uploads.py`:

```python
async def _load_extra_mappings(pool) -> dict[str, dict[str, tuple[str, Any]]]:
    """Carga las resoluciones guardadas en app.centralizer_column_mappings
    y las convierte al mismo shape que los dicts *_COLUMNS del parser
    ('doc'/'ignore') — para que parse_centralizer_workbook las combine sin
    lógica especial."""
    rows = await pool.fetch("SELECT sheet_name, excel_header, doc_code FROM app.centralizer_column_mappings")
    result: dict[str, dict[str, tuple[str, Any]]] = {}
    for r in rows:
        sheet_map = result.setdefault(r["sheet_name"], {})
        sheet_map[r["excel_header"]] = ("ignore", None) if r["doc_code"] is None else ("doc", r["doc_code"])
    return result
```

Añadir import al inicio del archivo: `from typing import Any` (si no está) y `from ..services.centralizer_parser import find_unresolved_columns, parse_centralizer_workbook` (agregar `find_unresolved_columns` al import existente de `parse_centralizer_workbook`).

Reemplazar `upload_and_preview` completo:

```python
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
```

**Importante**: `apply_upload` también debe pasar `extra_mappings` a `_download_and_parse`, o un upload con una columna ya mapeada por esta vía rompería de nuevo al aplicar. Modificar `_download_and_parse`:

```python
def _download_and_parse(supabase, storage_path: str, extra_mappings: dict | None = None):
    """Descarga el archivo desde Storage y lo parsea — reusado por `apply`
    (que nunca confía en el diff del preview), por `GET /{upload_id}` (que
    nunca persiste el diff, lo recalcula en cada lectura), y por
    `resolve_column_mappings` (Task 5)."""
    try:
        raw = supabase.storage.from_(COMPLIANCE_BUCKET).download(storage_path)
    except Exception as e:
        raise HTTPException(502, f"Error descargando el archivo desde Storage: {e}")
    try:
        return parse_centralizer_workbook(raw, extra_mappings)
    except ValueError as e:
        raise HTTPException(422, f"Error re-parseando el archivo: {e}")
```

Y en `apply_upload`, reemplazar:
```python
    parsed = _download_and_parse(supabase, row["storage_path"])
```
por:
```python
    extra_mappings = await _load_extra_mappings(pool)
    parsed = _download_and_parse(supabase, row["storage_path"], extra_mappings)
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: todos PASS

- [ ] **Step 5: Correr suite completa**

Run: `python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: todos PASS, sin regresiones

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "feat(api): upload cae en pending_mapping si hay columnas sin resolver, en vez de bloquear"
```

---

### Task 4: Backend — `GET /{id}` maneja `pending_mapping`

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Consumes: `find_unresolved_columns`, `_load_extra_mappings` (Task 2-3).
- Produces: `GET /centralizer-uploads/{id}` incluye `data.unresolved_columns` (lista o `null`) junto a `data.diff`.

- [ ] **Step 1: Escribir el test que falla**

```python
def test_get_upload_pending_mapping_returns_unresolved_columns_not_diff():
    from io import BytesIO
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Otra Columna Nueva'])
    ws.append(['Test SPA', '99999013', '1', 'x'])
    wb.create_sheet('Conductores')
    wb.create_sheet('Vehiculos_Equipos')
    buf = BytesIO()
    wb.save(buf)

    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="pending_mapping", storage_path="centralizer-uploads/x.xlsx")
    pool.fetch.return_value = []  # _load_extra_mappings: sin mapeos guardados

    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = buf.getvalue()

    client = make_client(pool, supabase=supabase)
    res = client.get(f"/api/v1/centralizer-uploads/{UPLOAD_ID}")

    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["diff"] is None
    assert data["unresolved_columns"] == [{"sheet": "Empresas", "header": "Otra Columna Nueva"}]
```

- [ ] **Step 2: Correr y verificar que falla**

Run: `python -m pytest tests/test_centralizer_uploads.py -k pending_mapping_returns_unresolved -v`
Expected: FAIL — `KeyError: 'unresolved_columns'` o el status no es manejado.

- [ ] **Step 3: Implementar**

Reemplazar el bloque final de `get_upload` (después de `if not row: raise HTTPException(404, ...)`):

```python
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
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "feat(api): GET /centralizer-uploads/{id} expone unresolved_columns para pending_mapping"
```

---

### Task 5: Backend — endpoints de catálogo y resolución de mapeo

**Files:**
- Modify: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Modify: `monitor-app/backend/api/app/schemas/centralizer_upload.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Produces: `GET /centralizer-uploads/doc-catalog` (lista `{doc_code, entity_type, label}`); `POST /centralizer-uploads/{id}/column-mappings` (admin-only, aplica resoluciones + re-parsea + transiciona a `previewed`).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `tests/test_centralizer_uploads.py`:

```python
def test_list_doc_catalog_returns_entries():
    pool = AsyncMock()
    pool.fetch.return_value = [
        {"doc_code": "rol_sii", "entity_type": "transporter", "label": "Rol SII"},
        {"doc_code": "licencia", "entity_type": "driver", "label": "Licencia"},
    ]
    client = make_client(pool)
    res = client.get("/api/v1/centralizer-uploads/doc-catalog")
    assert res.status_code == 200
    assert len(res.json()["data"]) == 2


def test_resolve_column_mappings_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post(
        f"/api/v1/centralizer-uploads/{UPLOAD_ID}/column-mappings",
        json={"resolutions": [{"sheet": "Empresas", "header": "X", "action": "ignore"}]},
    )
    assert res.status_code == 403


def test_resolve_column_mappings_rejects_invalid_doc_code_on_create():
    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="pending_mapping")
    client = make_client(pool)
    res = client.post(
        f"/api/v1/centralizer-uploads/{UPLOAD_ID}/column-mappings",
        json={"resolutions": [
            {"sheet": "Empresas", "header": "X", "action": "create", "doc_code": "Con Mayuscula", "label": "X"},
        ]},
    )
    assert res.status_code == 422


def test_resolve_column_mappings_rejects_wrong_status():
    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="previewed")
    client = make_client(pool)
    res = client.post(
        f"/api/v1/centralizer-uploads/{UPLOAD_ID}/column-mappings",
        json={"resolutions": [{"sheet": "Empresas", "header": "X", "action": "ignore"}]},
    )
    assert res.status_code == 409


def test_resolve_column_mappings_success_reparse_returns_previewed():
    pool = AsyncMock()
    pool.fetchrow.return_value = _upload_row(status="pending_mapping", storage_path="centralizer-uploads/x.xlsx")
    # Validación (fuera de tx): doc_code no existe todavía para 'create'
    pool.fetchval.side_effect = [None]
    conn = FakeConn()
    pool.acquire = MagicMock(return_value=_acquire_ctx(conn))
    # _load_extra_mappings tras la tx, luego compute_diff (transporters/drivers/vehicles)
    pool.fetch.side_effect = [
        [{"sheet_name": "Empresas", "excel_header": "Cuenta Banco Empresa", "doc_code": "cuenta_banco_empresa"}],
        [], [], [],
    ]

    supabase = MagicMock()
    supabase.storage.from_.return_value.download.return_value = _fixture_bytes()

    client = make_client(pool, supabase=supabase)
    res = client.post(
        f"/api/v1/centralizer-uploads/{UPLOAD_ID}/column-mappings",
        json={"resolutions": [
            {"sheet": "Empresas", "header": "Cuenta Banco Empresa", "action": "create",
             "doc_code": "cuenta_banco_empresa", "label": "Cuenta Banco Empresa"},
        ]},
    )

    assert res.status_code == 200, res.text
    assert res.json()["status"] == "previewed"
    assert "diff" in res.json()
```

Nota: `FakeConn`/`_acquire_ctx` ya existen en el archivo (usados por los tests de `apply`) — `FakeConn.fetchval` necesita un branch nuevo para `SELECT COALESCE(MAX(sort_order)...`, agregar:

```python
        if "COALESCE(MAX(sort_order)" in sql:
            return 10
```
dentro de `FakeConn.fetchval` (junto a los `if sql.strip().startswith(...)` existentes).

- [ ] **Step 2: Correr y verificar que fallan**

Run: `python -m pytest tests/test_centralizer_uploads.py -k "doc_catalog or resolve_column_mappings" -v`
Expected: FAIL — rutas no existen (404) o `FakeConn` sin el branch nuevo.

- [ ] **Step 3: Implementar**

En `schemas/centralizer_upload.py`, agregar:

```python
class ColumnMappingResolution(BaseModel):
    sheet: str
    header: str
    action: str  # "map" | "create" | "ignore"
    doc_code: Optional[str] = None
    label: Optional[str] = None


class ColumnMappingResolutionBody(BaseModel):
    resolutions: list[ColumnMappingResolution]
```

En `centralizer_uploads.py`, agregar import: `import re` y `from ..schemas.centralizer_upload import ColumnMappingResolutionBody, UploadRejectBody` (agregar al import existente).

Agregar constante junto a `_ENTITY_TABLE`:

```python
_SHEET_ENTITY_TYPE = {"Empresas": "transporter", "Conductores": "driver", "Vehiculos_Equipos": "vehicle"}
_DOC_CODE_RE = re.compile(r"^[a-z][a-z0-9_]*$")
```

**Importante — orden de rutas**: FastAPI matchea en orden de declaración. `GET /doc-catalog` debe declararse ANTES de `GET /{upload_id}` en el archivo, o `/{upload_id}` capturaría "doc-catalog" como un id. Insertar el nuevo endpoint justo antes de `@router.get("/{upload_id}")`:

```python
@router.get("/doc-catalog")
async def list_doc_catalog(pool=Depends(get_pool), user=Depends(require_admin)):
    rows = await pool.fetch(
        "SELECT doc_code, entity_type, label FROM app.compliance_doc_catalog ORDER BY entity_type, sort_order",
    )
    return {"data": [dict(r) for r in rows]}
```

Agregar al final del archivo (después de `apply_upload`):

```python
@router.post("/{upload_id}/column-mappings")
async def resolve_column_mappings(
    upload_id: str, body: ColumnMappingResolutionBody,
    pool=Depends(get_pool), supabase=Depends(get_supabase), user=Depends(require_admin),
):
    row = await pool.fetchrow(
        "SELECT id, status, storage_path FROM app.centralizer_uploads WHERE id = $1", upload_id,
    )
    if not row:
        raise HTTPException(404, "Upload no encontrado")
    if row["status"] != "pending_mapping":
        raise HTTPException(
            409, f"El upload está en estado '{row['status']}', se requiere 'pending_mapping'",
        )

    # Validar TODAS las resoluciones antes de aplicar ninguna
    for r in body.resolutions:
        if r.sheet not in _SHEET_ENTITY_TYPE:
            raise HTTPException(422, f"Hoja inválida: {r.sheet}")
        entity_type = _SHEET_ENTITY_TYPE[r.sheet]
        if r.action == "create":
            if not r.doc_code or not _DOC_CODE_RE.match(r.doc_code):
                raise HTTPException(422, f"doc_code inválido: {r.doc_code!r} (snake_case, ej. 'licencia_municipal')")
            if not r.label:
                raise HTTPException(422, "label requerido para crear un documento nuevo")
            existing = await pool.fetchval(
                "SELECT 1 FROM app.compliance_doc_catalog WHERE doc_code = $1 AND entity_type = $2",
                r.doc_code, entity_type,
            )
            if existing:
                raise HTTPException(422, f"doc_code '{r.doc_code}' ya existe para {entity_type}")
        elif r.action == "map":
            if not r.doc_code:
                raise HTTPException(422, "doc_code requerido para mapear a un documento existente")
            existing = await pool.fetchval(
                "SELECT 1 FROM app.compliance_doc_catalog WHERE doc_code = $1 AND entity_type = $2",
                r.doc_code, entity_type,
            )
            if not existing:
                raise HTTPException(422, f"doc_code '{r.doc_code}' no existe para {entity_type}")
        elif r.action != "ignore":
            raise HTTPException(422, f"action inválida: {r.action}")

    async with pool.acquire() as conn:
        async with conn.transaction():
            for r in body.resolutions:
                entity_type = _SHEET_ENTITY_TYPE[r.sheet]
                doc_code = None if r.action == "ignore" else r.doc_code
                if r.action == "create":
                    next_sort = await conn.fetchval(
                        "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM app.compliance_doc_catalog WHERE entity_type = $1",
                        entity_type,
                    )
                    await conn.execute(
                        "INSERT INTO app.compliance_doc_catalog (doc_code, entity_type, label, sort_order, required_for_clients) "
                        "VALUES ($1, $2, $3, $4, ARRAY['Walmart'])",
                        r.doc_code, entity_type, r.label, next_sort,
                    )
                await conn.execute(
                    "INSERT INTO app.centralizer_column_mappings (sheet_name, excel_header, doc_code, created_by) "
                    "VALUES ($1, $2, $3, $4::uuid) "
                    "ON CONFLICT (sheet_name, excel_header) DO UPDATE SET doc_code = EXCLUDED.doc_code",
                    r.sheet, r.header, doc_code, user["sub"],
                )

    extra_mappings = await _load_extra_mappings(pool)
    parsed = _download_and_parse(supabase, row["storage_path"], extra_mappings)
    diff = await compute_diff(pool, parsed)
    all_parse_errors = [*parsed["parse_errors"], *diff["parse_errors"]]

    await pool.execute(
        "UPDATE app.centralizer_uploads SET status = 'previewed', sheet_summary = $2, parse_errors = $3 WHERE id = $1",
        upload_id, json.dumps(parsed["sheet_summary"]), json.dumps(all_parse_errors),
    )

    return {
        "upload_id": upload_id, "status": "previewed",
        "sheet_summary": parsed["sheet_summary"], "parse_errors": all_parse_errors, "diff": diff,
    }
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `python -m pytest tests/test_centralizer_uploads.py -v`
Expected: todos PASS

- [ ] **Step 5: Suite completa**

Run: `python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: todos PASS

- [ ] **Step 6: Commit**

```bash
git add monitor-app/backend/api/app/routers/centralizer_uploads.py monitor-app/backend/api/app/schemas/centralizer_upload.py monitor-app/backend/api/tests/test_centralizer_uploads.py
git commit -m "feat(api): endpoints doc-catalog y column-mappings — resolución self-service admin-only"
```

---

### Task 6: Frontend — tipos

**Files:**
- Modify: `monitor-app/frontend/lib/types.ts`

**Interfaces:**
- Produces: `UnresolvedColumn`, `ComplianceDocCatalogEntry`, `ColumnMappingResolution` — consumidos por Tasks 7-9.

- [ ] **Step 1: Append**

```ts
export type UnresolvedColumn = {
  sheet:  'Empresas' | 'Conductores' | 'Vehiculos_Equipos'
  header: string
}

export type ComplianceDocCatalogEntry = {
  doc_code:    string
  entity_type: 'transporter' | 'driver' | 'vehicle'
  label:       string
}

export type ColumnMappingResolution = {
  sheet:     'Empresas' | 'Conductores' | 'Vehiculos_Equipos'
  header:    string
  action:    'map' | 'create' | 'ignore'
  doc_code?: string
  label?:    string
}
```

Y extender `CentralizerUploadStatus` (ya existe) para incluir `'pending_mapping'`:
```ts
export type CentralizerUploadStatus = 'parsed' | 'previewed' | 'approved' | 'applied' | 'rejected' | 'failed' | 'pending_mapping'
```

Y extender `CentralizerUploadDetail` (ya existe) para incluir:
```ts
export type CentralizerUploadDetail = CentralizerUploadSummary & {
  parse_errors:       CentralizerParseError[]
  diff:               CentralizerDiff | null
  unresolved_columns: UnresolvedColumn[] | null
}
```

- [ ] **Step 2: Verificar**

Run: `cd monitor-app/frontend && npx tsc --noEmit`
Expected: sin errores nuevos

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/lib/types.ts
git commit -m "feat(frontend): tipos para mapeo de columnas (pending_mapping, doc catalog)"
```

---

### Task 7: Frontend — API client

**Files:**
- Modify: `monitor-app/frontend/lib/api/centralizerUploads.ts`

**Interfaces:**
- Produces: `centralizerUploadsApi.getDocCatalog()`, `centralizerUploadsApi.resolveColumnMappings(id, resolutions)`.

- [ ] **Step 1: Agregar al objeto `centralizerUploadsApi`**

```ts
  getDocCatalog: () =>
    apiFetch<{ data: import('@/lib/types').ComplianceDocCatalogEntry[] }>('/api/v1/centralizer-uploads/doc-catalog'),

  resolveColumnMappings: (id: string, resolutions: import('@/lib/types').ColumnMappingResolution[]) =>
    apiFetch<{ upload_id: string; status: string; sheet_summary: Record<string, number>; parse_errors: CentralizerParseError[]; diff: CentralizerDiff }>(
      `/api/v1/centralizer-uploads/${id}/column-mappings`,
      { method: 'POST', body: JSON.stringify({ resolutions }) },
    ),
```

(Agregar antes del cierre `}` del objeto — junto a `apply`.)

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/lib/api/centralizerUploads.ts
git commit -m "feat(frontend): API client — getDocCatalog + resolveColumnMappings"
```

---

### Task 8: Frontend — hooks

**Files:**
- Modify: `monitor-app/frontend/hooks/useCentralizerUploads.ts`

**Interfaces:**
- Produces: `useComplianceDocCatalog()`, `useResolveColumnMappings(id)`.

- [ ] **Step 1: Agregar**

```ts
export function useComplianceDocCatalog() {
  return useQuery({
    queryKey: ['compliance-doc-catalog'],
    queryFn: () => centralizerUploadsApi.getDocCatalog(),
  })
}

export function useResolveColumnMappings(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (resolutions: Parameters<typeof centralizerUploadsApi.resolveColumnMappings>[1]) =>
      centralizerUploadsApi.resolveColumnMappings(id, resolutions),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['centralizer-upload', id] }),
  })
}
```

- [ ] **Step 2: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add monitor-app/frontend/hooks/useCentralizerUploads.ts
git commit -m "feat(frontend): hooks — useComplianceDocCatalog + useResolveColumnMappings"
```

---

### Task 9: Frontend — `ColumnMappingResolver` (tabla de resolución)

**Files:**
- Create: `monitor-app/frontend/components/dashboard/ColumnMappingResolver.tsx`
- Test: `monitor-app/frontend/components/dashboard/ColumnMappingResolver.test.tsx`

**Interfaces:**
- Consumes: `UnresolvedColumn`, `ComplianceDocCatalogEntry`, `ColumnMappingResolution` (Task 6).
- Produces: `ColumnMappingResolver({ unresolvedColumns, catalog, onSubmit, submitting })` — consumido por Task 10.

- [ ] **Step 1: Escribir los tests que fallan**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ColumnMappingResolver } from './ColumnMappingResolver'
import type { UnresolvedColumn, ComplianceDocCatalogEntry } from '@/lib/types'

const unresolved: UnresolvedColumn[] = [
  { sheet: 'Empresas', header: 'Cuenta Banco Empresa' },
]
const catalog: ComplianceDocCatalogEntry[] = [
  { doc_code: 'rol_sii', entity_type: 'transporter', label: 'Rol SII' },
  { doc_code: 'cuenta_empresa', entity_type: 'transporter', label: 'Cuenta de la empresa' },
]

describe('ColumnMappingResolver', () => {
  it('disables submit until every column has a resolution', () => {
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={vi.fn()} submitting={false} />)
    expect(screen.getByText(/Confirmar y continuar/)).toBeDisabled()
  })

  it('submits a "map" resolution when an existing doc_code is chosen', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.change(screen.getByLabelText('Mapeo para Cuenta Banco Empresa'), { target: { value: 'cuenta_empresa' } })
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'map', doc_code: 'cuenta_empresa' },
    ])
  })

  it('submits an "ignore" resolution', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.click(screen.getByLabelText('Ignorar Cuenta Banco Empresa'))
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'ignore' },
    ])
  })

  it('submits a "create" resolution with doc_code and label', () => {
    const onSubmit = vi.fn()
    render(<ColumnMappingResolver unresolvedColumns={unresolved} catalog={catalog} onSubmit={onSubmit} submitting={false} />)
    fireEvent.click(screen.getByText('+ Nuevo tipo de documento'))
    fireEvent.change(screen.getByLabelText('Código para Cuenta Banco Empresa'), { target: { value: 'cuenta_banco_empresa' } })
    fireEvent.change(screen.getByLabelText('Etiqueta para Cuenta Banco Empresa'), { target: { value: 'Cuenta Banco Empresa' } })
    fireEvent.click(screen.getByText(/Confirmar y continuar/))
    expect(onSubmit).toHaveBeenCalledWith([
      { sheet: 'Empresas', header: 'Cuenta Banco Empresa', action: 'create', doc_code: 'cuenta_banco_empresa', label: 'Cuenta Banco Empresa' },
    ])
  })
})
```

- [ ] **Step 2: Correr y verificar que fallan**

Run: `cd monitor-app/frontend && npx vitest run components/dashboard/ColumnMappingResolver.test.tsx`
Expected: FAIL — módulo no existe

- [ ] **Step 3: Implementar**

```tsx
'use client'

import { useState } from 'react'
import type { UnresolvedColumn, ComplianceDocCatalogEntry, ColumnMappingResolution } from '@/lib/types'

const SHEET_ENTITY_TYPE = {
  Empresas: 'transporter', Conductores: 'driver', Vehiculos_Equipos: 'vehicle',
} as const

type RowState =
  | { mode: 'unset' }
  | { mode: 'map'; doc_code: string }
  | { mode: 'create'; doc_code: string; label: string }
  | { mode: 'ignore' }

interface Props {
  unresolvedColumns: UnresolvedColumn[]
  catalog:           ComplianceDocCatalogEntry[]
  onSubmit:          (resolutions: ColumnMappingResolution[]) => void
  submitting:        boolean
}

export function ColumnMappingResolver({ unresolvedColumns, catalog, onSubmit, submitting }: Props) {
  const [rows, setRows] = useState<Record<string, RowState>>(
    () => Object.fromEntries(unresolvedColumns.map(c => [c.header, { mode: 'unset' } as RowState])),
  )

  function setRow(header: string, next: RowState) {
    setRows(prev => ({ ...prev, [header]: next }))
  }

  const allResolved = unresolvedColumns.every(c => {
    const r = rows[c.header]
    if (r.mode === 'unset') return false
    if (r.mode === 'map') return !!r.doc_code
    if (r.mode === 'create') return !!r.doc_code && !!r.label
    return true // ignore
  })

  function handleSubmit() {
    const resolutions: ColumnMappingResolution[] = unresolvedColumns.map(c => {
      const r = rows[c.header]
      if (r.mode === 'map') return { sheet: c.sheet, header: c.header, action: 'map', doc_code: r.doc_code }
      if (r.mode === 'create') return { sheet: c.sheet, header: c.header, action: 'create', doc_code: r.doc_code, label: r.label }
      return { sheet: c.sheet, header: c.header, action: 'ignore' }
    })
    onSubmit(resolutions)
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {unresolvedColumns.length} columna{unresolvedColumns.length !== 1 ? 's' : ''} nueva{unresolvedColumns.length !== 1 ? 's' : ''} sin resolver.
      </p>
      <div className="space-y-4">
        {unresolvedColumns.map(c => {
          const entityType = SHEET_ENTITY_TYPE[c.sheet]
          const options = catalog.filter(d => d.entity_type === entityType)
          const row = rows[c.header]
          return (
            <div key={c.header} className="border border-border rounded-xl p-4">
              <p className="text-sm font-semibold text-slate-800">{c.header}</p>
              <p className="text-xs text-gray-400 mb-3">hoja {c.sheet}</p>

              {row.mode === 'create' ? (
                <div className="flex gap-2">
                  <input
                    aria-label={`Código para ${c.header}`}
                    placeholder="codigo_snake_case"
                    className="text-sm border border-border rounded-lg px-3 py-2 flex-1"
                    value={row.doc_code}
                    onChange={e => setRow(c.header, { mode: 'create', doc_code: e.target.value, label: row.label })}
                  />
                  <input
                    aria-label={`Etiqueta para ${c.header}`}
                    placeholder="Etiqueta legible"
                    className="text-sm border border-border rounded-lg px-3 py-2 flex-1"
                    value={row.label}
                    onChange={e => setRow(c.header, { mode: 'create', doc_code: row.doc_code, label: e.target.value })}
                  />
                </div>
              ) : (
                <div className="flex gap-2 items-center flex-wrap">
                  <select
                    aria-label={`Mapeo para ${c.header}`}
                    className="text-sm border border-border rounded-lg px-3 py-2"
                    value={row.mode === 'map' ? row.doc_code : ''}
                    onChange={e => setRow(c.header, { mode: 'map', doc_code: e.target.value })}
                  >
                    <option value="">Mapear a documento existente...</option>
                    {options.map(o => <option key={o.doc_code} value={o.doc_code}>{o.label}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => setRow(c.header, { mode: 'create', doc_code: '', label: '' })}
                    className="text-xs font-semibold text-accent hover:text-accent/80"
                  >
                    + Nuevo tipo de documento
                  </button>
                  <label className="flex items-center gap-1.5 text-xs text-gray-500">
                    <input
                      type="checkbox"
                      aria-label={`Ignorar ${c.header}`}
                      checked={row.mode === 'ignore'}
                      onChange={e => setRow(c.header, e.target.checked ? { mode: 'ignore' } : { mode: 'unset' })}
                    />
                    Ignorar
                  </label>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={handleSubmit}
        disabled={!allResolved || submitting}
        className="mt-4 bg-accent text-white text-sm font-semibold px-4 py-2.5 rounded-lg hover:bg-accent/90 disabled:opacity-40 transition-colors"
      >
        {submitting ? 'Aplicando...' : 'Confirmar y continuar'}
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Correr y verificar que pasan**

Run: `npx vitest run components/dashboard/ColumnMappingResolver.test.tsx`
Expected: todos PASS

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/components/dashboard/ColumnMappingResolver.tsx monitor-app/frontend/components/dashboard/ColumnMappingResolver.test.tsx
git commit -m "feat(frontend): ColumnMappingResolver — tabla de resolución de columnas nuevas"
```

---

### Task 10: Frontend — wiring en la página de detalle

**Files:**
- Modify: `monitor-app/frontend/app/dashboard/uploads/[id]/page.tsx`

**Interfaces:**
- Consumes: `useComplianceDocCatalog`, `useResolveColumnMappings` (Task 8), `ColumnMappingResolver` (Task 9).

- [ ] **Step 1: Agregar imports y hooks**

Agregar a los imports existentes:
```tsx
import {
  useCentralizerUpload, useApproveCentralizerUpload,
  useRejectCentralizerUpload, useApplyCentralizerUpload,
  useComplianceDocCatalog, useResolveColumnMappings,
} from '@/hooks/useCentralizerUploads'
import { ColumnMappingResolver } from '@/components/dashboard/ColumnMappingResolver'
```

Dentro del componente, después de `const apply = useApplyCentralizerUpload(id)`:
```tsx
  const docCatalog = useComplianceDocCatalog()
  const resolveMappings = useResolveColumnMappings(id)
```

- [ ] **Step 2: Agregar la rama de render para `pending_mapping`**

Reemplazar el bloque:
```tsx
      {upload.status === 'failed' ? (
        <p className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          {upload.parse_errors[0]?.reason ?? 'Error al parsear el archivo.'}
        </p>
      ) : upload.diff ? (
        <UploadDiffView diff={upload.diff} />
      ) : null}
```

por:
```tsx
      {upload.status === 'failed' ? (
        <p className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <XCircle size={16} className="shrink-0 mt-0.5" />
          {upload.parse_errors[0]?.reason ?? 'Error al parsear el archivo.'}
        </p>
      ) : upload.status === 'pending_mapping' ? (
        canAdmin ? (
          <ColumnMappingResolver
            unresolvedColumns={upload.unresolved_columns ?? []}
            catalog={docCatalog.data?.data ?? []}
            submitting={resolveMappings.isPending}
            onSubmit={resolutions => resolveMappings.mutate(resolutions)}
          />
        ) : (
          <p className="text-sm text-gray-500 bg-gray-50 border border-border rounded-lg px-4 py-3">
            Este archivo tiene columnas nuevas que un admin debe resolver antes de continuar.
          </p>
        )
      ) : upload.diff ? (
        <UploadDiffView diff={upload.diff} />
      ) : null}
```

**Nota**: la barra sticky de acciones (Aprobar/Rechazar/Aplicar) ya está condicionada a `upload.status === 'previewed' || upload.status === 'approved'` — no aparece en `pending_mapping`, no requiere cambios ahí.

- [ ] **Step 3: Verificar**

Run: `npx tsc --noEmit`
Expected: sin errores

- [ ] **Step 4: Commit**

```bash
git add "monitor-app/frontend/app/dashboard/uploads/[id]/page.tsx"
git commit -m "feat(frontend): wiring de ColumnMappingResolver en la página de detalle"
```

---

### Task 11: Verificación completa + AGENTLOG

- [ ] **Step 1: Backend completo**

Run: `cd monitor-app/backend/api && source venv/bin/activate && python -m pytest tests/ -q --deselect tests/test_centralizer_uploads_e2e.py`
Expected: todos PASS

- [ ] **Step 2: Frontend completo**

Run: `cd monitor-app/frontend && npx tsc --noEmit && npx vitest run && npm run build`
Expected: sin errores de tipo, todos los tests PASS, build exitoso

- [ ] **Step 3: Aplicar la migración a Supabase (con confirmación explícita ya obtenida en Task 1)**

Aplicar `20260714000000_centralizer_column_mappings.sql` a `viclzoftiudkepqnhekv` vía MCP de Supabase, verificar con un `SELECT` que la tabla existe.

- [ ] **Step 4: Smoke manual**

Con sesión admin real: subir un archivo con una columna nueva → confirmar pantalla de mapeo → resolver (probar los 3 caminos: map/create/ignore) → confirmar que el diff aparece → subir el mismo archivo de nuevo → confirmar que ya no pregunta por esa columna.

- [ ] **Step 5: Actualizar AGENTLOG.md**

Agregar sección describiendo el mapeo self-service, decisiones del brainstorm, y estado de verificación.

## Self-Review Notes

- **Spec coverage**: bloqueo antes del preview (Task 3), self-service crear documento (Task 5), recordar automáticamente (tabla Task 1 + `_load_extra_mappings`), las 3 hojas (parser Task 2 no distingue), admin-only (Task 5 `require_admin` + Task 10 `canAdmin`), layout tabla/lista (Task 9).
- **Type consistency**: `ColumnMappingResolution`/`UnresolvedColumn`/`ComplianceDocCatalogEntry` (Task 6) usados idénticos en Tasks 7, 8, 9, 10. `_SHEET_ENTITY_TYPE` (backend) y `SHEET_ENTITY_TYPE` (frontend, Task 9) deben coincidir en las 3 llaves.
- **Orden de rutas FastAPI**: anotado explícitamente en Task 5 (`/doc-catalog` antes de `/{upload_id}`) — riesgo real si se declara al final del archivo por error.
- **`apply_upload` también necesita `extra_mappings`**: anotado en Task 3 — de lo contrario un upload con columnas ya mapeadas por este mecanismo rompería igual al aplicar.
