# Empresas — Checkpoint D: parser + diff + endpoints de upload EETT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el pipeline Mage/bronze (congelado en Checkpoint A) por un flujo de upload directo del Excel EETT (hojas Empresas/Conductores/Vehiculos_Equipos) a `app.*`, con preview/diff en memoria y aprobación explícita antes de aplicar. Esta es la pieza de mayor riesgo técnico de todo el rediseño — lógica de negocio nueva (parseo, matching, diff), no CRUD sobre un patrón ya probado.

**Architecture:** `services/centralizer_parser.py` (xlsx → filas normalizadas) → `services/centralizer_diff.py` (filas + estado actual de `app.*` → diff clasificado) → `routers/centralizer_uploads.py` (orquesta: POST sube+parsea+preview, POST approve/reject, POST apply recalcula el diff dentro de una transacción y lo aplica). Sin tabla de diff persistida (decisión ya tomada en esta sesión) — el diff se recalcula en cada preview y de nuevo en cada apply. `app.centralizer_uploads` (Checkpoint A) ya existe como tabla de trazabilidad mínima.

**Tech Stack:** Python 3.11, FastAPI, asyncpg, `openpyxl` (verificar si ya está en `requirements.txt`; si no, agregarlo — es la librería estándar de este ecosistema para leer `.xlsx`, ya usada indirectamente por el propio Excel que se analizó manualmente en esta sesión).

## Global Constraints

- Venv correcto: `monitor-app/backend/api/venv`.
- Alcance de este checkpoint: **solo el Excel de Empresas** (hojas Empresas/Conductores/Vehiculos_Equipos). El Excel de Seguros es Checkpoint F, separado, no tocar acá.
- Alcance de este checkpoint: **solo backend**. La UI de upload (Checkpoint E) requiere un brainstorm con companion visual antes de codear — no construir frontend en este plan.
- Naming: se usan los `doc_code`/nombres de columna ya existentes en `app.compliance_doc_catalog` y `app.transporters`/`drivers`/`vehicles` — no renombrar nada, no inventar nombres nuevos.
- Matching: por RUT normalizado (`split_part(regexp_replace(rut,'[.\s]','','g'),'-',1)`) como llave primaria, con `admin_internal_id` (ID legado) como llave alternativa si el Excel la trae como columna opcional.
- El diff **no se persiste** en una tabla — se calcula en memoria en el preview (`POST /centralizer-uploads`) y se recalcula desde cero dentro de la transacción de `apply` (evita condiciones de carrera con ediciones concurrentes).
- Cualquier query SQL nueva se verifica contra Supabase real (proyecto `viclzoftiudkepqnhekv`), no solo contra el mock — mismo criterio que Checkpoints A/B/C.
- Redactar cualquier PII real en los reportes de verificación (lección de esta sesión, ver memoria del proyecto).
- Nada se pushea a remoto sin decisión explícita del usuario.

---

### Task 1: `services/centralizer_parser.py` — parseo del Excel a filas normalizadas

**Files:**
- Create: `monitor-app/backend/api/app/services/centralizer_parser.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_parser.py`
- Modify: `monitor-app/backend/api/requirements.txt` (agregar `openpyxl` si no está)

**Interfaces:**
- Produces:
  - `def normalize_rut(raw: str) -> str` — `'12.345.678-9'` → `'12345678'` (sin puntos/guión/DV).
  - `def rut_dv(rut_norm: str) -> str` — algoritmo módulo-11 estándar, dígito verificador esperado (`'0'-'9'` o `'K'`).
  - `def parse_centralizer_date(raw) -> date | None` — con guard, no levanta excepción ante fecha no parseable.
  - `def map_doc_status(raw: str) -> str | None` — `'OK'→'ok', 'Pendiente'→'pendiente', 'Factible'→'factible', 'N/A'→'n_a'`, cualquier otro valor o vacío → `None`.
  - `class ParsedUpload(TypedDict/dataclass)`: `{"transporters": list[dict], "drivers": list[dict], "vehicles": list[dict], "sheet_summary": dict, "parse_errors": list[dict]}` — cada fila de `transporters`/`drivers`/`vehicles` trae ya normalizado: `rut` (cuerpo), `dv`, `rut_dv_valid` (bool), campos nativos de la entidad (business_name/full_name/plate/etc.), fechas de vencimiento nativas, `documents: dict[doc_code, status]`, y para drivers/vehicles también `transporter_rut` (para resolver la asignación en el diff) y opcionalmente `admin_internal_id` si la columna existe en el Excel.
  - `def parse_centralizer_workbook(file_bytes: bytes) -> ParsedUpload` — función principal, orquesta las 3 hojas.

