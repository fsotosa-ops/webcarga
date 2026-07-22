# Empresas/Seguros — Checkpoint A: migración de esquema (identidad plana + congelamiento pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el modelo relacional actual de Empresas/Seguros en Supabase (`app` schema, proyecto `viclzoftiudkepqnhekv`) por uno más plano y auditado — sin la asociación polimórfica genérica, sin tablas de versionado/transferencia que nunca se usaron — y congelar el pipeline Mage/bronze que hoy alimenta esos datos. Es el Checkpoint A del plan arquitectónico aprobado en `/Users/usuario/.claude/plans/actua-como-un-experto-parallel-puppy.md` (léelo primero para el contexto completo — este documento es solo la ejecución granular de su §1 y §2).

**Architecture:** Migración de Supabase vía `mcp__claude_ai_Supabase__apply_migration` (efecto inmediato en la base viva) + archivo `.sql` espejo en `monitor-app/backend/supabase/migrations/` (convención del proyecto, para historial en git). Se ejecuta en orden estrictamente aditivo → backfill → repunte de vistas → limpieza destructiva al final, cada paso con verificación SQL antes de avanzar al siguiente.

**Tech Stack:** PostgreSQL/Supabase (proyecto `viclzoftiudkepqnhekv`), migraciones SQL puras (sin dbt/Mage para este flujo).

## Global Constraints

- Proyecto Supabase: `viclzoftiudkepqnhekv`. Usar `mcp__claude_ai_Supabase__apply_migration` para DDL (no `execute_sql`, que es solo para consultas/DML puntual de verificación).
- Cada migración también se escribe como archivo en `monitor-app/backend/supabase/migrations/YYYYMMDDHHMMSS_<slug>.sql` (mismo contenido exacto aplicado vía MCP) y se commitea en git en `dev` — es la convención ya establecida en este repo (ver archivos existentes en ese directorio para el formato).
- **No se hace ningún DROP TABLE/FUNCTION hasta que todos los pasos previos de backfill/migración de datos estén verificados con conteos exactos.** Si una verificación no cuadra, el task reporta BLOCKED — nunca se sigue adelante ni se improvisa una corrección no especificada aquí.
- No tocar `bronze.raw_info_contacto` (alimenta el sistema "admin", fuera de alcance).
- No tocar el schema `gold` ni ninguna tabla fuera de `app`/`bronze`/`ops` relacionada a este módulo.
- Naming: se mantienen los nombres de columnas ya existentes (`business_name`, `rut`, `dv`, `full_name`, `plate`, etc.) — no se renombra nada de eso en este checkpoint.
- Nada de esto se pushea a remoto — permanece en `dev` local, igual que el resto del historial de este módulo.

---

### Task 1: Columnas nuevas (aditivo puro — alta/baja, matching, registry_url, tabla de uploads)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130001_baja_override_and_uploads.sql`

**Interfaces:**
- Produces: columnas `app.transporters.baja_override/baja_reason/baja_notes/baja_by/baja_at/last_matched_upload_id/last_matched_at`; mismas columnas `baja_*` en `app.drivers`/`app.vehicles`; `app.insurance_policies.registry_url`; tipo `app.upload_status`; tabla `app.centralizer_uploads`. Todas las tareas siguientes de este checkpoint asumen que estas columnas/tabla existen.

- [ ] **Step 1: Escribir la migración**

Contenido exacto de `20260712130001_baja_override_and_uploads.sql`:

```sql
-- Checkpoint A / Task 1: columnas de alta-baja, matching por upload, registry_url, tabla de uploads.
-- Puramente aditivo, no destructivo.

CREATE TYPE app.upload_status AS ENUM ('parsed','previewed','approved','applied','rejected','failed');

CREATE TABLE app.centralizer_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_kind text NOT NULL CHECK (upload_kind IN ('centralizer','insurance')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status app.upload_status NOT NULL DEFAULT 'parsed',
  sheet_summary jsonb,
  parse_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  applied_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.transporters
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz,
  ADD COLUMN last_matched_upload_id uuid REFERENCES app.centralizer_uploads(id),
  ADD COLUMN last_matched_at timestamptz;

ALTER TABLE app.drivers
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz;

ALTER TABLE app.vehicles
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz;

ALTER TABLE app.insurance_policies ADD COLUMN registry_url text;
COMMENT ON COLUMN app.insurance_policies.registry_url IS
  'URL donde está registrada/consultable la póliza (portal aseguradora/SVS) — distinto de payment_url (pago) y file_url (documento adjunto).';

-- RLS: mismo criterio que las demás tablas de escritura admin+ (ver 20260710120006_rls_write_policies_role_matrix.sql
-- para el patrón exacto de app.current_user_role() usado en este proyecto — replicarlo aquí, no inventar uno nuevo).
ALTER TABLE app.centralizer_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY centralizer_uploads_all ON app.centralizer_uploads
  FOR SELECT USING (app.current_user_role() IS NOT NULL);

CREATE POLICY centralizer_uploads_insert ON app.centralizer_uploads
  FOR INSERT WITH CHECK (app.current_user_role() IN ('admin','editor'));

CREATE POLICY centralizer_uploads_update ON app.centralizer_uploads
  FOR UPDATE USING (app.current_user_role() = 'admin');
```

