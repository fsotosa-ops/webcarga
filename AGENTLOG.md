# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga
> Histórico completo en AGENTLOG_ARCHIVE.md — no es el histórico completo.

### 2026-07-16 — Reversión de arquitectura Empresas/Seguros: Checkpoints A-E descontinuados, `public` schema es la base definitiva

**Objetivo:** el usuario pidió sincronizar `monitor-app/docs/data-model/context_carriers.md`/`context_insurance.md` (modelo nuevo en schema `public`, polimórfico: `compliance_records`/`compliance_requirements`, M:N seguros/contactos, migraciones `20260715204925`…`20260716151048`) con backend/frontend.

**Decisión clave (revierte una decisión anterior con conocimiento de causa):** al auditar `AGENTLOG_ARCHIVE.md` se encontró que el 2026-07-12 el usuario había rechazado explícitamente un modelo muy similar (polimórfico, M:N) como "frankenstein", y en su lugar se construyeron los Checkpoints A-E (plano, sobre `app.transporters`/`drivers`/`vehicles`). Se le presentó este conflicto directamente antes de planear. El usuario confirmó, con ese contexto sobre la mesa, que es una decisión consciente: **todo lo de Checkpoints A-E queda descontinuado** (deuda técnica — "cero normalización, un sinfín de tablas y vistas"), y el schema `public` + las vistas materializadas ya creadas en `app` (`carrier_compliance_status`, `carrier_insurance_status`) son la base consistente hacia adelante. Historial completo de A-E movido a `AGENTLOG_ARCHIVE.md` con nota de cierre.

**Alcance de la pregunta, acotado por el usuario:** no es "migrar los 2792 transportistas legacy" — es **"qué falta en el schema `app` (y su soporte en `public`) para que el modelo quede operativo, robusto, escalable y normalizado, listo para integrarse por completo con backend/frontend."**

**Auditoría real contra Supabase (`viclzoftiudkepqnhekv`)** — hallazgos que quedaron documentados en el plan (ver abajo), resumen:
- Faltan `app.driver_compliance_status`/`app.asset_compliance_status` (solo existe `carrier_compliance_status`; `compliance_requirements` ya tiene 12 filas DRIVER + 9 ASSET reales sin vista que las materialice).
- Sin trigger de reconciliación de `compliance_records` cuando crece el catálogo o cambia `carrier_shippers` (2 de 36 requisitos ya son shipper-scoped, contra 11 shippers reales — no es teórico).
- Sin índice único parcial "un activo a la vez" en `driver_assignments`/`asset_assignments`; sin índice en `insurance_policies.carrier_id`.
- RLS: `insurance_policies`/`policy_coverages`/`policy_assets`/`insurance_installments`/`coverage_types` tienen `USING(true) WITH CHECK(true)` para `authenticated` — **corregir confirmado por el usuario**. El resto de tablas nuevas tiene RLS habilitado sin políticas (deniega todo salvo `service_role` — correcto si el acceso es 100% backend, a confirmar antes de construir).
- Las 4 migraciones del modelo nuevo están aplicadas en la base real pero **no aparecen en `list_migrations`** (el historial oficial de Supabase se detiene en `20260714015203`) — quedaron aplicadas fuera del libro, hay que regularizarlas.
- `app.audit_log` ya es polimórfico y reutilizable sin cambios.
- Puente real verificado con datos reales para el módulo del diario: `public.carriers.legacy_admin_id = app.transporter_profiles.admin_id` (242/246 matchean; 26/27 transportistas con viajes reales en `app.trip_fleet_links` matchean) — **no** usar `app.transporters.admin_account_id` (espacio de IDs distinto, solo 1 coincidencia espuria).

**Plan completo (checkpoints H0-H3) escrito en** `/Users/usuario/.claude/plans/necesito-que-analices-los-twinkly-stearns.md` — pendiente de aprobación del usuario (`ExitPlanMode` fue rechazado dos veces con feedback que sí se incorporó; la sesión se desvió a instalar `mage-agent` antes de aprobar el plan final).

**Desvío de esta sesión — mage-agent (Mage AI):** el usuario tiene pipelines de datos corriendo en Mage que alimentan el backend y pidió instalar `mage-agent` (MCP para gestionar pipelines Mage Pro) para profundizar contexto antes de decidir. Ya instalado y logueado por el usuario. Se creó `/Users/usuario/Desktop/projects/webcarga/.mcp.json`:
```json
{"mcpServers": {"mage-agent": {"command": "mage-agent", "args": ["mcp"]}}}
```
(confirmado que `mcpServers` va en `.mcp.json` de proyecto, no en `.claude/settings.json` — ese archivo no tiene esa key, solo referencias `enabledMcpjsonServers`/`disabledMcpjsonServers`). **Pendiente**: reiniciar/recargar Claude Code para que tome el `.mcp.json` nuevo y aprobar el servidor de proyecto la primera vez.

### 2026-07-16 (cont.) — Auditoría de pipelines Mage (`legacy-drivers-transporters` + `bronze_to_silver_insurance_sync`) contra el plan H0-H3: inconsistencias reales encontradas

**Método:** la API del MCP `pipeline_list`/`pipeline_get` devolvía listados de bloques incompletos/desactualizados (11 de 25 bloques reales en `legacy_drivers_transporters`). Se usó `sync_project_to_local` para bajar el proyecto Mage completo a disco (scratchpad, no persistido en el repo) y leer `metadata.yaml` + los `.sql`/`.py` reales de cada bloque.