- [ ] **Step 1: Confirmar/agregar dependencia**

```bash
cd monitor-app/backend/api && source venv/bin/activate && pip show openpyxl
```
Si no está instalado: agregarlo a `requirements.txt` (línea nueva, orden alfabético si el archivo lo respeta) y `pip install openpyxl`.

- [ ] **Step 2: Tests que fallan primero**

**No usar el archivo `monitor-app/Estatus_Cumplimiento_Gobernanza_Dropdowns (1).xlsx` tal cual.** Se verificó (controller, antes de este task) que su fila de ejemplo en la hoja `Empresas` es una empresa REAL de producción (RUT `77686639-3`, "TRANSPORTES BASTIAN WALTER CAMPOS RIVEROS E.I.R.L" — `SELECT count(*) FROM app.transporters WHERE rut='77686639'` devuelve 1). No comprometer ese dato a un fixture de test en git, y bajo ninguna circunstancia usarlo para probar el `apply` contra Supabase real (matchearía y modificaría el registro real).

En su lugar, construir el fixture (`monitor-app/backend/api/tests/fixtures/centralizer_sample.xlsx`) tomando la estructura de columnas exacta del Excel real (mismos headers, mismo orden, mismas 3 hojas — leerlas de ese archivo para copiar los headers) pero con **datos 100% inventados**: al menos 2 filas en `Empresas` (para poder probar dedupe/multi-cliente), con RUTs claramente ficticios que no colisionen con ningún transportista real (verificar cada uno con `SELECT count(*) FROM app.transporters WHERE rut = '<candidato>'` antes de usarlo — usar un patrón fuera del rango normal, ej. RUTs que empiecen en `9999...`, y confirmar 0 filas), nombres de empresa obviamente de prueba (ej. "Transportes Prueba Uno SPA", no un nombre real ni parecido a uno real), 1-2 conductores y 1-2 vehículos de prueba asociados. Guardar este archivo sintético en `tests/fixtures/centralizer_sample.xlsx` — es el único xlsx que se commitea a git.