- [ ] **Step 2: Aplicar vía MCP**

Ejecutar con `mcp__claude_ai_Supabase__apply_migration` (`project_id: viclzoftiudkepqnhekv`, `name: baja_override_and_uploads`, `query`: el SQL de arriba completo).

- [ ] **Step 3: Verificar**

Vía `mcp__claude_ai_Supabase__execute_sql`:
```sql
SELECT column_name FROM information_schema.columns
WHERE table_schema='app' AND table_name='transporters' AND column_name LIKE 'baja_%' OR column_name LIKE 'last_matched%';
-- Esperado: 7 filas (baja_override, baja_reason, baja_notes, baja_by, baja_at, last_matched_upload_id, last_matched_at)

SELECT count(*) FROM app.centralizer_uploads; -- Esperado: 0 (tabla nueva, vacía)
SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name='insurance_policies' AND column_name='registry_url';
-- Esperado: 1 fila
```

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130001_baja_override_and_uploads.sql
git commit -m "feat(db): columnas alta/baja, matching por upload, registry_url de pólizas"
```

---

### Task 2: Backfill `transporter_id` directo en drivers/vehicles (reemplaza driver_assignments/vehicle_assignments)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130002_direct_transporter_fk.sql`

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: `app.drivers.transporter_id`, `app.vehicles.transporter_id` (poblados desde la fila vigente — `valid_to IS NULL` — de `driver_assignments`/`vehicle_assignments`). Task 7 (drop de tablas legacy) depende de que este backfill esté 100% verificado antes de dropear `driver_assignments`/`vehicle_assignments`.

- [ ] **Step 1: Contar el estado actual (antes de tocar nada)**

```sql
SELECT count(*) FROM app.driver_assignments WHERE valid_to IS NULL;   -- baseline esperado: 383
SELECT count(*) FROM app.vehicle_assignments WHERE valid_to IS NULL;  -- baseline esperado: 2357
SELECT count(*) FROM app.drivers;   -- 383
SELECT count(*) FROM app.vehicles;  -- 2357
```
Si estos números difieren de lo esperado (pudo haber cambiado desde la auditoría de esta sesión), usar los números reales que devuelva la query como baseline — no los de este documento.

- [ ] **Step 2: Escribir y aplicar la migración**

```sql
ALTER TABLE app.drivers ADD COLUMN transporter_id uuid REFERENCES app.transporters(id);
ALTER TABLE app.vehicles ADD COLUMN transporter_id uuid REFERENCES app.transporters(id);

UPDATE app.drivers d
SET transporter_id = da.transporter_id
FROM app.driver_assignments da
WHERE da.driver_id = d.id AND da.valid_to IS NULL;

UPDATE app.vehicles v
SET transporter_id = va.transporter_id
FROM app.vehicle_assignments va
WHERE va.vehicle_id = v.id AND va.valid_to IS NULL;

CREATE INDEX idx_drivers_transporter_id ON app.drivers(transporter_id);
CREATE INDEX idx_vehicles_transporter_id ON app.vehicles(transporter_id);
```

- [ ] **Step 3: Verificar — cero pérdidas de asignación**

```sql
SELECT count(*) FROM app.drivers WHERE transporter_id IS NULL;
-- Esperado: 0, o exactamente igual a (total drivers - conteo de driver_assignments vigentes del Step 1)
SELECT count(*) FROM app.vehicles WHERE transporter_id IS NULL;
-- mismo criterio

-- Verificación cruzada: todo driver/vehicle con transporter_id debe matchear exactamente
-- la asignación vigente que tenía antes.
SELECT count(*) FROM app.drivers d
JOIN app.driver_assignments da ON da.driver_id = d.id AND da.valid_to IS NULL
WHERE d.transporter_id IS DISTINCT FROM da.transporter_id;
-- Esperado: 0 (ninguna discrepancia)
```