**Hallazgos (bloqueantes para retomar H0-H3 sin resolverlos primero):**
1. **Ingesta duplicada y sin gate hacia `public.*`**: `legacy_drivers_transporters` ya tiene una cadena completa y **ejecutada** (`centralizer_eett_sharepoint → raw_centralizer_eett → load_shippers_01 → load_carriers_02 → load_drivers_03/load_assets_04 → load_driver_assignments_06/load_asset_asignments_07 → load_compliance_records_08 → load_carrier_compliance_status_10`) que hace upsert directo sobre `public.carriers/drivers/assets/carrier_shippers/driver_assignments/asset_assignments/compliance_records` desde el mismo Excel EETT que Checkpoint D procesa vía backend con diff/aprobación admin. El plan H2 no menciona este pipeline — compite por las mismas tablas sin ningún gate de aprobación.
2. **Bridge de H2.4 en riesgo de quedar stale**: `dbt/transporters/models/app/transporter_profiles.sql` (bloque `webapp_transporter_porfiles`) tiene hoy `config(materialized='table', schema='silver', alias='transporter_profiles_legacy')` — el macro `generate_schema_name` del proyecto respeta ese schema literal, así que la próxima corrida escribe en `silver.transporter_profiles_legacy`, no en `app.transporter_profiles`. El puente `legacy_admin_id = app.transporter_profiles.admin_id` (verificado con datos reales en la sesión anterior) puede congelarse sin aviso.
3. **Gap de la hoja Seguros (ya documentado como bloqueante en `project_empresas_seguros_plan.md`) probablemente ya se cargó igual**: ni `insurance_vehicles_sharepoint_connector.py` (lee `sheet_name=0` plano) ni los bloques `export_insurance_policies_base/policy_relations/installments_and_compliance.sql` delimitan o excluyen el bloque de conciliación no-uniforme a mitad de hoja. Todos en `status: executed`.
4. **Posible bug de matching RUT en seguros**: los loaders de Empresas arman `tax_id` como `RUT-DV`; los bloques de seguros hacen `c.tax_id = REPLACE(CAST(r.rut AS TEXT), '.', '')` sin agregar `-DV` — si la hoja no trae el DV pegado, el join no matchea ningún carrier, sin error visible.
5. **Los loaders de asignación van a romper con H1.3**: `load_driver_assignments_06.sql`/`load_asset_asignments_07.sql` insertan `status='ACTIVE'` con `ON CONFLICT DO NOTHING`, sin desactivar la asignación previa. En cuanto exista `UNIQUE(driver_id) WHERE status='ACTIVE'` (H1.3), este pipeline fallará en el primer conductor que cambió de empresa entre corridas.
6. **Carrera entre pipelines sobre la misma tabla bronze**: `legacy_drivers_transporters` (`insurance_vehicle_sharepoint.py`→`raw_insurance_vehicles.py`) y `bronze_to_silver_insurance_sync` (`insurance_vehicles_sharepoint_connector.py`→`load_raw_insurance_vehicles.py`) son casi el mismo archivo y ambos exportan a `bronze.raw_insurance_vehicles` con `if_exists='replace'` (uno además con `DROP TABLE ... CASCADE`).
7. **Seguridad (no relacionado al plan, pero real)**: `custom/insurance_vehicle_sharepoint.py` y `custom/insurance_vehicles_sharepoint_connector.py` tienen credenciales Graph API (`client_id`/`client_secret`/`tenant_id`) hardcodeadas en texto plano, a diferencia del resto del proyecto que usa `ConfigFileLoader(io_config.yaml)`.

**Estado actual de estos pipelines**: bloques `centralizer_eett_sharepoint` y `load_compliance_records_08` están en `status: failed` en su última corrida — la cadena de ingesta EETT está rota ahora mismo, no solo en riesgo futuro.

**Decisión de arquitectura definitiva (confirmada por el usuario, 2026-07-16):** Mage queda como el único motor de procesamiento/escritura hacia `public.*`. Esto **retira dos cosas por completo**, no solo una:
- El modelo dbt del proyecto `dbt/transporters` (`snapshot_transporters_data`/`webapp_transporter_porfiles` + snapshots `silver_transporters`/`silver_drivers`/`silver_vehicles`/`silver_trailers`) — ya no aplica, es el flujo legacy hacia `app.transporter_profiles`/`silver.transporter_profiles_legacy`.
- **El flujo de backend de Checkpoint D completo** (`centralizer_uploads.py`: carga de Excel + diff + aprobación admin antes de escribir) — el usuario lo calificó de deuda técnica también ("insisto, el nuevo modelo lógico, de datos y negocio es lo que vale para empresas y seguros"). El backend no vuelve a tener lógica de ingesta/diff/aprobación para Empresas/Seguros; su rol se limita a leer/servir lo que Mage puebla en `public.*`.
- Los bloques de respaldo legacy quedan **tal cual, sin tocar**, solo mapeados como lo que son (capa bronze de archivo de sistemas legacy, sin alimentar el modelo nuevo): `sharepoint_drivers`→`raw_info_eett` (`bronze.raw_info_conductores/equipos/contacto`), `raw_bd_ot_master`→`raw_bd_ot`→`bd_ot_master` (`bronze.raw_bd_ot`), `admin_customers`→`raw_admin_customers`, `admin_companies`→`raw_admin_companies`.

**Auditoría de datos reales (Supabase, no solo lectura de código) hecha tras la decisión** — corrige lo que se había flageado por código solamente:
- El join de RUT en los bloques de seguros **sí funciona**: 23/25 RUT distintos de `bronze.raw_insurance_vehicles` matchean `public.carriers` (el campo `rut` de la hoja ya trae el DV pegado, ej. `77.737.756-6`) — no era el bug sistemático que parecía por código. Quedan 2 RUT sin matchear, sin diagnosticar aún (¿empresa no cargada todavía, o formato distinto?).
- Sin rastro de corrupción del bloque no-uniforme de la hoja Seguros: 286 filas, 1 sola `póliza` nula, cero filas con texto de encabezado colado como dato. El riesgo seguía latente en el código (no hay lógica que delimite el rango), pero no se manifestó en esta corrida.
- Cero violaciones de "un activo a la vez" hoy en `driver_assignments`/`asset_assignments` — el índice único parcial de H1.3 no rompería nada si se aplicara ahora mismo, pero `load_driver_assignments_06`/`load_asset_asignments_07` siguen sin lógica de desactivación, así que puede romper en la próxima corrida si un conductor/patente cambió de empresa.