```python
# tests/test_centralizer_parser.py
import pytest
from datetime import date
from app.services.centralizer_parser import (
    normalize_rut, rut_dv, parse_centralizer_date, map_doc_status, parse_centralizer_workbook,
)


def test_normalize_rut_strips_dots_and_dv():
    assert normalize_rut('12.345.678-9') == '12345678'
    assert normalize_rut('12345678-9') == '12345678'
    assert normalize_rut('12345678') == '12345678'


def test_rut_dv_matches_known_valid_ruts():
    # RUTs reales válidos conocidos en Chile (dígito verificador módulo 11) — no inventar,
    # usar ejemplos de dominio público verificables a mano: 76.086.428-3 (SII, público)
    assert rut_dv('76086428') == '3'


def test_parse_centralizer_date_valid_and_invalid():
    assert parse_centralizer_date('15/03/2027') == date(2027, 3, 15)
    assert parse_centralizer_date('') is None
    assert parse_centralizer_date('no-es-fecha') is None
    assert parse_centralizer_date(None) is None


def test_map_doc_status_known_values():
    assert map_doc_status('OK') == 'ok'
    assert map_doc_status('Pendiente') == 'pendiente'
    assert map_doc_status('Factible') == 'factible'
    assert map_doc_status('N/A') == 'n_a'
    assert map_doc_status('') is None
    assert map_doc_status('valor-desconocido') is None


def test_parse_centralizer_workbook_reads_all_3_sheets():
    with open('tests/fixtures/centralizer_sample.xlsx', 'rb') as f:
        result = parse_centralizer_workbook(f.read())

    assert result['sheet_summary']['Empresas'] >= 1
    assert result['sheet_summary']['Conductores'] >= 1
    assert result['sheet_summary']['Vehiculos_Equipos'] >= 1
    assert len(result['transporters']) == result['sheet_summary']['Empresas']

    t = result['transporters'][0]
    assert 'rut' in t and 'dv' in t and 'business_name' in t
    assert 'documents' in t and isinstance(t['documents'], dict)
    # doc_code mapeado, no el nombre de columna en español crudo:
    assert 'rol_sii' in t['documents'] or t['documents'] == {}  # vacío si la celda de ejemplo no trae valor


def test_parse_centralizer_workbook_rejects_unmapped_column():
    # Construir un xlsx mínimo en memoria con una columna que no existe en el mapeo
    # (usar openpyxl.Workbook() directo, no el fixture) y confirmar que
    # parse_centralizer_workbook levanta una excepción clara en vez de ignorar la columna en silencio.
    from openpyxl import Workbook
    from io import BytesIO
    wb = Workbook()
    ws = wb.active
    ws.title = 'Empresas'
    ws.append(['Nombre / Razón Social', 'RUT', 'DV', 'Columna Inventada Sin Mapeo'])
    ws.append(['Test SPA', '11111111', '1', 'x'])
    buf = BytesIO()
    wb.save(buf)

    with pytest.raises(ValueError, match='[Cc]olumna'):
        parse_centralizer_workbook(buf.getvalue())
```

- [ ] **Step 3: Correr, confirmar que fallan** (módulo no existe)

- [ ] **Step 4: Implementar**

Mapeo de columnas ES → destino, por hoja (ya resuelto contra `app.compliance_doc_catalog` real + la hoja Glosario del Excel — usar EXACTAMENTE estos `doc_code`, no inventar variantes):

**Hoja `Empresas`** → `app.transporters` + documentos `entity_type='transporter'`:
```
Nombre / Razón Social → business_name | RUT → rut (normalizado) | DV → dv
ROL SII → doc rol_sii | Copia C.I Rep. Legal → doc copia_ci_rep_legal
ANEXO 2 (Walmart) → doc anexo_2_gc | Contrato WEBCARGA → doc contrato_webcarga
F30 (MULTAS) → doc f30_multas | F43 → doc f43
Política de Seguridad → doc politica_seguridad | Cert. Afiliación Mutual → doc cert_mutual
RIOHS timbrado → doc riohs_timbrado | Creación en Walmart → doc creacion_gc
Carpeta Tributaria → doc carpeta_tributaria | Cuenta Empresa → doc cuenta_empresa
Avance 80/20 → avance_80_20 (referencial, no documento) | Avance Total → avance_total (referencial)
```
Columna opcional (puede no estar presente — si está, usarla para matching alternativo): `ID Legado` / `ID Interno Admin` → `admin_internal_id` (buscar el nombre real de columna solo si aparece; si no aparece en ninguna fila del Excel real, el matching cae 100% a RUT — no bloquear el parseo por su ausencia).