Si cualquiera de estas verificaciones no da el resultado esperado: **STOP, reportar BLOCKED con los números reales**, no continuar a Task 7 ni a ningún DROP.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130002_direct_transporter_fk.sql
git commit -m "feat(db): transporter_id directo en drivers/vehicles, reemplaza tablas de asignación"
```

---

### Task 3: Tablas angostas de documentos + migración de datos reales

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130003_narrow_document_tables.sql`

**Interfaces:**
- Consumes: nada de Task 1/2 directamente (pero corre después por orden lógico del checkpoint).
- Produces: `app.transporter_documents`, `app.driver_documents`, `app.vehicle_documents` (PK compuesta entidad+doc_name). Task 4 (vistas de elegibilidad) y Task 7 (drop de `compliance_documents`/`compliance_doc_catalog`) dependen de que la migración de datos aquí esté verificada.

- [ ] **Step 1: Contar el estado actual**

```sql
SELECT entity_type, count(*) FROM app.compliance_documents WHERE status IS NOT NULL GROUP BY entity_type;
-- Usar estos números como baseline exacto de cuántas filas deben aparecer en cada tabla nueva.
-- (En la auditoría de esta sesión el total era 352 filas con status no nulo — verificar el número real ahora.)
```

- [ ] **Step 2: Escribir y aplicar la migración**

`app.compliance_documents.entity_id` apunta a `app.entities.id`, que a su vez tiene un `entity_type` — pero el `entity_id` real (uuid) de cada fila corresponde directamente al `id` del transportista/conductor/vehículo (verificar esto con una query antes de asumirlo — `SELECT entity_type FROM app.entities WHERE id = <algún entity_id de compliance_documents>` debe coincidir con `compliance_documents.entity_type` para esa fila).

```sql
CREATE TABLE app.transporter_documents (
  transporter_id uuid NOT NULL REFERENCES app.transporters(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (transporter_id, doc_name)
);

CREATE TABLE app.driver_documents (
  driver_id uuid NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, doc_name)
);

CREATE TABLE app.vehicle_documents (
  vehicle_id uuid NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
  doc_name text NOT NULL,
  status app.compliance_status,
  expiry_date date,
  storage_path text,
  notes text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, doc_name)
);

ALTER TABLE app.transporter_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vehicle_documents ENABLE ROW LEVEL SECURITY;
-- Replicar EXACTAMENTE el patrón de RLS de lectura/escritura ya usado para app.compliance_documents
-- (revisar su policy actual con: SELECT policyname, cmd, qual, with_check FROM pg_policies
--  WHERE schemaname='app' AND tablename='compliance_documents'; y aplicar el mismo criterio de rol
--  a las 3 tablas nuevas, en UNA sola policy por acción, no separando _read/_write como el original
--  — ese patrón separado es justamente lo que generó los warnings de "multiple permissive policies").

INSERT INTO app.transporter_documents (transporter_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'transporter' AND cd.status IS NOT NULL;

INSERT INTO app.driver_documents (driver_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'driver' AND cd.status IS NOT NULL;

INSERT INTO app.vehicle_documents (vehicle_id, doc_name, status, expiry_date, storage_path, notes, updated_by, updated_at)
SELECT cd.entity_id, cd.doc_code, cd.status, cd.expiry_date, cd.storage_path, cd.notes, cd.updated_by, cd.updated_at
FROM app.compliance_documents cd
WHERE cd.entity_type = 'vehicle' AND cd.status IS NOT NULL;
```

- [ ] **Step 3: Verificar 1:1 contra el baseline del Step 1**

```sql
SELECT
  (SELECT count(*) FROM app.transporter_documents) AS t,
  (SELECT count(*) FROM app.driver_documents) AS d,
  (SELECT count(*) FROM app.vehicle_documents) AS v;
-- Debe sumar exactamente el total del baseline del Step 1, desglosado por entity_type igual.

-- Spot-check de contenido, no solo conteo: tomar 5 filas al azar de compliance_documents (status not null)
-- y confirmar que status/expiry_date/storage_path coinciden exactamente en la tabla nueva correspondiente.
SELECT cd.entity_type, cd.entity_id, cd.doc_code, cd.status, cd.expiry_date
FROM app.compliance_documents cd WHERE cd.status IS NOT NULL ORDER BY random() LIMIT 5;
-- luego SELECT * de la tabla nueva correspondiente para cada una de esas 5 filas y comparar a mano.
```