**Corrección importante sobre el alcance de H2 (el mismo día, tras auditar el código real):** "Mage centraliza el procesamiento de datos" se refiere a la **ingesta bulk/legacy** (Excel EETT, Excel Seguros, sistemas admin legacy) — no a la escritura operativa que dispara un usuario desde la UI (editar, dar de alta una empresa nueva, subir un documento, override de cumplimiento). Confirmado contra `monitor-app/docs/data-model/context_carriers.md`/`context_insurance.md` (los docs de diseño del propio usuario), que ya especifican esta separación: Mage = "ingesta operativa/dinámica desde las capas crudas"; backend = onboarding transaccional + endpoint de archivos + CRUD de contactos. Un sub-agente auditó el código real y confirmó: **hoy nada en el backend/frontend vivo escribe sobre `public.*`** — todo el CRUD/upload actual (`transporters.py`, `insurance.py`, `document_storage.py`, componentes del frontend) sigue sobre el schema viejo `app.*` (Checkpoints A-E). Los tres pilares del doc (onboarding transaccional, upload→`PENDING_REVIEW`+`metadata` JSONB, contactos polimórficos) no existen ni siquiera contra el schema viejo — es trabajo nuevo de punta a punta para H2, sobre una tabla limpia (sin ediciones manuales previas que proteger retroactivamente).

**Decisión de protección manual vs. sync de Mage (confirmada por el usuario):** columnas `is_manual_override BOOLEAN`, `overridden_by UUID REFERENCES auth.users(id)`, `overridden_at TIMESTAMPTZ` en las tablas que Mage puebla en bulk Y que H2 va a exponer para escritura de usuario (`carriers`, `drivers`, `assets`, `contacts`, `compliance_records`, `driver_assignments`, `asset_assignments`, `carrier_shippers`, `insurance_policies`, `policy_coverages`, `policy_assets`, `insurance_installments`). Los `ON CONFLICT DO UPDATE` de Mage deben respetar `NOT is_manual_override`; todo endpoint de escritura de H2 debe setear las 3 columnas + loguear en `app.audit_log`. Detalle completo incorporado al plan.

**El plan en `/Users/usuario/.claude/plans/necesito-que-analices-los-twinkly-stearns.md` quedó reescrito** con: un Checkpoint M nuevo (estabilizar/proteger Mage, prerrequisito de H0), H1.6 (migración de columnas de protección manual), H2.0 (retiro explícito de Checkpoint D del repo) y H2.2/H2.4 actualizados (onboarding manual vía UI sigue existiendo, distinto del bulk de Mage; el puente `app.transporter_profiles` queda marcado como dependiente de un modelo dbt retirado, a confirmar antes de construir esa parte). **Aún no aprobado para ejecución** — falta pasar por `ExitPlanMode`/confirmación explícita del usuario antes de empezar a codear cualquier checkpoint.

### 2026-07-16 (cont.) — Checkpoint M ejecutado (M.1, M.2 código, M.3, M.5 completos; M.4 bloqueado en acción del usuario)

El usuario decidió explícitamente **no rotar** las credenciales de Postgres/GCP en `io_config.yaml` (nadie más tuvo acceso), pero sí usar el secrets manager de Mage para las credenciales de Graph API en vez de texto plano — se ejecutó Checkpoint M con ese criterio. Método: se editaron los archivos en la copia local sincronizada (`sync_project_to_local`) y se empujaron con `sync_local_to_remote` (0 conflictos, 9 archivos), en vez de usar `block_update` directo (evita adivinar el schema exacto del payload).

- **M.1 (bloques `failed`)**: `centralizer_eett_sharepoint` y `load_compliance_records_08` corrieron limpio al reintentarlos individualmente (`run_block`) — la falla previa fue transitoria/en cascada, no un bug de código. Sin cambios necesarios.
- **M.2 (2 RUT sin matchear) — corrige lo reportado antes**: se confirmó que **sí hubo corrupción real** del gap de la hoja Seguros (contradice el "se ve limpio" de la auditoría anterior) — una fila tenía `rut='Compañía'`, el encabezado del bloque no-uniforme colado como dato. La otra era un bug de case-sensitivity (`dv` en minúscula). Fix: filtro regex `^[0-9.]+-[0-9kK]$` en `data_exporters/load_raw_insurance_vehicles.py` antes de exportar a bronze + `UPPER()` en el join de `export_insurance_policies_base/policy_relations/installments_and_compliance.sql`. Pendiente de verificación en vivo (necesita M.4 resuelto para re-correr el connector).
- **M.3 (fetch duplicado)**: `custom/insurance_vehicle_sharepoint.py` y `data_exporters/raw_insurance_vehicles.py` (en `legacy_drivers_transporters`) quedaron neutralizados (no-op real, no solo vacíos) — verificado corriendo el bloque completo que `bronze.raw_insurance_vehicles` se mantuvo en 286 filas sin pisarse. `bronze_to_silver_insurance_sync` queda como único dueño.
- **M.5 (asignaciones)**: `load_driver_assignments_06.sql`/`load_asset_asignments_07.sql` ahora desactivan (`status='INACTIVE'`) la asignación previa en otra empresa antes de insertar la nueva `ACTIVE`, y el `ON CONFLICT` pasó a `DO UPDATE SET status='ACTIVE'` (reactiva si vuelve a la misma empresa). Corrido y verificado sin error contra datos reales.
- **M.4 (credenciales) — CERRADO**: el usuario decidió no rotar las credenciales de Postgres/GCP existentes en `io_config.yaml` (nadie más tuvo acceso), y creó los 3 secrets de SharePoint ahí mismo (no en el secrets manager de Mage). Se ajustó el código de `get_secret_value()` a `ConfigFileLoader(io_config.yaml)` para matchear — mismo patrón que ya usa `raw_info_eett.py` para Postgres. Corrida completa (`execute_pipeline`) de `bronze_to_silver_insurance_sync` exitosa de punta a punta, 0 bloques fallidos.