**Hoja `Conductores`** → `app.drivers` + `driver.transporter_id` (resuelto en el diff, no acá) + documentos `entity_type='driver'`:
```
RUT Empresa + DV Empresa → transporter_rut (clave para el diff, no una columna de drivers)
Nombre Completo → full_name | RUT/DV Conductor → rut/dv
Copia C.I (Vencimiento) → id_expiry + doc copia_ci (status derivado: 'ok' si la fecha es futura, 'actualizar' si vencida, ver Nota abajo)
Licencia (Vencimiento) → license_expiry + doc licencia (mismo criterio de status derivado)
ANEXO 3 (Walmart) → doc anexo_3_gc | EPP → doc epp | DAS/ODI → doc das_odi
Hoja de Vida → doc hoja_de_vida | Cert. Antecedentes → doc cert_antecedentes
Validado por Walmart → doc validado_gc_driver | Contrato de Trabajo → doc contrato_trabajo
Creación en Walmart → doc creacion_gc_driver
Avance Total → avance_total (referencial)
```
**Nota sobre status derivado de fecha**: para `copia_ci`/`licencia`, la hoja solo trae la fecha de vencimiento, no un status explícito tipo "OK"/"Pendiente" — derivar `status='ok'` si `expiry_date` es `None` o futura, `status='actualizar'` si `expiry_date` ya pasó (comparar contra `date.today()`, sin zona horaria especial — mismo criterio simple que el resto de este módulo).

**Hoja `Vehiculos_Equipos`** → `app.vehicles` + `vehicle.transporter_id` (resuelto en el diff) + documentos `entity_type='vehicle'`:
```
RUT Empresa + DV Empresa → transporter_rut
Tipo de Equipo → kind (TRACTOCAMION→'tracto', RAMPLA→'rampla', cualquier otro valor→'otro') + type_label (valor crudo)
Patente → plate
Padrón → doc padron
P. Circulación → circ_permit_expiry + doc permiso_circulacion
Re. Técnica → tech_inspection_expiry + doc revision_tecnica
Gases Contaminantes → gas_emissions_expiry + doc gases
Seguro (SOAP) → soap_insurance_expiry + doc soap
Póliza Vehicular con RC → doc poliza_rc | Año → year
GPS → doc gps | Seguro de Carga → doc seguro_carga
Mantención Cámara Frío → doc mantencion_camara_frio
Creación en Walmart → doc creacion_gc_vehicle
```

**Columnas del catálogo sin columna en el Excel** (no son un error, quedan fuera del alcance del upload — documentar en un comentario del módulo, no fallar el parseo por su ausencia): `validado_gc`, `pts_contratista` (transporter); `toma_conoc_plan_emergencia`, `toma_conoc_pts`, `capacitacion_epp`, `f30_1` (driver); `resolucion_sanitaria` (vehicle).

**Regla de columna no mapeada — falla ruidosa**: si el Excel trae una columna (header) que NO está en ninguno de los 3 mapeos de arriba (y no es una de las columnas de identidad ya cubiertas: Nombre/RUT/DV/RUT Empresa/DV Empresa/Nombre Completo/RUT Conductor/DV Conductor/Tipo de Equipo/Patente/Año/Avance 80/20/Avance Total), **levantar `ValueError`** con el nombre exacto de la columna y la hoja — no ignorarla en silencio (mismo principio que el gate de drift del pipeline Mage original, ahora en Python).

Dedupe: si el mismo RUT aparece más de una vez en la hoja `Empresas` (multi-cliente, ej. Walmart + Colun en filas separadas), agrupar en una sola fila combinando `clients` (lista) — usar la fila que tenga más campos no vacíos como base si hay conflicto de valores, documentado en un comentario, no silencioso.

- [ ] **Step 5: Correr, confirmar que pasan**

- [ ] **Step 6: Commit**

```bash
git add app/services/centralizer_parser.py tests/test_centralizer_parser.py tests/fixtures/centralizer_sample.xlsx requirements.txt
git commit -m "feat(api): centralizer_parser.py — parseo del Excel EETT a filas normalizadas, reemplaza el pipeline Mage"
```

---

### Task 2: `services/centralizer_diff.py` — diff contra el estado actual de `app.*`

**Files:**
- Create: `monitor-app/backend/api/app/services/centralizer_diff.py`
- Test: `monitor-app/backend/api/tests/test_centralizer_diff.py`