Si el conteo o el spot-check no cuadran: **STOP, BLOCKED**, no continuar.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130003_narrow_document_tables.sql
git commit -m "feat(db): tablas angostas de documentos (transporter/driver/vehicle), migra datos reales de compliance_documents"
```

---

### Task 4: Repuntar vistas de elegibilidad + vista de estado operativo

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130004_eligibility_views_v2.sql`

**Interfaces:**
- Consumes: `app.transporter_documents`/`driver_documents`/`vehicle_documents` (Task 3), `baja_override` (Task 1), `last_matched_upload_id` (Task 1).
- Produces: `app.v_transporter_eligibility`, `app.v_driver_eligibility`, `app.v_vehicle_eligibility` (mismas firmas de columnas que hoy, `CREATE OR REPLACE VIEW`, no romper consumidores existentes del nombre/columnas), `app.v_transporter_operational_status` (nueva).

- [ ] **Step 1: Leer las definiciones actuales**

```sql
SELECT pg_get_viewdef('app.v_transporter_eligibility'::regclass, true);
SELECT pg_get_viewdef('app.v_driver_eligibility'::regclass, true);
SELECT pg_get_viewdef('app.v_vehicle_eligibility'::regclass, true);
SELECT pg_get_viewdef('app.v_transporter_compliance'::regclass, true);
```
Guardar el resultado — es la base para reescribir cada vista cambiando únicamente la fuente de `compliance_documents`/`compliance_doc_catalog` por `transporter_documents`/`driver_documents`/`vehicle_documents` + el catálogo estático (ver Nota abajo), y agregando `AND NOT baja_override` a la condición de `eligible`. **No inventar una lógica de umbral/threshold distinta a la que ya existe** — es un repunte de fuente de datos, no un rediseño de la fórmula de elegibilidad.

**Nota sobre el catálogo**: `compliance_doc_catalog` (label, entity_type, required_for_clients, has_expiry) todavía existe en este punto del checkpoint (se dropea recién en Task 7) — las vistas de este task pueden seguir haciendo JOIN contra `compliance_doc_catalog` para resolver `required_for_clients`/`has_expiry` por `doc_name`/`doc_code`, solo cambia la fuente del *estado* de cada documento (antes `compliance_documents`, ahora las 3 tablas nuevas). `compliance_doc_catalog` en sí no se toca en este task.

- [ ] **Step 2: Escribir y aplicar `CREATE OR REPLACE VIEW` para las 3 vistas de elegibilidad**

(El SQL exacto depende del resultado del Step 1 — reescribir cada `pg_get_viewdef` cambiando el FROM/JOIN de `compliance_documents cd ... WHERE cd.entity_type='transporter'` por `transporter_documents td` directo sobre `transporter_id`, análogo para driver/vehicle, y agregar `AND NOT t.baja_override` / `AND NOT d.baja_override` / `AND NOT v.baja_override` a la condición final de `eligible`. Igual para `v_transporter_compliance` si existe y depende de la fuente vieja.)

Luego:
```sql
CREATE OR REPLACE VIEW app.v_transporter_operational_status AS
SELECT
  t.id AS transporter_id,
  ve.eligible,
  ve.blocking_reasons,
  (t.last_matched_upload_id IS NOT NULL) AS matched_by_upload,
  CASE
    WHEN ve.eligible AND t.last_matched_upload_id IS NOT NULL THEN 'operativa'
    ELSE 'no_operativa'
  END AS operational_status
FROM app.transporters t
JOIN app.v_transporter_eligibility ve ON ve.transporter_id = t.id;
```

- [ ] **Step 3: Verificar — `eligible` no debe cambiar para ninguna fila (todas las baja_override están en `false` en este punto)**

Antes del Step 2, correr y guardar:
```sql
SELECT transporter_id, eligible FROM app.v_transporter_eligibility ORDER BY transporter_id;
```
Después del Step 2, correr la misma query y comparar fila por fila (mismo `transporter_id` → mismo `eligible`). Deben ser idénticas — si difieren, el repunte de fuente de datos introdujo un bug, no continuar.