**Checkpoint M queda completamente cerrado.** Verificación final contra Supabase real: `bronze.raw_insurance_vehicles` pasó de 286 a 283 filas (se descartaron las 3 filas basura del bloque no-uniforme de la hoja Seguros), 0 filas `rut='Compañía'`, **0 RUT sin matchear** contra `public.carriers` (eran 2 antes del fix).

### 2026-07-16 (cont.) — Checkpoint H0 ejecutado y cerrado

**H0.1 (RLS seguros)**: migración `20260716213312_h0_security_hardening_and_indexes.sql` dropeó las 4 políticas `ALL ... authenticated ... USING(true) WITH CHECK(true)` de `insurance_policies`/`policy_coverages`/`policy_assets`/`insurance_installments`. Verificado en `pg_policies`: solo queda `SELECT`/`authenticated` en esas 4 tablas (escritura ahora solo vía `service_role`/backend).

**H0.2 (higiene de migraciones) — encontró y corrigió un bug real**: al preparar el registro de las 4 migraciones "fuera del libro", se encontró que `20260715204925_init_compliance_engine.sql` tenía **todo el bloque de creación de tablas duplicado verbatim** (un `supabase db reset` habría fallado al segundo `CREATE TABLE public.shippers`). Se corrigió el archivo (dedupe) y se registraron las 4 migraciones reales en `supabase_migrations.schema_migrations` vía `psql` directo contra el pooler de Supabase (no `apply_migration`, para no re-ejecutar DDL ya aplicado en producción — algunas de esas sentencias ya no serían reproducibles, ej. `UPDATE ... SET tax_id = rut || '-' || dv` referencia una columna `rut` que la misma migración ya dropeó). Verificado con `list_migrations`: las 4 aparecen en el historial oficial.

**H0.3 (índices)**: `idx_insurance_policies_carrier_id` + índices únicos parciales `idx_driver_assignments_one_active`/`idx_asset_assignments_one_active` (`WHERE status='ACTIVE'`) — verificado sin duplicados antes de crear (0 violaciones, gracias al fix de Checkpoint M.5).

**H0.4 (`get_advisors`)**: encontró y corrigió 2 hallazgos reales del propio modelo — `search_path` mutable en `refresh_carrier_view()`/`refresh_insurance_view()` (fix: `ALTER FUNCTION ... SET search_path`), y 8 foreign keys sin índice de cobertura (`asset_assignments.carrier_id`, `driver_assignments.carrier_id`, `carrier_shippers.shipper_id`, `compliance_records.requirement_id`, `compliance_requirements.shipper_id`, `insurance_installments.policy_id`, `policy_assets.asset_id`, `policy_coverages.coverage_type_id`) — migración `20260716213508_h0_advisors_search_path_and_fk_indexes.sql`. El resto de advisories (RLS sin política en `carriers`/`drivers`/`assets`/etc.) es el patrón esperado (service_role-only, ya confirmado); lo demás (`current_user_role`, `handle_new_user`, `is_admin`, `auth_leaked_password_protection`, `materialized_view_in_api`) es de otros módulos o comportamiento intencional, fuera de alcance.

**Checkpoint H0 queda completamente cerrado.**

### 2026-07-16 (cont.) — Checkpoint H1 ejecutado y cerrado (+ M.6 desbloqueado)

**H1.6 (adelantado, desbloquea M.6)**: migración `20260716213752_h1_manual_override_columns.sql` — columnas `is_manual_override`/`overridden_by`/`overridden_at` agregadas a las 12 tablas del modelo. Verificado con `information_schema`.

**M.6 (ahora sí, desbloqueado)**: agregado `WHERE NOT <tabla>.is_manual_override` a los `ON CONFLICT DO UPDATE` de `load_carriers_02`, `load_drivers_03`, `load_compliance_records_08`, `load_driver_assignments_06`, `load_asset_asignments_07`, y al upsert de `compliance_records` en `export_insurance_installments_and_compliance`. Validado corriendo todos los bloques modificados contra datos reales: 0 fallos.

**H1.1/H1.2/H1.5 (una sola migración, `20260716214630`)**: `app.driver_compliance_status` (84 filas, matchea drivers reales) y `app.asset_compliance_status` (117 filas, matchea assets reales) creadas con el mismo patrón que la `carrier_compliance_status` vigente hoy — que resultó ser la versión **simple** (post-`migrate_to_global_tax_id`), no la rica en JSONB de la migración inicial (quedó reemplazada, dato para tener en cuenta en H2/H3: el payload de compliance por ahora no trae `compliance_documents`/`active_shippers` anidados). Roster nuevo: `app.carrier_driver_roster` (79 filas — 5 drivers sin asignación activa hoy, normal) y `app.carrier_asset_roster` (117 filas). `refresh_carrier_view()` extendida para refrescar las 5 vistas, con triggers nuevos sobre `driver_assignments`/`asset_assignments`/`UPDATE` de `carriers`.