**Interfaces:**
- Consumes: `ParsedUpload` (Task 1).
- Produces: `async def compute_diff(pool, parsed: ParsedUpload) -> DiffResult` donde `DiffResult = {"transporters": list[EntityDiff], "drivers": list[EntityDiff], "vehicles": list[EntityDiff]}`, y `EntityDiff = {"entity_key": str, "match_method": "rut"|"legacy_id", "existing_id": str|None, "change_type": "new"|"updated"|"unchanged"|"conflict", "field_diffs": list[{"field": str, "old": Any, "new": Any}], "conflict_reason": str|None, "parsed_row": dict}`.

- [ ] **Step 1: Tests que fallan primero**

Cubrir con pool mockeado (`AsyncMock`, mismo patrón que el resto del proyecto): una fila nueva (sin match) → `change_type='new'`; una fila que matchea por RUT con datos idénticos → `'unchanged'`; una fila que matchea con un campo distinto → `'updated'` con el `field_diffs` correcto; una fila que matchea una entidad con `manually_edited_fields` conteniendo el campo tocado → `'conflict'`, `conflict_reason='manually_edited_field'`; una fila de documento contra una entidad con `baja_override=true` → `'conflict'`, `conflict_reason='baja_override_active'`; un conductor cuyo `transporter_rut` no matchea ninguna fila de la hoja Empresas del mismo upload → no genera diff de asignación, va a `parse_errors` del lado del diff (huérfano), no debe crashear.

- [ ] **Step 2: Implementar**

Lógica por tipo de entidad:
- **Transporters**: `SELECT id, business_name, rut, dv, account_stage, admin_internal_id, manually_edited_fields, baja_override FROM app.transporters WHERE rut = ANY($1) OR admin_internal_id = ANY($2)` — match primero por RUT, si no matchea y el Excel trajo `admin_internal_id`, intentar por ese. Comparar campo por campo (`business_name`, y los documentos de `app.transporter_documents` vía `SELECT * FROM app.transporter_documents WHERE transporter_id = ANY(...)`). Si el campo está en `manually_edited_fields` (para columnas nativas) o el documento tiene `manual_override=true` (para documentos), marcar `conflict` en vez de `updated` — la fila entera del `EntityDiff` puede tener `change_type='updated'` con conflictos solo en los campos específicos (usar `field_diffs` para indicar cuáles, no bloquear toda la fila por un solo campo en conflicto — permitir aplicar los campos sin conflicto e ignorar los que sí, ver Task 3).
- **Drivers/Vehicles**: mismo patrón, más la resolución de `transporter_id` desde `transporter_rut` (buscar en el batch de transporters ya resuelto en el mismo diff, no una query aparte — un conductor de una empresa NUEVA en el mismo upload debe poder resolver su asignación sin que la empresa ya exista en la DB todavía).
- `baja_override=true` en la entidad destino → todo el `EntityDiff` de esa entidad es `conflict` con `conflict_reason='baja_override_active'` (una empresa/conductor/vehículo dado de baja no se actualiza automáticamente por upload — requiere reactivar primero, decisión de diseño explícita: proteger contra que un upload accidentalmente "reviva" algo dado de baja intencionalmente).

- [ ] **Step 3: Correr, confirmar que pasan**

- [ ] **Step 4: Commit**

```bash
git add app/services/centralizer_diff.py tests/test_centralizer_diff.py
git commit -m "feat(api): centralizer_diff.py — calcula diff en memoria contra app.*, detecta conflictos con overrides manuales"
```

---

### Task 3: `routers/centralizer_uploads.py` + `schemas/centralizer_upload.py`