También:
```sql
SELECT operational_status, count(*) FROM app.v_transporter_operational_status GROUP BY 1;
-- Esperado en este punto: 100% 'no_operativa' (nadie tiene last_matched_upload_id todavía, es esperado — no es un bug)
```

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130004_eligibility_views_v2.sql
git commit -m "feat(db): repunta vistas de elegibilidad a tablas de documentos nuevas, agrega v_transporter_operational_status"
```

---

### Task 5: Hygiene — search_path de funciones + consolidar políticas RLS duplicadas

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130005_hygiene_search_path_rls.sql`

**Interfaces:**
- Consumes: nada de tasks anteriores directamente (independiente, pero corre antes de Task 7 porque toca funciones que Task 7 podría dropear).

- [ ] **Step 1: Confirmar la lista vigente de funciones sin `search_path` y políticas RLS duplicadas**

```sql
-- Reproducir el advisor de seguridad para confirmar que la lista no cambió desde la auditoría de esta sesión:
```
Usar `mcp__claude_ai_Supabase__get_advisors` (`type: security`) y `get_advisors` (`type: performance`) — filtrar por `function_search_path_mutable` y `multiple_permissive_policies`. Confirmar contra esta lista conocida (de la auditoría previa) antes de aplicar, y usar la lista REAL devuelta por el advisor si difiere:

Funciones (`app`/`silver`, excluir `gold.*` — fuera de alcance de este módulo): `app.protect_manual_overrides`, `app.normalize_rut`, `app.rut_dv`, `app.audit_compliance_document_change`, `app.audit_insurance_installment_change`, `app.register_entity`, `app.set_updated_at`, `app.protect_manual_edits`, `silver.parse_centralizer_date`, `silver.parse_insurance_date`, `silver.map_doc_status`.

**`app.register_entity` y `app.audit_compliance_document_change` están atadas a `app.entities`/`app.compliance_documents`, que Task 7 va a dropear** — para estas dos, no aplicar solo el fix de `search_path`: confirmar con `SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgfoid = 'app.register_entity'::regoid;` (y análogo para `audit_compliance_document_change`) qué triggers las invocan, y dejarlas documentadas para que Task 7 las dropee junto con sus tablas (no fijar su `search_path` si de todas formas van a desaparecer en Task 7 — evitar trabajo redundante).

Tablas con políticas RLS `_read`/`_write` duplicadas para el mismo `SELECT`: `client_document_requirements`, `compliance_doc_catalog`, `driver_assignments`, `insurance_doc_catalog`, `insurance_documents`, `sync_config`, `transporter_contacts`, `vehicle_assignments`, `public.profiles`. **De estas, `driver_assignments`/`vehicle_assignments`/`insurance_doc_catalog`/`insurance_documents` se dropean en Task 7 — no consolidar sus políticas aquí, es trabajo perdido.** Consolidar solo: `client_document_requirements`, `compliance_doc_catalog`, `sync_config`, `transporter_contacts`. (`public.profiles` está fuera de este módulo — no tocar.)

- [ ] **Step 2: Escribir y aplicar**

```sql
ALTER FUNCTION app.normalize_rut(text) SET search_path = app, pg_catalog;
ALTER FUNCTION app.rut_dv(text) SET search_path = app, pg_catalog;
ALTER FUNCTION app.set_updated_at() SET search_path = app, pg_catalog;
ALTER FUNCTION app.protect_manual_overrides() SET search_path = app, pg_catalog;
ALTER FUNCTION app.protect_manual_edits() SET search_path = app, pg_catalog;
ALTER FUNCTION app.audit_insurance_installment_change() SET search_path = app, pg_catalog;
ALTER FUNCTION silver.parse_centralizer_date(text) SET search_path = silver, pg_catalog;
ALTER FUNCTION silver.parse_insurance_date(text) SET search_path = silver, pg_catalog;
ALTER FUNCTION silver.map_doc_status(text) SET search_path = silver, pg_catalog;
-- (ajustar la firma exacta de cada función — tipo(s) de parámetro — según lo que devuelva
--  \df app.normalize_rut / information_schema.routines si difiere de lo asumido aquí)

-- Consolidar RLS duplicada — ejemplo con client_document_requirements, replicar el mismo patrón
-- (leer la policy _read y _write existentes primero con pg_policies para no perder ninguna condición
--  de rol al fusionarlas) para compliance_doc_catalog, sync_config, transporter_contacts:
DROP POLICY IF EXISTS client_document_requirements_read ON app.client_document_requirements;
DROP POLICY IF EXISTS client_document_requirements_write ON app.client_document_requirements;
CREATE POLICY client_document_requirements_select ON app.client_document_requirements
  FOR SELECT USING (app.current_user_role() IS NOT NULL);
-- (recrear también las policies de INSERT/UPDATE/DELETE que existieran bajo "_write" si hacían más
--  que SELECT — revisar con pg_policies antes de fusionar, no asumir que _write era solo SELECT)
```