**H1.3/H1.4 (`20260716214650`)**: triggers de reconciliación de catálogo (`compliance_requirements` nuevo → `MISSING` para las entidades existentes) y de `carrier_shippers` (alta/baja de relación → agrega/retira `compliance_records` shipper-scoped, respetando `is_manual_override`). Ambos **verificados con INSERT+ROLLBACK contra datos reales** (no solo revisión de código): el trigger de catálogo generó 246 `MISSING` (uno por carrier) para un requirement de prueba; el de `carrier_shippers` generó el `MISSING` esperado contra el único requirement shipper-scoped real (`ANEXO_REPLEG`/Walmart). Ninguna fila de prueba quedó persistida (rollback limpio).

**Checkpoint H1 queda completamente cerrado.**

### 2026-07-16 (cont.) — Auditoría de credenciales pendiente en `legacy_drivers_transporters` (el usuario detectó lo que se me había escapado en Checkpoint M) + validación completa contra H0/H1

El usuario notó que `centralizer_eett_sharepoint.py` (la fuente real del modelo de Empresas) también tenía credenciales hardcodeadas — en Checkpoint M solo había corregido los 2 conectores de seguros, sin hacer un grep completo del resto del pipeline. Al revisar el flujo completo aparecieron **3 archivos más** con el mismo patrón (mismo Azure AD app en los 5): `custom/centralizer_eett_sharepoint.py`, `custom/sharepoint_drivers.py`, `custom/raw_bd_ot_master.py`. Los 3 corregidos al mismo patrón `ConfigFileLoader(io_config.yaml)` que ya usa el resto del proyecto. `data_loaders/admin_customers.py`/`admin_companies.py` se revisaron y ya estaban limpios (usan `ConfigFileLoader` para MySQL).

**Validación end-to-end de todo `legacy_drivers_transporters` contra el schema H0+H1** (no solo lectura de código): se corrieron uno por uno los 13 bloques relevantes (`centralizer_eett_sharepoint`, `sharepoint_drivers`, `raw_bd_ot_master` con las credenciales nuevas, sus exporters, y toda la cadena `load_shippers_01→load_carriers_02/drivers_03/assets_04→load_carrier_shippers_05→load_driver_assignments_06/load_asset_asignments_07→load_compliance_records_08→load_carrier_compliance_status_10`) — **0 fallos**, incluyendo `load_carrier_shippers_05` que dispara el trigger nuevo de H1.4. Conteos finales coherentes: 246 carriers, 85 drivers, 117 assets, 42 carrier_shippers, vistas de H1 con las mismas cantidades, **0 violaciones** de los índices únicos parciales de H0.3. Los bloques de respaldo legacy (`sharepoint_drivers`→`raw_info_eett`, `raw_bd_ot_master`→`raw_bd_ot`→`bd_ot_master`) siguen sin tocar el modelo nuevo, solo se validó que corren limpio con las credenciales corregidas.

### 2026-07-16 (cont.) — Checkpoint H2.0 ejecutado (retiro de Checkpoint D)

Eliminado del repo: backend (`routers/centralizer_uploads.py`, `schemas/centralizer_upload.py`, `services/centralizer_diff.py`/`centralizer_parser.py`, 4 tests + fixture), frontend (`lib/api/centralizerUploads.ts`, `hooks/useCentralizerUploads.ts`, `CentralizerUploadModal`+test, `UploadDiffView`+test, página `/dashboard/uploads` completa, link "Uploads" del `Sidebar.tsx`). `main.py` sin el import/`include_router` del router retirado. Confirmado antes de tocar nada que `TripBulkUpload` (feature del Diario) es independiente y no se toca.

Nota operativa: el primer `git rm` de todo el lote abortó **atómicamente** por 3 archivos con modificaciones locales previas (no de esta sesión) — hay que revisar archivo por archivo cuando `git rm` falla, no asumir que borró el resto del lote.

**Verificado, no solo asumido:** `pytest` 131 passed (bajó de 193 al sacar los tests de centralizer, sin fallos nuevos), `npx tsc --noEmit` limpio, `npx vitest run` 349 passed / 47 archivos. No se corrió `npm run build` (producción) todavía.

### 2026-07-16 (cont.) — `audit_log` movido a `public` + `services/audit.py` (prerrequisito de H2)

El usuario cuestionó por qué dejar `app.audit_log` como deuda técnica en vez de dejarlo limpio desde el inicio. Al re-auditar el repo completo (no solo routers) se encontró que mi justificación anterior para diferirlo era **incorrecta**: había asumido que `trips.py` también lo usaba (scope-creep hacia el Diario) — no es así, el grep completo del repo confirma que las únicas referencias vivas eran `transporters.py`/`insurance.py` (se borran en H2 igual) y `document_storage.py` (se toca en H2.4 de todas formas). Sin costo de scope-creep real, se corrigió ahora:

- Migración `20260716223636_h2_move_audit_log_to_public.sql`: `ALTER TABLE app.audit_log SET SCHEMA public;` — verificado (18 filas preservadas, RLS intacto, `app.audit_log` ya no existe).
- Las 6 referencias vivas al string `app.audit_log` (transporters.py x5, insurance.py, document_storage.py x2, 3 tests) actualizadas a `public.audit_log`, archivo por archivo con el editor (no `sed` en lote, a pedido del usuario).
- `app/services/audit.py` nuevo: `log_change()` (solo inserta en `public.audit_log`) y `record_manual_edit()` (setea `is_manual_override/overridden_by/overridden_at` + audit log en un solo llamado, whitelist de las 12 tablas de H1.6, soporta PK compuesta para `policy_coverages`/`policy_assets`). Reemplaza el patrón de INSERT duplicado 5 veces que tenía `transporters.py`.
- 7 tests nuevos (`test_audit.py`). Suite completa: **138 passed**.