**Files:**
- Create: `monitor-app/backend/api/app/schemas/centralizer_upload.py`
- Create: `monitor-app/backend/api/app/routers/centralizer_uploads.py`
- Modify: `monitor-app/backend/api/app/main.py` (registrar el router)
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads.py`

**Interfaces:**
- Consumes: `parse_centralizer_workbook` (Task 1), `compute_diff` (Task 2), `app.centralizer_uploads` (Checkpoint A, ya existe: `id, upload_kind, file_name, storage_path, uploaded_by, uploaded_at, status, sheet_summary, parse_errors, approved_by, approved_at, applied_at, rejected_by, rejected_at, rejection_reason`).
- Produces:
```
POST   /centralizer-uploads                       (require_editor) — recibe xlsx, sube a Storage (bucket compliance-docs, mismo patrón que document_storage.py), parsea, calcula diff, guarda fila en app.centralizer_uploads (status='previewed', sheet_summary, parse_errors), devuelve {upload_id, sheet_summary, parse_errors, diff: DiffResult}
GET    /centralizer-uploads                        (cualquier autenticado) — lista, paginada simple
GET    /centralizer-uploads/{id}                    — detalle de la fila (sin diff — el diff no se persiste, re-parsear no es gratis; si se necesita ver el diff de nuevo, re-subir o mantenerlo en el estado del frontend desde el POST original)
POST   /centralizer-uploads/{id}/approve            (require_admin) — status='previewed'→'approved', approved_by/at
POST   /centralizer-uploads/{id}/reject             (require_admin) — body {reason}, status→'rejected'
POST   /centralizer-uploads/{id}/apply              (require_admin) — solo si status='approved'; descarga el archivo de Storage, re-parsea, recalcula el diff (no confía en el diff del preview), aplica dentro de una transacción con pg_advisory_xact_lock (clave fija del upload, ej. hash('centralizer_upload')), actualiza transporter.last_matched_upload_id/last_matched_at para cada transporter matcheado (por RUT o admin_internal_id), status→'applied', applied_at
```

- [ ] **Step 1: Schemas**

```python
# schemas/centralizer_upload.py
from typing import Optional
from pydantic import BaseModel

class UploadRejectBody(BaseModel):
    reason: Optional[str] = None