- [ ] **Step 3: Verificar**

Correr `get_advisors` (security + performance) de nuevo. El conteo de `function_search_path_mutable` para las funciones de este módulo debe bajar a 0 (excepto `register_entity`/`audit_compliance_document_change`, que quedan pendientes de Task 7). El conteo de `multiple_permissive_policies` para `client_document_requirements`/`compliance_doc_catalog`/`sync_config`/`transporter_contacts` debe bajar a 0.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130005_hygiene_search_path_rls.sql
git commit -m "fix(db): search_path en funciones custom, consolida políticas RLS duplicadas"
```

---

### Task 6: Congelar bronze + Mage/dbt

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130006_freeze_centralizer_pipeline.sql`
- Modify: `monitor-app/backend/supabase/pipelines/centralizer_to_app/README.md`

**Interfaces:** ninguna dependencia de otros tasks de este checkpoint; puede ejecutarse en paralelo con 1-5, pero se deja al final del orden por prolijidad del ledger.

- [ ] **Step 1: Escribir y aplicar la migración**

```sql
UPDATE app.sync_config
SET sync_enabled = false,
    note = 'Congelado 2026-07-12 — reemplazado por app.centralizer_uploads (upload manual con aprobación). Ver docs/superpowers/plans/2026-07-12-empresas-seguros-checkpoint-a-schema.md'
WHERE domain IN ('transporters','drivers','vehicles','compliance_docs','insurance');

COMMENT ON TABLE bronze.raw_centralizer_transporter IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_centralizer_drivers IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_centralizer_vehicles IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE bronze.raw_insurance_vehicles IS 'CONGELADO 2026-07-12 — ya no alimenta app.*. Fallback histórico/lectura únicamente.';
COMMENT ON TABLE ops.pipeline_runs IS 'CONGELADO 2026-07-12 — histórico del pipeline Mage retirado.';
COMMENT ON TABLE ops.pipeline_rejects IS 'CONGELADO 2026-07-12 — histórico del pipeline Mage retirado.';
```

- [ ] **Step 2: Actualizar el README del pipeline**

Agregar como primera línea del archivo `monitor-app/backend/supabase/pipelines/centralizer_to_app/README.md` (leer el archivo primero, no sobrescribir el resto):
```
> **DEPRECADO 2026-07-12** — reemplazado por upload directo a `app` con preview/diff y aprobación (ver `docs/superpowers/plans/2026-07-12-empresas-seguros-checkpoint-a-schema.md`). Este pipeline queda congelado (`sync_config.sync_enabled=false`), no se borra — es la referencia de la lógica de parseo que se portó a `centralizer_parser.py`.
```

- [ ] **Step 3: Verificar**

```sql
SELECT domain, sync_enabled FROM app.sync_config;
-- Los 5 dominios listados deben estar en false.
```

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130006_freeze_centralizer_pipeline.sql monitor-app/backend/supabase/pipelines/centralizer_to_app/README.md
git commit -m "chore(db): congela pipeline Mage/bronze de centralizer, reemplazado por upload en app"
```

---

### Task 6b: Repuntar dependencias restantes descubiertas por Task 7 (bloqueo real, no ejecutar Task 7 sin esto)

**Contexto del bloqueo**: al investigar el `DROP ... CASCADE` de `compliance_doc_catalog`, el implementador de Task 7 encontró (vía `pg_depend`, no solo `pg_constraint`) que `v_driver_eligibility`/`v_vehicle_eligibility` todavía leen `driver_assignments`/`vehicle_assignments` directo (Task 4 solo repunteó la fuente de *estado de documentos*, no esta dependencia), que las 3 vistas de elegibilidad/cumplimiento tienen una dependencia real (no solo FK) contra `compliance_doc_catalog`, que `app.v_sync_divergence` (nunca mencionada en este plan) lee `compliance_documents` directo, y que `app.notifications` tiene una FK real hacia `app.entities`. Ver `.superpowers/sdd/task-7-report.md` para el detalle completo de la investigación.

**Decisión**: `app.compliance_doc_catalog` **NO se dropea** — es una tabla chica de referencia (39 filas, sin el problema polimórfico del resto) que las vistas SQL de elegibilidad necesitan para calcular en la base; la lista estática en Python solo sirve para el parser del backend, no para las vistas SQL. Se retira de la lista de DROP de Task 7.

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130006b_repoint_remaining_deps.sql`