**Decisión de estructura para el resto de H2** (routers por entidad, no un `transporters.py` monolítico; reusa `get_current_user`/`require_editor`/`get_pool` tal cual existen; transacciones `conn.transaction()` mismo patrón que `trips.py`; paginación `page`/`limit` mismo shape que `trips.py`; sin ORM, sin caching nuevo — las vistas materializadas de H1 ya son la optimización). **Sin flag de coexistencia** para el cutover — `transporters.py`/`transporters_legacy.py`/`insurance.py` actual se borran una vez que los nuevos pasen tests (el usuario correctamente señaló que un flag de rollback hacia `app.transporters`, que Mage ya no alimenta, serviría datos congelados en silencio — peor que no tener fallback).

### 2026-07-16 (cont.) — Checkpoint H2.1 ejecutado (schemas Pydantic)

8 archivos nuevos en `app/schemas/`: `common.py` (`EntityType`, `PaginatedResponse` — reemplaza el de `transporter_relational.py`), `carrier.py`, `contact.py`, `driver.py`, `asset.py`, `assignment.py` (alta de `driver_assignments`/`asset_assignments`/`carrier_shippers`), `compliance.py`, `insurance_v2.py`. El sufijo `_v2` en insurance es temporal — `schemas/insurance.py` sigue siendo el del router viejo hasta que `routers/insurance.py` se borre junto con su reemplazo listo (mismo momento, no antes).

Mismo estilo que `transporter_relational.py` (bodies `Optional[...]` para PATCH, `field_validator` para normalización, `Literal` para enums) pero con los valores reales de los `CHECK` constraints de las tablas nuevas (`compliance_records.status` tiene 7 valores, no los 5 legacy; `insurance_policies.status`/`insurance_installments.payment_status` de las migraciones de seguros). `CarrierCreateBody` lleva el comentario de que el onboarding manual (H2.2) es distinto del bulk-load de Mage.

11 tests nuevos (`test_schemas_public.py`) cubriendo normalización y rechazo de valores fuera de los `Literal`. Suite completa: **149 passed**.

### 2026-07-16 (cont.) — Gap real encontrado al diseñar H2.2: reconciliación de compliance solo funcionaba en una dirección

Al diseñar la siembra de `compliance_records` para `POST /carriers`, se verificó contra datos reales cuántos registros existían para requisitos `LEGAL_MANDATORY` — el resultado: **9 de 12 requisitos CARRIER en 0/246, los 12 requisitos DRIVER en 0/85, 7 de 9 requisitos ASSET en 0/117**. Causa: el trigger de H1.3 (`reconcile_new_requirement`) solo reconcilia en una dirección (requirement nuevo → entidades existentes) — nunca existió la dirección inversa (entidad nueva → requirements existentes), así que ni el onboarding manual futuro ni las altas bulk de Mage (`load_carriers_02`/`load_drivers_03`/`load_assets_04`) dejaban sembrado ningún `MISSING`. Las vistas `app.driver_compliance_status`/`app.asset_compliance_status` de H1.1 mostraban `total_requirements=0` para todo conductor y vehículo.

**Resuelto con confirmación explícita del usuario** (opción: trigger + backfill ahora, antes de seguir con H2.2): migración `20260716230029_h2_reconcile_new_entities_and_backfill.sql` — 3 triggers nuevos (`trg_reconcile_new_carrier/driver/asset`, dirección inversa de H1.3, disparan en `AFTER INSERT`) + backfill único contra los 246/85/117 ya cargados. Verificado: 0 requisitos `LEGAL_MANDATORY` con cobertura incompleta; `driver_compliance_status` ahora muestra 12/12 por conductor, `asset_compliance_status` 7 (los `LEGAL_MANDATORY`) por activo, `carrier_compliance_status` 12-14 según si el carrier tiene relación con un shipper.

Con esto, el `POST /carriers` de H2.2 queda simple: el `INSERT` del carrier ya dispara la siembra vía trigger, no hace falta duplicar esa lógica en Python.

### 2026-07-16 (cont.) — Checkpoint H2.2 ejecutado (routers de Empresas)

4 routers nuevos (`carriers.py`, `drivers.py`, `assets.py`, `contacts.py`) registrados en `main.py` — conviven con `/transporters` viejo (prefixes distintos, sin flag) hasta que H2.3 termine y se borren juntos.

- `carriers.py`: `GET /carriers` (lista desde `app.carrier_compliance_status`), `GET /carriers/{id}` (detalle anidado: carrier + contactos + `compliance_records` con `is_expired`/`is_expiring_soon` calculados), `POST /carriers` (onboarding transaccional — el `INSERT` ya dispara `trg_reconcile_new_carrier`, no hay que duplicar la siembra en Python), `PATCH /carriers/{id}` (optimistic lock + `is_manual_override` vía `record_manual_edit`), alta/baja de `driver_assignments`/`asset_assignments` (desactiva la asignación previa, mismo criterio que Mage M.5), contactos anidados.
- `drivers.py`/`assets.py`: master data CRUD independiente de a qué carrier estén asignados.
- `contacts.py`: `PATCH`/`DELETE` flat por id (el alta queda anidada bajo `/carriers/{id}/contacts`).
- `tests/conftest.py` nuevo: `wire_transactional_conn()` compartido (antes duplicado inline solo en `test_trip_create.py`).

**Encontrado y corregido en el proceso** (validando contra la base real, no solo con los tests mockeados): `public.carriers.operational_status` usa `ACTIVE`/`LEGACY_INACTIVE` en datos reales (38/208), no `ACTIVE`/`INACTIVE` que había asumido al escribir el schema — `schemas/carrier.py` corregido antes de cerrar el checkpoint. Las 4 queries clave de los routers (list view, detail, `compliance_records` anidado, roster) se probaron con `execute_sql` directo contra Supabase para confirmar que son válidas contra el schema real, no solo contra los mocks de los tests.