```
(El resto de los endpoints no necesitan body — `POST .../apply`/`.../approve` no reciben payload, `POST /centralizer-uploads` recibe `UploadFile` directo vía `File(...)`, mismo patrón que los uploads de documentos ya existentes en `transporters.py`/`insurance.py`.)

- [ ] **Step 2: Tests que fallan primero** (mock de pool + supabase storage, mismo patrón `make_client` que el resto de la suite)

Cubrir: POST sube+parsea+devuelve diff correctamente estructurado; approve requiere admin (403 con editor); apply falla con 409/422 si `status != 'approved'`; apply es idempotente (aplicar 2 veces no duplica — verificar con un segundo `apply` sobre un upload ya `applied` → debe rechazar, no re-aplicar silenciosamente, ya que el estado no vuelve a `approved` después de `applied`); apply respeta `include_in_apply` implícito (los `EntityDiff` con `change_type='conflict'` NO se aplican, solo `new`/`updated` sin conflicto).

- [ ] **Step 3: Implementar**

Reusar el patrón de subida a Storage ya existente (`document_storage.upload_document_version`, adaptar `key_prefix` a algo como `centralizer-uploads/{timestamp}_{filename}`). El `apply` debe:
1. Re-leer el archivo desde Storage (no confiar en que el diff del preview sigue vigente).
2. Re-parsear + re-calcular diff dentro de la transacción.
3. Para cada `EntityDiff` con `change_type IN ('new', 'updated')`: aplicar los campos sin conflicto (upsert transporters/drivers/vehicles + sus documentos, mismo patrón `_upsert_document` ya existente en `transporters.py` — **reusar esas funciones/el mismo estilo de query, no reescribir la lógica de upsert de documentos desde cero**).
4. Para `drivers`/`vehicles` nuevos o con `transporter_rut` distinto al `transporter_id` actual: actualizar `transporter_id` directo (mismo patrón que `transfer_driver`/`transfer_vehicle` de Checkpoint B — un solo `UPDATE`, más un registro en `audit_log` con `action='transfer'` si es una reasignación real, no una asignación nueva).
5. Actualizar `transporters.last_matched_upload_id = $upload_id, last_matched_at = NOW()` para cada transporter tocado (matcheado por RUT o `admin_internal_id`).
6. Registrar en `app.centralizer_uploads`: `status='applied'`, `applied_at=NOW()`.

- [ ] **Step 4: Registrar el router en `main.py`** (mismo patrón que los demás `app.include_router(...)`).

- [ ] **Step 5: Correr, confirmar que pasan**

- [ ] **Step 6: Verificar contra Supabase real** — usar el fixture sintético (`tests/fixtures/centralizer_sample.xlsx`, Task 1) contra un flujo completo: `POST` (preview) → `approve` → `apply` sobre una transacción de prueba, confirmar que `app.transporters`/`drivers`/`vehicles`/`*_documents` reflejan los datos del Excel, confirmar `last_matched_upload_id` se pobló, **revertir todo** (DELETE de las filas de prueba creadas). **Antes de correr esto, confirmar de nuevo con una query en vivo que los RUTs del fixture siguen sin existir en `app.transporters`/`drivers`** (`SELECT rut FROM app.transporters WHERE rut = ANY($1)` con la lista de RUTs del fixture — debe devolver 0 filas) — no asumir que porque el fixture se diseñó como ficticio en Task 1 sigue siéndolo ahora (la base es real y cambia). Sin PII real en el reporte (los datos son sintéticos, pero igual no hace falta reproducir el contenido completo del Excel en el reporte, alcanza con confirmar conteos/estructura).

- [ ] **Step 7: Commit**

```bash
git add app/schemas/centralizer_upload.py app/routers/centralizer_uploads.py app/main.py tests/test_centralizer_uploads.py
git commit -m "feat(api): routers/centralizer_uploads.py — POST/approve/reject/apply, reemplaza el pipeline Mage congelado"
```

---

### Task 4: Test de integración end-to-end + idempotencia

**Files:**
- Test: `monitor-app/backend/api/tests/test_centralizer_uploads_e2e.py` (o agregar a `test_centralizer_uploads.py` si el controller decide que no amerita archivo aparte)

**Interfaces:** ninguna nueva — este task es puramente de verificación adicional sobre lo ya construido.

- [ ] **Step 1: Test de aplicar el mismo upload dos veces**

Contra Supabase real (con el fixture, RUTs ficticios, revertido después): subir → aprobar → aplicar → confirmar conteos. Subir el MISMO archivo de nuevo (segundo upload, fila nueva en `centralizer_uploads`) → aprobar → aplicar → confirmar que las entidades ya existentes se detectan como `change_type='unchanged'` (no se re-insertan, no se duplican) y que ningún campo con `manual_override`/`manually_edited_fields` se pisó.

- [ ] **Step 2: Test de conflicto real**

Editar manualmente un campo de una entidad de prueba (vía el endpoint PATCH ya existente, que marca `manually_edited_fields`) → subir un upload que trae un valor distinto para ese mismo campo → confirmar que el diff lo marca `conflict` y que `apply` NO lo sobrescribe (el valor editado manualmente permanece).

- [ ] **Step 3: Correr toda la suite de backend (`pytest tests/ -v`), confirmar verde.**

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/api/tests/
git commit -m "test(api): idempotencia y conflicto real de centralizer_uploads contra Supabase"
```

---

## Self-Review Notes (para el controller)

- **Task 3 es el de mayor riesgo** (transacción de apply, matching por 2 llaves, reuso de la lógica de upsert de documentos ya existente sin duplicarla) — TDD estricto, revisor en opus, mismo criterio que Checkpoints A/B/C aplicaron a sus tasks más riesgosos.
- El fixture real (`Estatus_Cumplimiento_Gobernanza_Dropdowns (1).xlsx`) tiene solo 1 fila de ejemplo por hoja — suficiente para probar el mapeo de columnas, pero **no** para probar volumen/rendimiento ni el caso de múltiples empresas con el mismo RUT en distintas filas (multi-cliente) — si se quiere probar ese caso específico, el implementador de Task 1 puede construir un xlsx sintético adicional con `openpyxl.Workbook()` en el test, no depender solo del fixture real.
- Checkpoint E (frontend del flujo de upload) y Checkpoint F (parser de Seguros) quedan explícitamente fuera de este plan — no implementarlos acá aunque parezca natural continuar.