- [ ] **Step 1: Repuntar `v_driver_eligibility`/`v_vehicle_eligibility` para leer `transporter_id` directo**

Leer la definición actual de ambas vistas (`pg_get_viewdef`) y reemplazar la CTE `active_assignment` (hoy `SELECT driver_id, transporter_id FROM app.driver_assignments WHERE valid_to IS NULL`) por una lectura directa de `app.drivers.transporter_id`/`app.vehicles.transporter_id` (la columna que Task 2 ya pobló). Mantener el resto de la lógica exactamente igual — mismo principio que Task 4: repunte de fuente, no rediseño de fórmula.

- [ ] **Step 2: Retirar `v_sync_divergence`**

```sql
DROP VIEW IF EXISTS app.v_sync_divergence;
```
Justificación: era la vista de reconciliación entre `app.*` y el pipeline externo (`silver.stg_centralizer_*`), que ya está congelado (Task 6). Su propósito lo reemplaza el flujo de upload+diff+aprobación de Checkpoint D — no tiene reemplazo 1:1 en este checkpoint porque ese flujo aún no existe, es aceptable que quede sin vista de reconciliación hasta entonces.

- [ ] **Step 3: Soltar la FK de `notifications` hacia `entities`**

```sql
ALTER TABLE app.notifications DROP CONSTRAINT IF EXISTS notifications_entity_fkey;
```
`app.notifications` tiene 0 filas (confirmado en la auditoría de esta sesión) — no se pierde dato, solo se relaja una integridad referencial sobre una tabla sin uso real todavía. La tabla en sí no se toca más allá de esto.

- [ ] **Step 4: Verificar — mismo gate de Task 4 (eligible sin cambios)**

Capturar `(driver_id, eligible)`/`(vehicle_id, eligible)` de ambas vistas ANTES del Step 1, y de nuevo DESPUÉS — deben ser idénticas fila por fila (incluyendo el desglose de `blocking_reasons`, no solo el booleano). Además:
```sql
SELECT pg_describe_object(classid, objid, objsubid), deptype
FROM pg_depend WHERE refobjid = 'app.driver_assignments'::regclass AND deptype != 'i';
-- no debe listar ninguna vista (v_driver_eligibility ya no debe depender de esta tabla)
SELECT pg_describe_object(classid, objid, objsubid), deptype
FROM pg_depend WHERE refobjid = 'app.vehicle_assignments'::regclass AND deptype != 'i';
-- ídem
SELECT pg_describe_object(classid, objid, objsubid), deptype
FROM pg_depend WHERE refobjid = 'app.compliance_documents'::regclass AND deptype != 'i';
-- no debe listar v_sync_divergence (ya no existe)
SELECT to_regclass('app.v_sync_divergence');  -- debe ser NULL
SELECT conname FROM pg_constraint WHERE conrelid = 'app.notifications'::regclass AND confrelid = 'app.entities'::regclass;
-- debe ser 0 filas (la FK ya no existe)
```
Si algo no cuadra: BLOCKED, no continuar a Task 7.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130006b_repoint_remaining_deps.sql
git commit -m "fix(db): repunta v_driver/vehicle_eligibility a transporter_id directo, retira v_sync_divergence, suelta FK notifications->entities — desbloquea Task 7"
```

---

### Task 7: Limpieza destructiva (DROP) — solo tras Task 6b verificado (compliance_doc_catalog EXCLUIDO de esta lista)

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260712130007_drop_legacy_structures.sql`

**Interfaces:**
- Consumes: verificación de Task 2 (backfill de `transporter_id` 100% completo), Task 3 (documentos migrados 1:1), Task 4 (vistas repuntadas y `eligible` sin cambios), Task 5 (funciones/policies identificadas).

**Este task NO se dispatcha hasta que el controller (no el implementador) haya confirmado personalmente, leyendo los reportes de Tasks 2-5, que las 3 verificaciones de "cero pérdidas"/"conteo 1:1"/"eligible sin cambios" pasaron.** Si el implementador de este task encuentra, al re-verificar por su cuenta antes del DROP, cualquier discrepancia con lo que los reportes de Tasks 2-5 afirman, debe reportar BLOCKED y no ejecutar ningún DROP.