29 tests nuevos. Suite completa: **179 passed**.

### 2026-07-16 (cont.) — Checkpoint H2.3 ejecutado (router de Seguros)

`routers/policies.py` nuevo, prefix `/policies` (no `/insurance` — evita colisión con el router viejo hasta que se borre junto con `transporters.py`/`transporters_legacy.py` al cerrar H2, mismo criterio que `insurance_v2.py` en H2.1).

- `GET`/`PATCH /policies/{id}`: detalle anidado (coberturas + activos + cuotas), optimistic lock + `is_manual_override` vía `record_manual_edit` (entity_type='CARRIER', entity_id=carrier_id de la póliza — no el policy_id, para ser consistente con cómo Mage ya integra seguros al motor de cumplimiento).
- `POST`/`DELETE /policies/{id}/coverages` y `/assets`: el M:N real (`policy_coverages`/`policy_assets`) que reemplaza las columnas planas `coverage`/`plate` del modelo viejo.
- `GET /policies/{id}/installments` + `PATCH /policies/installments/{id}`: cuotas.
- `GET`/`POST /carriers/{id}/policies` (en `carriers.py`): listado desde `app.carrier_insurance_status`, alta anidada bajo el carrier (mismo patrón que drivers/assets/contacts).

12 tests nuevos. Validado con `execute_sql` directo contra Supabase (list view, detalle, coberturas, installments) — todas las queries funcionan contra el schema real, no solo contra los mocks. Suite completa: **191 passed**.

### 2026-07-16 (cont.) — Checkpoint H2.4 ejecutado (endpoint de archivos)

`routers/compliance.py` nuevo: `GET`/`PATCH /compliance-records/{id}` (override libre de status/expiration_date), `POST /{id}/file` (reusa `upload_document_version()` de `document_storage.py` — a diferencia de la implementación vieja, este **fuerza `status='PENDING_REVIEW'`** y persiste `storage_path`/`file_name`/`mime_type`/`size_bytes` en el JSONB `metadata`, tal como pide `context_carriers.md` §4.2), `GET /{id}/files` (historial, reusa `get_document_history()` existente sin cambios). Si ya había un archivo previo, además loguea `document_replace` (reusa `log_document_replacement()`) — dos entradas de auditoría distintas por corrida (`document_upload` del `record_manual_edit` + `document_replace` del reemplazo), verificado con test dedicado.

9 tests nuevos. Suite completa: **200 passed**.

**H2 (Empresas + Seguros) tiene ahora toda la superficie de escritura construida**: onboarding, CRUD, asignaciones, pólizas M:N, archivos — todo con `is_manual_override`/auditoría wireados desde el primer commit de cada router, no como parche posterior.

### 2026-07-16 (cont.) — Cierre de H2: código viejo de Checkpoint A-E borrado

Borrados: `routers/transporters.py`, `transporters_legacy.py`, `insurance.py`; `schemas/transporter.py`, `transporter_relational.py`, `insurance.py` (viejo); `tests/test_transporters_relational.py`, `test_insurance.py`. `schemas/insurance_v2.py` renombrado a `insurance.py` definitivo (imports actualizados en `carriers.py`/`policies.py`/tests). `main.py` sin el flag `TRANSPORTERS_BACKEND` ni los routers viejos. `config.py` sin `transporters_backend` (`sharepoint_client_*` se dejaron intactos — son de `sharepoint_client.py`, módulo distinto). `policies.py` queda con prefix `/policies` definitivo (no se renombra a `/insurance` — consistente con `/carriers`/`/drivers`/`/assets`/`/contacts` como recursos flat, no bajo una sombrilla de dominio).

Verificado: la app arranca con 51 rutas registradas, cero residuos de `/transporters` o del `insurance` viejo. Suite completa: **125 passed** (200 − 75 tests del código borrado).

**Checkpoint H2 (Empresas + Seguros) queda completamente cerrado.** Guardada memoria de que la auditoría del backend del Diario (`trips.py`/`app.trips`, ajustes de columnas) es trabajo futuro explícitamente fuera de este alcance — ver `project_diario_backend_audit_pending.md`.

### 2026-07-16 (cont.) — Checkpoint H3 arrancado: capa 1 (types.ts + lib/api/) completa

Secuencia elegida por el usuario: capas primero (tipos + API completos para ambos módulos), componentes en una segunda pasada.

- `lib/types.ts`: bloque Empresas/Seguros de Checkpoint A-E reemplazado por el modelo nuevo (`Carrier`, `ComplianceRecord`/`ComplianceRecordDetail` — **son shapes distintos**, el anidado en `GET /carriers/{id}` no es el mismo que el standalone `GET /compliance-records/{id}` — `Contact`, `Driver`, `Asset`, `InsurancePolicy`, `PolicyCoverage`, `PolicyAsset`, `InsuranceInstallment`, `CoverageType`), verificado campo a campo contra las respuestas reales del backend, no solo copiado de memoria.
- Limpieza adicional encontrada de paso: bloque de tipos de Centralizer (`CentralizerDiff`, `CentralizerUploadSummary`, etc.) y `components/dashboard/ColumnMappingResolver.tsx`+test habían quedado **huérfanos** desde que se borró Checkpoint D en H2.0 — nadie los importaba. Borrados.
- 6 archivos nuevos en `lib/api/`: `carriers.ts`, `drivers.ts`, `assets.ts`, `contacts.ts`, `policies.ts`, `compliance.ts` — mapeo 1:1 contra los routers de H2.
- Backend: se agregó `GET /coverage-types` (faltaba — el frontend necesita listar los tipos de cobertura para el selector de pólizas). Validado contra Supabase real.

**Regresión real encontrada y corregida**: 4 archivos del Diario (`TripTable.tsx`, `TripCreateSlideOver.tsx`, `TripSlideOver.tsx`, `app/dashboard/diario/page.tsx`) importaban `lib/api/transporters` (borrado en H2) para dos features cruzadas con Empresas:
1. Alertas de vencimiento por RUT/patente (`GET /transporters/compliance-alerts/summary`) — sin equivalente en el backend nuevo. Queda con un tipo local en `TripTable.tsx` (`AlertStatus`/`ComplianceAlertSummary`, exportado) siempre `null` — degradación limpia, no se muestran alertas, comentario `TODO(H2.6)`.
2. Buscador de "vincular empresa al viaje" (`EmpresaSelector` en `TripCreateSlideOver`, `TransporterAssignSection` en `TripSlideOver`) — un swap directo a `carriersApi` **hubiera compilado pero roto la función en silencio**: `app.trip_fleet_links.transporter_id` hace `JOIN` contra `app.transporter_profiles.id` (Checkpoint A-E), no contra `public.carriers.id` (espacio de UUID distinto). Con confirmación explícita del usuario, ambos quedaron **deshabilitados** (input con mensaje, sin llamada a ningún API) en vez de mandar un id que nunca va a matchear. Mismo `TODO(H2.6)` en el código.

Verificado: `tsc --noEmit` bajó de 182 a 169 errores / 50 a 46 archivos (los 4 de Diario quedaron limpios, cero regresión nueva en el resto). `vitest` de los 3 componentes tocados: 53 passed (1 test ajustado al nuevo placeholder del input deshabilitado).

Los 46 archivos restantes con error son **todos** Empresas/Seguros genuinos — sin más fugas cruzadas a otros módulos. Es el alcance real de la fase 2 (componentes).

### 2026-07-16 (cont.) — Commit y push de toda la sesión (Checkpoints M, H0, H1, H2, H3 capa 1)

Commit `5955c5f` en `dev`, pusheado a `origin/dev` (`10cb9b3..5955c5f`). 82 archivos, staging manual (no `git add -A`) para excluir explícitamente lo ajeno a esta sesión: ~70 migraciones de Checkpoints A-E ya marcadas para borrar por una sesión anterior (deletion pendiente, no tocada), `.pyc`/`__pycache__`, `venv/`, `node_modules/`, y varios archivos sueltos sin relación (`processor_qanalytics_mage.py`, `monitor-app/index.html`, etc.) que ya estaban untracked en el working directory antes de esta sesión.

Alcance del commit: Checkpoint M completo (Mage: credenciales, dedupe, gap de RUT, "un activo a la vez"), H0 completo (RLS, migraciones regularizadas, índices, advisors), H1 completo (vistas, reconciliación bidireccional + backfill, `is_manual_override`), H2 completo (backend nuevo, `audit_log` movido, Checkpoint D retirado), H3 capa 1 (types + `lib/api/` + fix de regresión en Diario). Los cambios de Mage en sí (pipelines) ya estaban aplicados directo en el proyecto Mage real vía `sync_local_to_remote` — no viven en este repo git.

**Sesión cerrada acá.** Próxima sesión arranca directo en H3 fase 2 (componentes).

#### Próximo paso exacto
1. [ ] Checkpoint H3 fase 2: reescribir los ~24 componentes + 2 páginas de Empresas/Seguros contra los tipos/API nuevos (ya commiteados). Correr `npx tsc --noEmit` en el frontend al arrancar para tener la lista actualizada de archivos pendientes (era 46 al cierre de esta sesión, todos genuinamente Empresas/Seguros — sin fugas a otros módulos).
2. [ ] H2.6 (decisión pendiente, sigue sin resolver desde Checkpoint M): si/cómo el módulo del Diario debe mostrar compliance/seguro del carrier — ahora también condiciona reactivar `EmpresaSelector`/`TransporterAssignSection`/las alertas de `TripTable` (quedaron con `TODO(H2.6)` explícito en el código). **No iniciar sin que el usuario lo pida explícitamente** — fuera de alcance (ver memoria de auditoría de Diario pendiente).
3. [ ] Pendientes de sesiones anteriores (ya no bloqueantes para este workstream): cruces Cobranza↔Pólizas, cableado real del botón "Pagar" de Cobranza, mapeo `doc_code`↔cliente (Fabián), decidir qué hacer con las ~70 migraciones de Checkpoints A-E ya marcadas para borrar (deletion pendiente en el working tree, no de esta sesión, sin commitear).
2. [ ] H2.0: retirar del repo `centralizer_uploads.py`, `centralizer_parser.py`, `centralizer_diff.py` y el frontend de `/dashboard/uploads` una vez confirmado que no se reutiliza nada.
3. [ ] H2.4: confirmar si `app.transporter_profiles` se sigue refrescando por algún medio (el modelo dbt que lo hacía quedó retirado en Checkpoint M) antes de construir la integración con el módulo del diario.
4. [ ] Tener presente para H2/H3: `app.carrier_compliance_status` vigente es la versión simple (sin `compliance_documents`/`active_shippers` JSONB anidados) — si el frontend necesita ese detalle habrá que ampliarla, no asumir que ya está.
5. [ ] Pendientes de sesiones anteriores (ya no bloqueantes para este workstream): cruces Cobranza↔Pólizas, cableado real del botón "Pagar" de Cobranza, mapeo `doc_code`↔cliente (Fabián), decidir push a remoto del historial acumulado de Checkpoints A-E (nada se pusheó desde `ad6afa8`).

---