- [ ] **Step 1: Re-verificar inmediatamente antes de dropear (no confiar solo en los reportes de tasks previos — repetir las queries clave)**

```sql
SELECT count(*) FROM app.drivers WHERE transporter_id IS NULL;   -- debe ser 0
SELECT count(*) FROM app.vehicles WHERE transporter_id IS NULL;  -- debe ser 0
SELECT
  (SELECT count(*) FROM app.compliance_documents WHERE status IS NOT NULL) AS old_total,
  (SELECT count(*) FROM app.transporter_documents) + (SELECT count(*) FROM app.driver_documents) + (SELECT count(*) FROM app.vehicle_documents) AS new_total;
-- old_total debe ser igual a new_total
SELECT to_regclass('app.v_transporter_operational_status');  -- no debe ser NULL (la vista existe)
```

Si cualquiera de estas falla: **STOP, BLOCKED, no ejecutar Step 2.**

- [ ] **Step 2: Escribir y aplicar el DROP**

```sql
DROP TRIGGER IF EXISTS <nombre_trigger_register_entity> ON app.transporters; -- usar el nombre real hallado en Task 5 Step 1
DROP TRIGGER IF EXISTS <nombre_trigger_register_entity> ON app.drivers;
DROP TRIGGER IF EXISTS <nombre_trigger_register_entity> ON app.vehicles;
DROP TRIGGER IF EXISTS <nombre_trigger_audit_compliance_document_change> ON app.compliance_documents;

DROP FUNCTION IF EXISTS app.safe_update_transporter(uuid, jsonb);
DROP FUNCTION IF EXISTS app.register_entity() CASCADE;
DROP FUNCTION IF EXISTS app.audit_compliance_document_change() CASCADE;

DROP TABLE app.driver_assignments;
DROP TABLE app.vehicle_assignments;
DROP TABLE app.compliance_documents;
-- app.compliance_doc_catalog: EXCLUIDO de este DROP (decisión post-Task-6b — ver ese task).
-- Se mantiene permanentemente como tabla chica de referencia que las vistas SQL de elegibilidad
-- necesitan para calcular en la base.
DROP TABLE app.entities;
DROP TABLE app.stored_files;
DROP TABLE app.insurance_doc_catalog CASCADE;
DROP TABLE app.insurance_documents;
```

**Precondición de este task**: Task 6b debe estar completo y verificado (v_driver_eligibility/v_vehicle_eligibility ya no dependen de driver_assignments/vehicle_assignments; v_sync_divergence ya no existe; la FK de notifications hacia entities ya no existe) — de lo contrario los DROP de arriba van a fallar con un error de dependencia de Postgres (fallo seguro, sin pérdida de datos, pero bloquea el checkpoint).

- [ ] **Step 3: Verificar el estado final**

```sql
SELECT count(*) FROM app.client_document_requirements;  -- debe seguir siendo 39, con datos intactos
SELECT count(*) FROM app.transporters;  -- debe seguir siendo el mismo total de antes de todo el checkpoint
SELECT count(*) FROM app.drivers;
SELECT count(*) FROM app.vehicles;
SELECT count(*) FROM app.insurance_policies;  -- no debe haberse tocado en absoluto
```

Correr `get_advisors` (security + performance) una vez más — el conteo total de warnings debe ser menor al de la auditoría original de esta sesión.

- [ ] **Step 4: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260712130007_drop_legacy_structures.sql
git commit -m "refactor(db): retira estructura relacional sin uso real (entities, stored_files, tablas de asignación, catálogos polimórficos de documentos)"
```

---

## Self-Review Notes (para el controller, no para los implementadores)

- Cobertura: Tasks 1-7 cubren §1 y §2 completos del plan arquitectónico aprobado (congelamiento, identidad+matching, documentos angostos, vistas, hygiene, limpieza destructiva). §3/§4 (backend/frontend) son Checkpoints B/C/D/E/F, fuera de este documento.
- El orden Task 1→7 es intencional: todo lo destructivo va al final, y Task 7 tiene una re-verificación propia independiente de lo que reporten los tasks anteriores — es la salvaguarda contra un reporte de implementador incorrecto.
- Placeholders señalados explícitamente (`<nombre_trigger_...>`) en Task 7 Step 2 son intencionales — dependen de un valor que solo se conoce corriendo la query de Task 5 Step 1 contra la base viva; no es un placeholder de pereza, es información que no existe hasta ejecutar un paso anterior.
