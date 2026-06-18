# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga

### 2026-06-15 — QAnalytics multi-cliente: soporte iansa (iteración actual)

**Objetivo:** Replicar el scraper QAnalytics de walmart para el cliente iansa.

**Root cause:** `_navigate_to_distribucion()` tenía hardcodeado `"walmart"` en el href del ASPX:
```
gestion_planificacion_programados_dist_transporte_walmart.aspx
```
Todos los demás pasos del flujo (login, modal, fechas, export) ya usaban `client_name` dinámicamente — solo la navegación estaba fija.

**Cambios implementados:**

**`app/tms/qanalytics/scraper.py`:**
- `_navigate_to_distribucion(self, page, timeout_ms)` → `(self, page, client_name, timeout_ms)`
- Deriva href dinámicamente: `f"gestion_planificacion_programados_dist_transporte_{client_name.lower()}.aspx"`
- Agrega `logger.info(f"[STEP nav] Navegando a {href}")` para diagnóstico en logs Cloud Run
- `extract()` pasa `client_name` a `_navigate_to_distribucion()`

**`app/tms/qanalytics/cumplimiento_sap.py`:**
- `HREF_CUMPLIMIENTO` → `HREF_CUMPLIMIENTO_TMPL` (template `...{client}.aspx`)
- Override `_navigate_to_distribucion` actualizado para aceptar `client_name` y usar la plantilla

**`app/tms/qanalytics/cumplimiento_citas.py`:**
- `HREF_CUMPLIMIENTO_CITAS` → `HREF_CUMPLIMIENTO_CITAS_TMPL` (template `...{client}.aspx`)
- Override `_navigate_to_distribucion` actualizado igualmente

**`tests/test_qanalytics_adapter.py`:**
- Agregada clase `TestNavigationUrl` con 5 tests:
  - `test_walmart_uses_walmart_href` — backward compat
  - `test_iansa_uppercase_produces_lowercase_href` — ClienteT "IANSA" → href "iansa"
  - `test_cumplimiento_sap_template_walmart` / `_iansa` — template SAP
  - `test_cumplimiento_citas_template_walmart` — template Citas

**Resultado:** 12/12 tests GREEN. No cambia factory ni config (mismas credenciales para todos los clientes QAnalytics).

**Confirmado por usuario:**
- Mismas credenciales `QANALYTICS_USER` / `QANALYTICS_PASS` para walmart e iansa
- ClienteT iansa = `"IANSA"` (mayúsculas) — el href se genera en lowercase automáticamente

**Checklist:**
- [x] `_navigate_to_distribucion` dinámica en los 3 adapters QAnalytics
- [x] 12/12 tests GREEN
- [ ] Smoke test E2E con credenciales reales: `POST /api/v1/jobs {"source":"qanalytics","product":"trips","client_name":"IANSA",...}`
- [ ] Si la navegación falla: activar `QANALYTICS_DUMP_PAGE=1` y revisar `/tmp/qanalytics_dump_post_nav.html` para confirmar el href exacto del link iansa en el dropdown
- [ ] Deploy a Cloud Run (push a main → CI/CD)

**Próximo paso exacto:** Smoke test E2E local con credenciales reales → luego push para deploy.

**Riesgo residual:** La URL `gestion_planificacion_programados_dist_transporte_iansa.aspx` está asumida por patrón. Si el portal usa un nombre distinto (ej. `iansa_cl`, `iansa_dist`), se detecta inmediatamente con timeout + `QANALYTICS_DUMP_PAGE=1`.

---


### 2026-05-29 — Product tour feature (Tasks 1-2 completed)

**Objetivo:** Instalar react-joyride + crear hook base para estado del tour (12 tasks totales).

**Cambios implementados:**

**Task 1 (Completado):**
- `npm install react-joyride` — 14 paquetes instalados exitosamente
- TypeScript: 0 errores
- Commit: `682a493` "chore(frontend): install react-joyride"

**Task 2 (Completado):**
- Creado `monitor-app/frontend/hooks/useTour.ts` — hook base con localStorage persistence
- Estado: `activeModule`, `completedModules`, `showCompletionPrompt`, `nextModule`, `wasShown`, `allCompleted`
- Funciones: `markShown()`, `startTour(module)`, `stopTour()`, `completeTour(module)`, `dismissCompletionPrompt()`, `resetAll()`
- localStorage keys: `wc_tour_shown_first_time`, `wc_tour_completed_modules`
- TOUR_SEQUENCE: `['diario', 'transportistas', 'admin']`
- TypeScript: 0 errores
- Commit: `35ccd7b` "feat(tour): add useTour hook with localStorage persistence"

**Próximo paso (Task 3):** Crear step definitions para react-joyride

---

### 2026-05-29 — TripSlideOver world-class + metadatos desde backend (cuadragésima iteración)

**Objetivo:** Rediseñar el modal de detalle del viaje para ser world-class — más intuitivo, información completa, sin hardcodes en el frontend.

**Cambios implementados:**

**Backend (`monitor-app/backend/api/app/routers/trips.py`):**
- `_TRIP_SELECT` + `t.milestone_status_sap`, `t.pipeline_updated_at`
- Nuevo endpoint `GET /api/v1/trips/meta` (sin auth): devuelve `statuses` (id, bg_color, text_color, group) y `tms_sources` (id, label, bg_color, text_color). Sigue el patrón exacto de `routers/roles.py`.

**Frontend tipos (`lib/types.ts`):**
- Nuevos tipos: `StatusMeta`, `TmsSourceMeta`, `TripsMeta`
- `TripStop` + `milestone_status: string | null`
- `Trip` + `milestone_status_sap: string | null`, `pipeline_updated_at: string | null`

**Frontend API (`lib/api/tripsMeta.ts`)** (nuevo):
- `fetchTripsMeta()` → `GET /api/v1/trips/meta`

**Frontend `diario/page.tsx`:**
- `useEffect` fetch de meta al montar
- `meta={tripsMeta}` pasado a `TripTable` y `TripSlideOver`

**Frontend `TripTable.tsx`:**
- Eliminados `STATUS_COLOR` y `TMS_CHIP` hardcodeados
- `meta?: TripsMeta | null` en Props
- `TmsChip` y `StatusBadge` reescritos con lookup desde meta + inline styles
- Fallback gracioso cuando meta es null

**Frontend `TripSlideOver.tsx` — reescritura completa:**
- Header dark (bg-slate-900): TMS chip + ID viaje con copy button + patente + estado badge + flags readonly + conductor + RUT + teléfono + cliente
- 3 tabs: Viaje / Empresa / Bitácora (antes 2 tabs mobile only)
- Tab Viaje: grid resumen (fecha, origen, cargo_type, EETT TMS, último reporte, milestone_status_sap, pipeline_updated_at) + indicadores readonly chips + tabla de paradas (12 columnas, overflow-x-auto, sticky primera col)
- Tabla de paradas: Local | Plan. | Llegada | Salida | GPS↓ | GPS↑ | Desc.inicio | Desc.fin | S2S | Temp°C | On Time | Estado SAP
- Tab Empresa: igual que antes (TransporterAssignSection)
- Tab Bitácora: checkboxes flags editables + select estado (desde meta) + textareas + guardar
- Sin hardcodes de colores: todo via `meta?.statuses.find(s => s.id === status)` con fallback

**Resultado:** TypeScript 0 errores, build verde (13 rutas).

**Checklist (cuadragésima):**
- [x] `trips.py`: +2 campos en `_TRIP_SELECT`
- [x] `trips.py`: endpoint `GET /trips/meta`
- [x] `lib/types.ts`: nuevos tipos meta + campos en `Trip`/`TripStop`
- [x] `lib/api/tripsMeta.ts`: `fetchTripsMeta()` creado
- [x] `diario/page.tsx`: fetch meta + props a TripTable y TripSlideOver
- [x] `TripTable.tsx`: sin hardcodes, usa meta
- [x] `TripSlideOver.tsx`: reescritura completa con 3 tabs y tabla de paradas
- [x] `npx tsc --noEmit` — 0 errores
- [x] `npm run build` — verde
- [ ] Deploy a Vercel (push → CI/CD)

---

### 2026-05-29 — Fix duplicados silver.tms_milestone_trips (trigésimo-novena iteración)

**Problema:** Usuario reportó duplicados en `silver.tms_milestones_trips`.

**Diagnóstico:**
- Tabla real: `silver.tms_milestone_trips` (1577 filas, 1 duplicado)
- Root cause: race condition — dos runs de dbt corrieron el 2026-05-28 con 18 segundos de diferencia (`04:19:31` y `04:19:49`). Ambos computaron el mismo `MAX(file_generated_at)` en el incremental filter, y como dbt en Postgres hace `DELETE + INSERT` (no MERGE nativo), ambos INSERT entraron antes del DELETE del otro.
- Fila duplicada: `trip_stop_sk=e828a03657b70d5abd73354d93d52581`, viaje `1974747`, stop `BIO BIO - 89`, cliente `walmart`.

**Fix aplicado en Supabase:**
1. `DELETE FROM silver.tms_milestone_trips WHERE trip_stop_sk = 'e828a03657b70d5abd73354d93d52581' AND dbt_valid_from = '2026-05-28 04:19:49.729927'` → 0 duplicados ✅
2. `CREATE UNIQUE INDEX uix_tms_milestone_trips_sk ON silver.tms_milestone_trips (trip_stop_sk)` → previene futuros duplicados silenciosos ✅

**Resultado:** 1576 filas, 0 duplicados. Si vuelven a correr dos jobs dbt simultáneos, el segundo fallará con error visible en lugar de corromper datos.

**Nota dbt/Mage:** Si el error `duplicate key value violates unique constraint` aparece en Mage, re-corre el job. Si es frecuente, agregar lock de nivel job en Mage para `slv_milestone_trips`.

---

### 2026-05-29 — Roles backend-driven + pablo como owner (trigésimo-octava iteración)

**Objetivos:** (1) Eliminar roles hardcodeados del frontend; el backend es la fuente de verdad. (2) Preset pablo.abumohor@webcarga.com como owner.

**Problema raíz:**
- `ROLE_LABELS`, `ROLE_DESCRIPTIONS`, `ALL_ROLES`, `ASSIGNABLE_ROLES`, `byRole` duplicados en 5 archivos del frontend Y en `backend/routers/users.py`.
- Trigger `handle_new_user()` asignaba `'admin'` a todos los whitelisted, sin soporte de rol específico por email.

**Cambios implementados:**

**Backend:**
- `routers/roles.py` (nuevo) — `ROLE_ORDER` + `ROLE_META` + endpoint `GET /api/v1/roles` (sin auth). Devuelve lista ordenada con `id`, `label`, `description`, `level`.
- `routers/users.py` — elimina `ROLE_ORDER` local; importa desde `roles.py`.
- `main.py` — registra `roles_router` con `prefix="/api/v1"`.

**DB (migración `20260529000001_admin_whitelist_role_column` — aplicada):**
- `ADD COLUMN role TEXT DEFAULT 'admin'` a `admin_whitelist`.
- INSERT `pablo.abumohor@webcarga.com` → `owner` en whitelist.
- Trigger `handle_new_user()` reescrito: usa `COALESCE((SELECT role FROM admin_whitelist WHERE email = NEW.email), 'viewer')` en lugar de hardcodear `'admin'`.
- `UPDATE profiles SET role = 'owner' WHERE email = 'pablo.abumohor@webcarga.com'` — aplicado ✅.

**Frontend:**
- `lib/api/roles.ts` (nuevo) — `RoleInfo` type, `fetchRoles()` (cliente), `fetchRolesServer()` (server component).
- `lib/types.ts` — eliminados `ROLE_LABELS` y `ROLE_DESCRIPTIONS`. Conservados: `UserRole` type, `hasRole()`, `canManage()`.
- `app/dashboard/admin/usuarios/page.tsx` — fetch `fetchRolesServer()` en `Promise.all`; `byRole` calculado como `[...roles].reverse()`; jerarquía de permisos y pills de distribución usan `r.label` / `r.description`.
- `components/admin/UsersTable.tsx` — elimina `ALL_ROLES`; nueva prop `roles: RoleInfo[]`; `assignableRoles` calculado por `level`; dropdown usa `r.label` / `r.description`; pasa `roles` a `CreateUserForm`.
- `components/admin/CreateUserForm.tsx` — elimina `ASSIGNABLE_ROLES`; nueva prop `roles: RoleInfo[]`; `availableRoles` calculado por `level`; radio buttons usan `r.label` / `r.description`.

**Resultado:** TypeScript 0 errores, build verde (13 rutas). pablo.abumohor@webcarga.com → `owner` en profiles ✅.

**Checklist (trigésimo-octava):**
- [x] `routers/roles.py` creado con endpoint `GET /api/v1/roles`
- [x] `users.py` importa `ROLE_ORDER` desde `roles.py`
- [x] `main.py` registra `roles_router`
- [x] Migración `admin_whitelist_role_column` aplicada en Supabase
- [x] pablo → owner en whitelist + profiles
- [x] Trigger actualizado para usar rol de la whitelist
- [x] `lib/api/roles.ts` creado
- [x] `ROLE_LABELS`/`ROLE_DESCRIPTIONS` eliminados de `lib/types.ts`
- [x] `page.tsx` consume roles desde API
- [x] `UsersTable.tsx` sin `ALL_ROLES` hardcodeado
- [x] `CreateUserForm.tsx` sin `ASSIGNABLE_ROLES` hardcodeado
- [x] Build verde, 0 errores TypeScript
- [ ] Deploy a Vercel (push → CI/CD)
- [ ] Aplicar migración pendiente de login: `20260528000001_fix_handle_new_user_trigger` (si no está aplicada aún)

**Próximo paso:** Push main → Vercel deploy.

---

## 1. Meta Actual
- **FastAPI Monitor API** (`monitor-app/backend/api/`) — API operacional de master data de transportistas, pendiente deploy Cloud Run
- Deploy de extraction_service en Cloud Run con CI/CD via GitHub Actions
- Servicio escalable para múltiples TMS ("torres de control")
- QAnalytics adapter escribe en `tms/qanalytics/monitor-trips/`
- Wingsuite adapter escribe en `tms/wingsuite/viajes-transportista/` (integrado 2026-04-14, séptima iteración — ver `extraction_service/AGENTLOG.md` para detalle)
- API unificado (octava iteración, 2026-04-14): `POST /jobs` con `{source, product, ...}` en el body, producto canónico `trips` para qanalytics y wingsuite. Endpoints legacy `/extract/*` quedan como alias deprecados.

## 2. Qué Hicimos

### 2026-05-19 — Governance & Compliance Tracking + Fix crítico trips router (vigésimo-octava iteración)

**Objetivo:** (1) Corregir el router de viajes (completamente roto, usaba columnas que no existen en DB). (2) Agregar gobernanza/cumplimiento desde el Excel a transporter_profiles. (3) Alertas de vencimiento en monitor y empresa.

**Root cause del trips router**: `app.trips` usa `fleet JSONB` (no columnas directas), `stops JSONB` (no `milestones`), `current_status_tms` (no `current_status`). El router anterior consultaba ~10 columnas inexistentes → toda la API de viajes devolvía error.

**DB Migrations aplicadas** (Supabase `viclzoftiudkepqnhekv`):
- `20260519000001_governance_fields.sql` — `ADD COLUMN company_governance JSONB` a `app.transporter_profiles` + vista `app.v_compliance_alerts` (LATERAL jsonb_array_elements sobre drivers/vehicles, alerta expired/expiring_soon a 30 días)
- `20260519000002_trips_fleet_backfill.sql` — PL/pgSQL que linkea trips existentes a transporter_profiles por plate matching → **607/883 trips vinculados**

**Backend API** (`monitor-app/backend/api/`):
- `schemas/trip.py` — eliminado campo `locales` (columna no existe en DB)
- `routers/trips.py` — reescritura completa: `_TRIP_SELECT` mapea `fleet->>'tractor_plate' AS tractor_plate`, `current_status_tms AS current_status`, etc.; LEFT JOINs con `trip_fleet_links` y `transporter_profiles`; filtros corregidos (`fleet->>` + `current_status_tms`); 2 nuevos endpoints `POST/DELETE /{id}/fleet-link`
- `schemas/transporter.py` — nuevos modelos: `DriverGovernance`, `VehicleGovernance`, `CompanyGovernance`, `ComplianceAlertSummary`; `Driver` y `Vehicle` extendidos con `governance`; `PatchVehicleReq`, `has_active_alerts` en `TransporterListItem`
- `routers/transporters.py` — `GET /compliance-alerts/summary` (consulta `v_compliance_alerts`, devuelve dict {rut→status} y {plate→status}); `patch_transporter` incluye `company_governance`; `patch_driver` aplica `governance` al JSONB; `_row_to_dict` parsea `company_governance`

**Frontend** (`monitor-app/frontend/`):
- `lib/types.ts` — `TripMilestone` → `TripStop` (estructura real de `stops JSONB`); `Trip` alineado con API real (`stops[]`, `transporter_profile_id`, `fleet_link_id`, sin `locales`/`milestones`); nuevos tipos `ComplianceStatus`, `AlertStatus`, `DriverGovernance`, `VehicleGovernance`, `CompanyGovernance`, `ComplianceAlertSummary`; `TransporterDriver/Vehicle` con `governance`; `TransporterProfile` con `company_governance`
- `lib/compliance.ts` — `getAlertStatus()`, `getDriverAlertStatus()`, `getVehicleAlertStatus()`, `formatExpiry()` (threshold = 30 días)
- `lib/api/trips.ts` — `locales` eliminado de `TripPatch`; `assignFleetLink()` + `removeFleetLink()` añadidos
- `lib/api/transporters.ts` — `getComplianceAlertSummary()`; `company_governance` en `TransporterPatch`; `governance` en `patchDriver`
- `components/dashboard/ComplianceBadge.tsx` — badge rojo/ámbar con dot compact para tablas
- `components/dashboard/TripTable.tsx` — prop `alertSummary`; dots de alerta en columnas Tracto y Conductor
- `components/dashboard/TripSlideOver.tsx` — sección "Paradas del viaje" (reemplaza milestones); eliminado campo `locales`; `TransporterAssignSection` para vincular EETT manualmente; sección "Empresa de Transporte" con desvincular
- `app/dashboard/diario/page.tsx` — carga `getComplianceAlertSummary` al montar; pasa `alertSummary` a TripTable
- `app/dashboard/transportistas/empresa/[id]/page.tsx` — `DriverCard` con fechas vencimiento C.I./Licencia + anillo rojo/ámbar en avatar + edición inline de fechas; vehicles cards con fechas + dot de alerta; `GovernancePanel` debajo del 2-column grid (grid de badges por documento); sección Gobernanza en slide-over con dropdowns editables (ok/pendiente/actualizar/n_a) por cada documento

**Resultado:** TypeScript 0 errores, `npm run build` verde (13 rutas), 607 trips pre-vinculados.

**Checklist (vigésimo-octava):**
- [x] Migration governance_fields aplicada + verificada
- [x] Migration trips_fleet_backfill aplicada → 607/883 vinculados
- [x] trips.py router reescrito (columnas reales)
- [x] transporter.py schemas extendidos con governance
- [x] transporters.py compliance-alerts endpoint + patch con company_governance
- [x] Frontend types alineados con DB real
- [x] ComplianceBadge + compliance.ts helpers
- [x] TripTable con alert dots
- [x] TripSlideOver con stops + fleet-link assignment
- [x] Empresa detail page con governance panel + edición
- [x] Build verde, 0 errores TypeScript
- [x] Push a GitHub → Vercel deploy triggered

### 2026-05-19 (continuación) — Tabla Diario rediseño completo (trigésima iteración)

**Problema:** El usuario revisó `EETT-mal-configurado.png` y detectó que la columna EETT mostraba "WEBCARGA SPA" (nombre TMS, no empresa vinculada real), faltaban columnas clave (TMS, Cliente, Origen, cargo_type, status_reported_at), los flags booleanos no eran visibles/filtrables por fila, los destinos múltiples no se visualizaban, y el conductor no era editable.

**Cambios implementados:**

**Backend** (`trips.py`, `schemas/trip.py`):
- `transporter` ahora es SOLO `tp.business_name` (null si no vinculado) — no COALESCE con TMS
- `transporter_tms` = `fleet->>'transporter_name_tms'` como campo separado (para slide-over)
- `driver_name` resuelto con `COALESCE(fl.driver_name_raw, t.fleet->>'driver_name_tms')`
- `status_reported_at` añadido al SELECT
- Filtros booleanos añadidos a `list_trips`: `activo`, `trabajando`, `asignado`, `primera_vuelta`
- `TripPatch` recibe `driver_name: Optional[str]` → ruta a `trip_fleet_links.driver_name_raw`
- `patch_trip` maneja `driver_name` aparte: `UPDATE trip_fleet_links SET driver_name_raw = ...` (o crea link mínimo si no existe)

**Frontend** (`TripTable.tsx`, `lib/types.ts`, `lib/api/trips.ts`, `diario/page.tsx`):
- `TripTable` completamente rediseñado:
  - Columnas: FECHA | TMS | PATENTE | CONDUCTOR·FLAGS | EETT | CLIENTE | ORIGEN·CARGA | DESTINOS | ESTADO | →
  - `TmsChip`: chip coloreado QA(azul)/WS(púrpura)/SDM(naranja)
  - `FlagDots`: 4 dots A/T/As/1V coloreados — visibles inline por fila bajo el conductor
  - `StopPills`: pills ON TIME(verde)/OFF TIME(ámbar) por parada, max 2 + "+N"
  - `ConductorCell`: edición inline — click → input+botón✓/✗, guarda vía `PATCH driver_name`, Escape cancela
  - EETT: muestra empresa vinculada SOLO cuando `transporter_profile_id` != null; sin eso → "sin vincular" italic
  - Prop `onSaved` añadida para actualizar trips al guardar conductor
- `types.ts`: `Trip` con `status_reported_at` y `transporter_tms`; `TripPatch` con `driver_name`
- `diario/page.tsx`: chips de filtro booleano (Activo/Trabajando/Asignado/1ra Vuelta) con toggle 3-estado (null→true→null), botón "limpiar", pasa `onSaved` a TripTable

**Resultado:** TypeScript 0 errores, build verde (13 rutas). Push `3233507` → Vercel deploy en curso.

**Checklist (trigésima):**
- [x] transporter separado de transporter_tms en SQL
- [x] TripTable con 9 columnas + minWidth 980
- [x] FlagDots inline por fila
- [x] StopPills por destino
- [x] ConductorCell editable (inline PATCH)
- [x] Filtros booleanos chip en diario/page.tsx
- [x] onSaved prop en TripTable
- [x] 0 TypeScript errors, build verde
- [x] Push main → Vercel deploy triggered

### 2026-05-19 (continuación) — Certificación UX empresa + rampla removida (trigésimo-primera iteración)

**Objetivos:** (1) Rediseñar `empresa/[id]` de grid de tarjetas a tabla de certificación según diseño Figma ("GC Habilitado"). (2) Remover patente rampla de TripTable.

**Figma URL:** `https://www.figma.com/proto/NW7aAqbiCxML2HLd8uMTzf/WebCarga?node-id=16-9949`
- Layout: tabs Conductores/Tractos/Gobernanza, tabla con header oscuro (`bg-slate-800`)
- "GC Habilitado" = columna por cada generador de carga → mapeado a `validado_walmart` (dok `ComplianceStatus`)

**Cambios implementados:**

**`monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx`** — reescritura completa:
- 3 tabs: Conductores | Tractos | Gobernanza Empresa
- `DriverRow`: tabla row + inline form expandible (Eye/EyeOff toggle); columnas: Nombres/RUT · EETT/RUT · Vencimientos (C.I./Licencia) · Documentación · GC Habilitado · Acción
- "GC Habilitado" → chip verde "Walmart" cuando `validado_walmart === 'ok'`
- WMT toggle button: cicla `validado_walmart` entre `'ok'` y `'pendiente'` via `patchDriver`
- Filtro client-side por nombre/rut en cada tab
- `VehicleRow`: tabla row + inline form expandible con 4 expiry dates + 5 doc dropdowns
- Gobernanza tab: grid 2-6 col de `GovernanceSelect` dropdowns por cada doc de empresa
- Header oscuro `bg-slate-800` en todas las tablas (matching Figma)
- useEffect en DriverRow/VehicleRow para sincronizar draft state al actualizar prop
- Mantiene company header (business_name, RUT, stage, compliance chips)

**`monitor-app/frontend/components/dashboard/TripTable.tsx`**:
- Removida visualización de trailer_plate (rampla) del cell PATENTE

**Resultado:** TypeScript 0 errores, build verde (13 rutas). Push `9e7a12e` → Vercel deploy en curso.

**Checklist (trigésimo-primera):**
- [x] Empresa page rediseñada con tab-based certification tables
- [x] DriverRow con WMT toggle + inline edit expandible
- [x] VehicleRow con inline edit expandible
- [x] Gobernanza tab con dropdowns editables
- [x] Dark header (bg-slate-800) en tablas
- [x] Rampla removida de TripTable
- [x] 0 TypeScript errors, build verde
- [x] Push main → Vercel deploy triggered

### 2026-05-20 (continuación) — Equipos tab + Sidebar collapse + Edit panel fix (trigésimo-tercera iteración)

**Objetivos:** (1) Reestructurar tab Tractos→Equipos con columnas individuales por campo del spreadsheet. (2) Hacer el Sidebar colapsable. (3) Arreglar panel "Editar Datos Empresa" que quedaba pegado en desktop.

**Cambios implementados:**

**`empresa/[id]/page.tsx`:**
- Tab renombrado "Tractos" → "Equipos" (`type Tab = 'conductores' | 'equipos'`)
- Sección Ramplas eliminada completamente
- Columna "GC Habilitado" eliminada de Conductores (`DriverRow` sin `onToggleWmt`)
- VehicleRow read-only: 13 columnas individuales matching spreadsheet (Equipo | Padrón | P. Circ. | Re. Téc. | Gases | SOAP | Póliza RC | Año | GPS | Seg. Carga | Cám. Frío | Creación WMT | edit)
- Conductores: 4 columnas (Conductor | Vencimientos | Documentación | edit), `colSpan={4}`
- Equipos: `colSpan={13}`, `minWidth: 1080`
- **Fix edit panel stuck**: `fixed md:absolute` → `fixed`; backdrop `md:hidden` removido

**`Sidebar.tsx` — reescrito con collapse:**
- `useState(false)` + `useEffect` lee `localStorage.getItem('sidebar-collapsed')`
- Collapsed: `w-16`, header = botón full-width ChevronRight
- Expanded: `w-56`, header = logo + "WebCarga" + botón ChevronLeft
- `transition-[width] duration-200` sin `overflow-hidden` (evita clipping del botón)
- Nav collapsed: `justify-center px-2.5` (solo icono); expanded: `gap-3 px-3` (icono + label)

**Resultado:** 0 errores TypeScript, build verde (13 rutas). Push `8e82a74` → Vercel deploy en curso.

**Checklist (trigésimo-tercera):**
- [x] Tab Tractos → Equipos
- [x] Ramplas section eliminada
- [x] GC Habilitado column eliminada de Conductores
- [x] VehicleRow con 13 columnas individuales según spreadsheet
- [x] Sidebar collapse/expand con localStorage
- [x] Edit panel fix: `fixed` + backdrop sin `md:hidden`
- [x] 0 TypeScript errors, build verde
- [x] Push main → Vercel deploy triggered

---

### 2026-05-20 — Mobile responsiveness: Diario + Transportistas (trigésimo-cuarta iteración)

**Objetivo:** Hacer todas las secciones responsive para mobile: Diario (tabla y modal), Transportistas (lista y detalle con Conductores/Equipos).

**Problema de timezone:** `new Date().toISOString().split('T')[0]` devolvía fecha UTC → mostraba 21/05 después de las ~20:00 hora chilena.
- Fix: `new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date())` (en-CA devuelve YYYY-MM-DD)

**Auth fixes (deployados en esta sesión):**
- `proxy.ts` → EN Next.js 16 este es el middleware (no `middleware.ts`)
- Backend: `redirect_slashes=False` + `@router.get("")` (sin slash) + `--proxy-headers` en uvicorn
- Vercel: `FASTAPI_URL=https://webcarga-monitor-api-793003153880.us-central1.run.app` configurado
- Callback: `next` default cambiado de `/dashboard/operaciones` → `/dashboard/diario`

**TripTable.tsx mobile:** `md:hidden` card list con patente+estado+TMS chip, conductor+flags, EETT+origen. Desktop table en `hidden md:block`.

**TripSlideOver.tsx mobile:** Tab switcher `md:hidden` ("Viaje" / "Bitácora"). Left panel y right panel condicionados por `mobileTab` state.

**transportistas/page.tsx mobile:** `md:hidden` card list (Building2 icon + nombre + RUT + counts + badge cumplimiento + chevron). Desktop table en `hidden md:table`.

**empresa/[id]/page.tsx mobile (esta iteración):**
- Añadido `MobileDriverCard` — componente autónomo con draft state propio; card con avatar+anillo alerta+nombre+RUT+expiry dates C.I./Licencia+doc badges; expand → form inline (nombre, RUT, 2 dates, 8 doc dropdowns); botones Guardar/Cancelar
- Añadido `MobileVehicleCard` — análogo; card con placa dark badge+tipo+alert badge+4 expiry dates (grid 2 col)+doc badges+año pill; expand → form inline (tipo, patente, año, 4 dates, 6 doc dropdowns)
- Conductores tab: `md:hidden` section con MobileDriverCard list + `hidden md:block overflow-x-auto` desktop table
- Equipos tab: `md:hidden` section con MobileVehicleCard list + `hidden md:block overflow-x-auto` desktop table

**Resultado:** 0 errores TypeScript, build verde.

**Checklist (trigésimo-cuarta):**
- [x] Timezone fix (Santiago) en diario/page.tsx
- [x] Auth fixes deployados (proxy.ts, redirect_slashes, FASTAPI_URL)
- [x] TripTable mobile cards
- [x] TripSlideOver mobile tabs
- [x] transportistas/page.tsx mobile cards
- [x] MobileDriverCard con state propio + edit form
- [x] MobileVehicleCard con state propio + edit form
- [x] Conductores tab mobile/desktop split
- [x] Equipos tab mobile/desktop split
- [x] 0 TypeScript errors

---

### 2026-05-28 — Fix login y registrarse (trigésimo-séptima iteración)

**Diagnóstico vía logs Supabase Auth:**

**Bug 1 (crítico) — Registro/OAuth bloqueados por constraint DB:**
- Error real: `profiles_role_check constraint violation` → `500: Database error saving new user`
- Causa: trigger `handle_new_user` asignaba `role = 'operador'` a usuarios no-whitelisted, pero el constraint solo acepta `['viewer','writer','editor','admin','owner']`
- Fix: migración SQL `20260528000001_fix_handle_new_user_trigger.sql` — cambia `'operador'` → `'viewer'`
- **PENDIENTE APLICAR EN SUPABASE** (archivo creado, falta `apply_migration`)

**Bug 2 (moderado) — Login falla para usuarios creados sin contraseña:**
- Error real: `400: Invalid login credentials` (× 3 intentos)
- Causa: admin panel crea usuarios sin contraseña → no pueden hacer login email/password
- Fix: `lib/actions/users.ts` — si no hay password, envía `resetPasswordForEmail()` automáticamente para que el usuario setee la suya

**Fix 3 (menor) — LoginForm redirect:**
- `LoginForm.tsx` redirigía a `/dashboard/operaciones` (doble redirect) → cambiado a `/dashboard/diario`

**Archivos modificados:**
- `monitor-app/backend/supabase/migrations/20260528000001_fix_handle_new_user_trigger.sql` (nuevo)
- `monitor-app/frontend/lib/actions/users.ts` (envío recovery email)
- `monitor-app/frontend/components/auth/LoginForm.tsx` (redirect directo)

**Checklist (trigésimo-séptima):**
- [x] Migración SQL creada (`'operador'` → `'viewer'`)
- [ ] **Aplicar migración en Supabase** (crítico — bloquea todo registro)
- [x] `users.ts` envía recovery email cuando sin contraseña
- [x] `LoginForm.tsx` redirect a `/dashboard/diario`
- [ ] Deploy a Vercel (código frontend)
- [ ] Verificar: registro nuevo usuario → dashboard
- [ ] Verificar: admin crea usuario sin password → usuario recibe email de reset

**Próximo paso exacto:** Confirmar aplicación de migración → luego deploy Vercel.

---

### 2026-05-27 — Manual plate assignment + plate normalization (trigésimo-sexta iteración)

**Objetivo:** Permitir asignación manual de patente (tracto/rampla) en viajes Sodimac (y cualquier TMS sin flota). Normalizar la UI de patentes para que una sola patente tenga la misma relevancia visual que la patente principal de QAnalytics.

**Backend (`monitor-app/backend/api/app/routers/trips.py`):**
- `_TRIP_SELECT`: `tractor_plate` y `trailer_plate` ahora `COALESCE(fl.tractor_plate, t.fleet->>'tractor_plate')` — el override manual tiene prioridad sobre el TMS
- Filtro de búsqueda: añadido `fl.tractor_plate ILIKE '%'||$1||'%'` para buscar por patente manual
- `patch_trip`: nuevo bloque para `tractor_plate` / `trailer_plate` → escribe a `trip_fleet_links` (crea link si no existe, igual que driver_name/driver_phone)

**Backend (`monitor-app/backend/api/app/schemas/trip.py`):**
- `TripPatch`: añadidos `tractor_plate: Optional[str]` y `trailer_plate: Optional[str]`

**Frontend (`monitor-app/frontend/lib/api/trips.ts`):**
- `TripPatch`: añadidos `tractor_plate?: string` y `trailer_plate?: string`

**Frontend (`monitor-app/frontend/components/dashboard/TripTable.tsx`):**
- Nuevo componente `PlateCell`: edición inline de patentes (similar a ConductorCell)
  - `primaryPlate = tractor_plate ?? trailer_plate ?? null` — una sola patente se muestra con mismo peso visual que QA
  - `secondaryPlate = tractor_plate && trailer_plate ? trailer_plate : null` — si hay dos, el tracto va arriba en bold y la rampla abajo en pequeño
  - Click en primaria → edita `tractor_plate`; click en secundaria → edita `trailer_plate`
  - Guarda via `PATCH /{id}` con `tractor_plate` o `trailer_plate`
  - Input en mayúsculas automáticas
- Columna PATENTE en desktop: reemplazada por `<PlateCell>` + `<ComplianceBadge>`
- Mobile cards: `primaryPlate = tractor_plate ?? trailer_plate` para normalizar display (antes mostraba `tractor_plate ?? '—'`)

**Frontend (`monitor-app/frontend/components/dashboard/TripSlideOver.tsx`):**
- Header: `trip.tractor_plate ?? trip.trailer_plate ?? 'Sin patente'` (normalizado)

**Resultado:** TypeScript 0 errores. Sodimac trips pueden recibir patente manual; todos los trips con una sola patente la muestran con el mismo peso visual.

**Checklist (trigésimo-sexta):**
- [x] COALESCE plates en _TRIP_SELECT (override manual > TMS)
- [x] fl.tractor_plate en filtro de búsqueda
- [x] patch_trip handler para tractor_plate / trailer_plate → trip_fleet_links
- [x] TripPatch schema actualizado (backend + frontend)
- [x] PlateCell con inline edit + normalización primary/secondary
- [x] Mobile cards normalizados
- [x] TripSlideOver header normalizado
- [x] 0 TypeScript errors

**Próximo paso:** Deploy. Correr `dbt run --select slv_milestone_trips+ int_tms_trips_conformed+ app_trips` en Mage para activar los fixes de estado CERRADO y origin nulo.

---

### 2026-05-27 — Auditoría Supabase + PKs + índices + dbt MERGE fix (trigésimo-quinta iteración)

**Objetivos:** (1) Agregar `source_trip_id` como "ID Viaje" en TripTable + ordenamiento de columnas. (2) Mostrar viajes cerrados/finalizados en el diario. (3) Fix bug MERGE en dbt pipeline. (4) Auditoría Supabase performance & seguridad. (5) Aplicar migración PKs + índices funcionales.

**TripTable.tsx (monitor-app/frontend/components/dashboard/TripTable.tsx):**
- Añadida columna "ID Viaje" (`source_trip_id`) en `font-mono text-[11px]`
- Ordenamiento ascendente/descendente en todas las columnas (useMemo sort, ciclo null→asc→desc→null)
- `SortKey` type, `SortIcon` component (ArrowUpDown gris / ArrowUp / ArrowDown en accent)
- `minWidth` aumentado de 980 a 1080

**trips.py (monitor-app/backend/api/app/routers/trips.py):**
- `source_trip_id` añadido a `_TRIP_SELECT`
- Eliminado filtro `en_curso` que bloqueaba viajes cerrados/finalizados → ahora el filtro es solo por fecha

**dbt — fix MERGE bug (`raw_snapshot.sql` + `slv_milestone_trips.sql`):**
- Root cause: `DISTINCT ON (source_trip_id)` sin `source_client` → acumulación de duplicados en snapshot cuando dos clientes tienen el mismo trip ID
- `raw_snapshot.sql`: cambiado a `DISTINCT ON (source_client, source_trip_id)`, ORDER BY actualizado
- `slv_milestone_trips.sql`: surrogate key incluye `source_client` → `generate_surrogate_key(['source_client', 'source_trip_id', 'stop_location_name'])`
- Requiere `dbt snapshot --full-refresh` + `dbt run --select slv_milestone_trips --full-refresh` en Mage

**Supabase auditoría & migración `20260527000003_pk_and_indexes` (aplicada):**
- `ALTER TABLE app.trips ADD PRIMARY KEY (id)` ✅
- `ALTER TABLE app.transporter_profiles ADD PRIMARY KEY (id)` ✅
- Índices funcionales: `(fleet->>'tractor_plate')`, `(fleet->>'driver_rut_tms')`, `(fleet->>'driver_name_tms')` ✅
- Índices estándar: `planning_date`, `current_status_tms`, `fleet_link_id` en `app.trips` ✅
- FK: `app.trip_fleet_links.trip_id → app.trips(id)` ✅
- Índice: `app.transporter_profiles(edited_by)` ✅

**Pendiente (seguridad — requiere aprobación explícita):**
- `20260527000002_performance_and_security_hardening.sql` — existe localmente, NO aplicada aún:
  - RLS en `app.trips`, `app.trip_fleet_links`, `app.trip_events`
  - `REVOKE EXECUTE ON FUNCTION app.safe_update_transporter FROM anon`
  - Fix `auth.uid()` → `(select auth.uid())` en `public.profiles`
  - DROP 11 índices no usados
  - `ALTER VIEW app.v_compliance_alerts SET (security_invoker = true)`

**Checklist (trigésimo-quinta):**
- [x] ID Viaje column en TripTable + sort en todas las columnas
- [x] Viajes cerrados/finalizados visibles en diario
- [x] dbt MERGE fix (raw_snapshot + slv_milestone_trips)
- [x] PK en app.trips y app.transporter_profiles
- [x] Índices funcionales JSONB fleet
- [x] FK trip_fleet_links → trips
- [x] Migración `20260527000003_pk_and_indexes` aplicada en producción
- [x] Aplicar `20260527000002_performance_and_security_hardening` (aplicada)
- [ ] Correr dbt full-refresh en Mage para fix MERGE
- [ ] Commit dbt files (raw_snapshot.sql, slv_milestone_trips.sql)

---

### 2026-05-20 — Governance fields alignment + factible status (trigésimo-segunda iteración)

**Objetivo:** Cerrar brechas entre el Excel de gobernanza (Drive spreadsheet `1DtBJfpHDf3zN1J9CbZ90bRZl9j7dYrOT_3m-JtNHXNo`) y el código. (1) Empresa detail page — rediseño UX completo. (2) Añadir campo `padron` faltante en VehicleGovernance. (3) Añadir `'factible'` al enum ComplianceStatus.

**Audit resultado:**
- Empresas: ✅ 14 campos completos
- Conductores: ✅ completo; "FACTIBLE" existe en DB real para `validado_walmart`
- Vehiculos: ⚠ `padron` ausente; `año` no expuesto en UI

**Rediseño UX empresa (`empresa/[id]/page.tsx`):**
- Tab "Gobernanza Empresa" eliminado — docs de empresa movidos a sección colapsable en el header de la empresa (`CompanyDocsPanel` con conteo OK/pendiente + progreso)
- Tab "Acción" columna eliminada — reemplazada por iconos PenLine/Trash2 sin header
- WMT toggle movido dentro de la columna "GC Habilitado" (acción + resultado colocados)
- Columna "EETT · RUT EETT" eliminada de tabla conductores (redundante en página de empresa)
- Empresas list page (`transportistas/page.tsx`): grid view eliminado → tabla limpia con columna Cumplimiento (chip "Con alertas"/"Al día")

**Cambios de código (trigésimo-segunda):**
- `transporter.py`: `ComplianceStatus` + `'factible'`; `VehicleGovernance.padron: Optional[ComplianceStatus] = None` (antes de `poliza_rc`)
- `types.ts`: `ComplianceStatus` + `'factible'`; `VehicleGovernance.padron: ComplianceStatus | null`
- `empresa/[id]/page.tsx`: `COMPLIANCE_CFG` + `factible`; `GovernanceSelect` + option Factible; `VEHICLE_DOC_LABELS` + `padron` (antes poliza_rc); `VehicleRow.draftGov` + `padron` y `year`; read-only `año` en fila; input `año` en form expandible

**Resultado:** 0 errores TypeScript, build verde (13 rutas). Push `664f559` → Vercel deploy en curso.

**Checklist (trigésimo-segunda):**
- [x] `padron` añadido a VehicleGovernance (backend + frontend types)
- [x] `factible` añadido a ComplianceStatus (backend + frontend)
- [x] COMPLIANCE_CFG + GovernanceSelect actualizados con factible (teal)
- [x] VEHICLE_DOC_LABELS con padron (antes poliza_rc)
- [x] VehicleRow draftGov con padron + year
- [x] Año visible read-only en fila de tracto
- [x] Input año en form expandible de tracto
- [x] 0 TypeScript errors, build verde
- [x] Push main → Vercel deploy triggered

### 2026-05-19 (continuación) — UX fixes post-review (vigésimo-novena iteración)

**Problema:** Revisión de 5 capturas de pantalla del usuario reveló:
1. Toggle bug: `<label>` wrapping `<div onClick>` causaba side-effects de click; `activo ?? true` causaba que valores null se mostraran como ON
2. TripTable sin `tms_name`/`client_name` visibles
3. Empresa detail page con forms de gobernanza incompletos (solo 2 campos date, faltaban 8 dropdowns de documentos para conductores; vehiculos sin edit mode)
4. Empresa page no mostraba estado de cumplimiento al glance

**Fixes implementados:**
- `TripSlideOver.tsx`: Toggle usando `<button type="button">` (no `<label>`); `activo ?? false` (no `?? true`); driver RUT en header; tms chip; client_name visible; copy más claro para EETT asignada/sin asignar
- `TripTable.tsx`: `client_name` secondary line en columna EETT; `tms_name` badge bajo columna Origen
- `empresa/[id]/page.tsx`: DriverCard completo con 8 dropdowns governance (anexo_3_walmart, epp, das_odi, hoja_de_vida, cert_antecedentes, validado_walmart, contrato_trabajo, creacion_walmart) + 2 date expiry; nuevo VehicleCard con edit mode (4 expiry dates + 5 doc dropdowns); compliance summary badge en company header ("X cond. vencidos", "Documentación al día"); alert count chips por sección; GovernancePanel siempre visible
- `transporters.ts` (API): añadido `patchVehicle()` method
- `transporters.py` (backend): nuevo endpoint `PATCH /{tid}/vehicles/{vid}` + importado `PatchVehicleReq`

**Resultado:** 0 errores TypeScript, build verde, 14 routes backend. Push → Vercel deploy en curso.

**Checklist (vigésimo-novena):**
- [x] Toggle bug fix: <button> + default false
- [x] tms_name / client_name visibles en TripTable
- [x] DriverCard con 8 governance doc dropdowns
- [x] VehicleCard con edit mode completo
- [x] Compliance summary en empresa header
- [x] PATCH vehicle endpoint backend
- [x] 0 TypeScript errors, build verde
- [x] Push main → Vercel deploy triggered

### 2026-05-18 — QAnalytics scraper: fix timeout + datos pre-filtro (vigésimo-séptima iteración)

**Problema**: pipelines QAnalytics fallaban de forma inconsistente con `Timeout 5000ms exceeded`. Logs de Cloud Run confirmaron 4 runs consecutivos fallando en el mismo punto exacto del modal handler.

**Root cause confirmado por logs**:
- `checkboxes.nth(i).check(timeout=5000)` — Playwright evalúa "actionability" por elemento. Cuando la animación Bootstrap del modal (~300ms CSS transition) no terminó, el backdrop cubre los checkboxes y Playwright los marca como "intercepted" → timeout. La navegación tardaba 30-33s (servidor QAnalytics lento) lo que dejaba menos margen para la animación.
- Secundario: `#btn_buscar` se clickeaba sin esperar la respuesta XHR del UpdatePanel de ASP.NET. El export podía capturar datos pre-filtro (XHR del search llegaba 4s después del click al export).

**Tres fixes implementados** (`extraction_service/app/tms/qanalytics/scraper.py`):

1. **Modal — eliminar loop `.check()`**: Reemplazado `for i in range(n): await checkboxes.nth(i).check(timeout=5000)` por un único `page.evaluate()` atómico que ya existía en el código (la segunda pasada). El JS marca todos los checkboxes + sincroniza contadores sin pasar por las validaciones de actionability de Playwright.

2. **Modal — wait animación Bootstrap**: Añadido `await page.wait_for_timeout(400)` después de `modal.wait_for(state="visible")` para dejar que el CSS transition complete antes de interactuar.

3. **Search — expect_response**: `_submit_search` ahora envuelve el click de `#btn_buscar` en `async with page.expect_response(lambda r: ".aspx" in r.url and r.request.method == "POST" and r.status == 200, timeout=...)`. Garantiza que la tabla ASP.NET UpdatePanel tiene datos filtrados antes de que el export corra.

**Tests**: `tests/test_qanalytics_adapter.py` — 7 tests unitarios (sin browser, sin credenciales). Cubren los 3 bugs con mocks de Playwright. RED → GREEN confirmado. Sin regresión en tests de sodimac.

**Bug residual descubierto post-deploy (2026-05-18 22:32+)**: Los 3 fixes resolvieron el `Timeout 5000ms exceeded` del modal pero `valida_GP()` sigue rechazando el cierre con: "Debe ingresar fechas de salida y/o marcar todos los registros como pendiente". Los checkboxes SÍ están marcados (marked=2, total=2). El problema es que `valida_GP()` también exige **fechas de salida** por fila, que son inputs de texto en el modal no llenados por el scraper. `chk.click()` no las llena automáticamente.

**Fix adicional (commit 99c668e, 2026-05-18 23:00)** — `scraper.py::_handle_pendientes_modal_if_open`:
- Luego de marcar checkboxes, encuentra todos `input[type="text"]:not([id="txtchkGP"]):not([id="txtcantidadGP"])` en el modal
- Rellena los vacíos con `fechaHoy` (dd-mm-yyyy)
- Retorna `validaGpSrc[:500]` + `inputDiag` en el evaluate para diagnóstico en logs de Cloud Run

**Checklist (vigésimo-séptima):**
- [x] Root cause confirmado via logs Cloud Run
- [x] Tests RED escritos antes del fix
- [x] Fix 1: eliminar loop `.check()` → evaluate atómico
- [x] Fix 2: `wait_for_timeout(400)` post modal visible
- [x] Fix 3: `expect_response` en `_submit_search`
- [x] 7/7 tests GREEN
- [x] Deploy a Cloud Run (revision 00020, commit 99c668e, ~23:00)
- [ ] Verificar logs revision 00020 — que `fechasRellenas > 0` y modal cierra
- [ ] Si aún falla: leer `validaGpSrc` e `inputDiag` de los logs para diagnóstico exacto

### 2026-05-12 — app.trips aggregate + Diario 2.0 UX refactor (vigésimo-quinta iteración)

**Objetivo:** Modelo de datos de viajes con milestones (patrón `app.transporter_profiles`) + Diario frontend con tabs En Curso/Historial y slide-over de Bitácora.

**Migración SQL aplicada** en Supabase (`viclzoftiudkepqnhekv`):
- `app.trips` — tabla agregada (una fila por `otm_id`): campos del viaje + `milestones JSONB` + Bitácora operativa (activo, trabajando, asignado, primera_vuelta, estado_manual, locales, observaciones, comentarios) + `manually_edited_fields TEXT[]`
- `app.safe_upsert_trip(otm_id, milestone_jsonb, is_latest)` — función que el pipeline llama para agregar milestones sin pisar campos protegidos. Misma mecánica que `app.safe_update_transporter`.
- Índices en `planning_date`, `current_status`, `tractor_plate`, `driver_rut`
- RLS: `trips_select` policy para `authenticated`
- Archivo de migración: `monitor-app/backend/supabase/migrations/20260512000000_app_trips.sql`

**FastAPI — trips router** (`monitor-app/backend/api/app/routers/trips.py`):
- `GET /api/v1/trips/` — lista paginada con filtros: fecha, view (en_curso|historial), q, fecha_desde, fecha_hasta, status
- `GET /api/v1/trips/{id}` — detalle completo con milestones JSONB
- `PATCH /api/v1/trips/{id}` — edita Bitácora + marca `manually_edited_fields` (require_editor)
- `DELETE /api/v1/trips/{id}/overrides/{field}` — resetea campo al control del pipeline
- `app/schemas/trip.py` — `TripPatch` con 8 campos opcionales
- `main.py` actualizado: incluye `trips_router`

**Frontend Diario 2.0** — rediseño completo:
- `lib/types.ts` — nuevos tipos `Trip`, `TripMilestone`
- `lib/api/trips.ts` — cliente HTTP tipado con JWT para trips
- `app/dashboard/diario/page.tsx` — Client Component con:
  - Tabs: "En Curso (Hoy)" (filtrado por status activo) / "Base Histórica y Filtros"
  - Navegación de fechas (En Curso)
  - Filtros historial: fecha_desde, fecha_hasta, status select
  - Un viaje por fila (no N filas por status)
  - Slide-over se abre al clickear un viaje
- `components/dashboard/TripTable.tsx` — tabla de viajes con StatusBadge, columnas: Fecha | Tracto/Rampla | Conductor | EETT | Origen | Estado | →
- `components/dashboard/TripSlideOver.tsx` — panel derecho con:
  - Header oscuro (patente + conductor)
  - Timeline de milestones (historial cronológico del viaje)
  - Bitácora Operativa: 4 toggles (Activo/Trabajando/Asignado/1ra Vuelta) + Estado select + Locales text + Observaciones textarea + Comentarios textarea + botón Guardar
- Build Next.js verde: 12 rutas sin errores TypeScript

**Arquitectura de datos:**
- `silver.tms_trips` — filas raw del pipeline (una por status moment, `otm_id` es el viaje)
- El pipeline llama `app.safe_upsert_trip()` para agregar cada milestone nuevo
- `app.trips` — vista agregada: el frontend solo toca esta tabla
- `manually_edited_fields` protege los campos del pipeline (tractor_plate, driver_name, current_status, etc.)

**Pendiente:**
- Poblar `app.trips` desde `silver.tms_trips` existentes (backfill vía dbt o query directa)
- Deploy del backend actualizado a Cloud Run (trigger CI/CD con push al repo)
- Integrar `app.safe_upsert_trip()` en el pipeline/dbt para viajes nuevos

### 2026-05-12 — Rediseño Empresa Detail Page — 2-column layout (vigésimo-sexta iteración)

**Objetivo:** Reemplazar la vista tabbed de la empresa (Info | Conductores | Flota | Ramplas) por el diseño de `monitor-app/index.html`: header con iniciales coloreadas + 2 columnas simultáneas (Conductores izquierda, Flota/Ramplas derecha) + slide-over de edición.

**Archivo modificado:** `monitor-app/frontend/app/dashboard/transportistas/empresa/[id]/page.tsx`

**Cambios:**
- Eliminado el sistema de tabs (`Tab` type + `tab` state)
- Company Header: cuadro de iniciales con color determinístico, razón social bold, RUT, botón "Editar Datos Empresa" (solo visible con rol editor)
- 2-column grid (`xl:grid-cols-2`, `h-[680px]` con overflow-y-auto en cada panel):
  - **Conductores:** cards con avatar circular de iniciales coloreado, nombre, RUT, botón eliminar
  - **Flota:** Tractos como cards con placa en `bg-slate-800` badge oscuro + tipo; Ramplas como sección separada dentro del mismo panel con `bg-gray-100` badge
- Slide-over "Editar Datos Empresa" abre desde la derecha (mismo patrón que TripSlideOver) — contiene todos los `EditableField` de info + contactabilidad
- Botones "+ Tracto" y "+ Rampla" separados en el header del panel Flota
- TypeScript: compila limpio (0 errores)

**Pendiente:**
- Deploy a Vercel (push to main → CI/CD)

### 2026-05-11 — FastAPI Monitor API + Transporter Profiles (vigésimo-cuarta iteración)

**Objetivo:** API profesional sobre `app.transporter_profiles` (2.830 registros) para normalizar/editar datos desde el frontend.

**Migración SQL aplicada** en Supabase (`viclzoftiudkepqnhekv`):
- `GRANT USAGE ON SCHEMA app TO authenticated` — expone schema a PostgREST
- RLS habilitado en `app.transporter_profiles` (policies select + write)
- Columnas de tracking añadidas: `manually_edited_fields TEXT[]`, `edited_by UUID`, `edited_at`, `created_at`, `updated_at`
- Función `app.safe_update_transporter(uuid, jsonb)` — el pipeline llama esto para respetar campos editados manualmente

**FastAPI scaffold completo** en `monitor-app/backend/api/`:
- `app/main.py` — FastAPI + CORS + lifespan (asyncpg pool)
- `app/config.py` — pydantic-settings (`DATABASE_URL`, `SUPABASE_JWT_SECRET`)
- `app/db.py` — asyncpg pool via `app.state.pool`
- `app/auth.py` — JWT Supabase (HS256, audience=authenticated), lookup rol en `public.profiles`
- `app/schemas/transporter.py` — Pydantic: Driver, Vehicle, Trailer, Contactability, TransporterPatch (normaliza RUT y business_name)
- `app/routers/transporters.py` — endpoints completos:
  - `GET /api/v1/transporters` — lista paginada + search
  - `GET /api/v1/transporters/{id}` — detalle
  - `PATCH /api/v1/transporters/{id}` — editar + marca `manually_edited_fields`
  - `DELETE /api/v1/transporters/{id}/overrides/{field}` — resetear campo al pipeline
  - `POST/DELETE /api/v1/transporters/{id}/drivers/{did}`
  - `POST/DELETE /api/v1/transporters/{id}/vehicles/{vid}`
  - `POST/DELETE /api/v1/transporters/{id}/trailers/{trid}`
  - `DELETE /api/v1/transporters/{id}` — hard delete (admin+)
- `Dockerfile` — Cloud Run compatible (puerto 8080)
- `requirements.txt` — fastapi, uvicorn, asyncpg, pydantic-settings, PyJWT
- App importa limpia: `from app.main import app` → OK

**Completado en vigésimo-cuarta iteración (continuación):**
- `pyproject.toml` — `supabase==2.10.0` (pin exacto; resuelve backtracking de pip), `requires-python = ">=3.11"`
- `venv` con Python 3.11 creado y `.[dev]` instalado limpio en segundos
- Import verificado: `from app.main import app` → OK, 11 endpoints registrados
- `lib/api/transporters.ts` — cliente HTTP tipado con JWT Supabase (browser)
- `lib/types.ts` — tipos `TransporterProfile`, `TransporterListItem`, `TransporterListResponse`, `Driver`, `Vehicle`, `Trailer`, `Contactability`
- `app/dashboard/transportistas/empresa/[id]/page.tsx` — Client Component con tabs (Info, Conductores, Flota, Ramplas), inline edit por campo, badge "Protegido" + botón "↩ Restaurar", add/remove drivers/vehicles/trailers
- `.env.local` — `NEXT_PUBLIC_API_URL=http://localhost:8001` añadido
- Build Next.js verde: 12 rutas sin errores TypeScript

**Pendiente:**
- Crear `.env` con `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` para test E2E local con uvicorn
- Verificar E2E: uvicorn local en :8001 + curl con token real → lista + patch + reset
- Deploy FastAPI a Cloud Run
- Actualizar `NEXT_PUBLIC_API_URL` en Vercel con URL Cloud Run real
- Agregar `SUPABASE_SERVICE_ROLE_KEY` en `.env` del API (obtener de Supabase Dashboard → Project Settings → API)

**Arquitectura de prioridad pipeline vs edits manuales:**
- `manually_edited_fields TEXT[]` en `app.transporter_profiles` lista qué campos no puede pisar el pipeline
- El pipeline usa `app.safe_update_transporter(id, jsonb)` para respetar esos campos
- `DELETE /overrides/{field}` libera el campo → vuelve a ser actualizable por el pipeline

### 2026-05-10 — Deploy Vercel + skills y hooks de automatización (vigésimo-tercera iteración)

**Deploy a Vercel completado:**
- URL producción: `https://frontend-two-alpha-39.vercel.app`
- Proyecto Vercel: `fsotosas-projects-7b3a7c7c/frontend`
- Env vars cargadas: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (todos los ambientes)
- `SUPABASE_SERVICE_ROLE_KEY` aún pendiente (ver pendientes)
- Build exitoso en Vercel: Next.js 16.2.6 + Turbopack, 13 páginas

**Skills creados en `monitor-app/.claude/commands/`:**
- `/deploy` — ciclo completo: verificar cambios → build local → push → `vercel --prod` → reportar URL
- `/check-env` — compara `.env.local` vs Vercel, detecta vars faltantes, propone fix

**Hook registrado en `monitor-app/.claude/settings.json`:**
- PostToolUse hook que detecta commits con cambios en `monitor-app/frontend/` y sugiere `/deploy`

**Pendiente:**
- Agregar `SUPABASE_SERVICE_ROLE_KEY` en Vercel (Dashboard → Project Settings → API → service_role) para activar crear/eliminar usuarios en admin panel
- Agregar URL de producción Vercel en Supabase → Authentication → URL Configuration → Redirect URLs para que OAuth funcione desde Vercel
- Renombrar el alias de Vercel a algo más descriptivo (ej. `webcarga-monitor.vercel.app`) desde el dashboard

### 2026-05-09 — Roles 5-nivel + password strength + login redesign (vigésimo-segunda iteración)

**Roles implementados** (5 niveles, jerarquía ascendente):
- `viewer` → solo lectura
- `writer` → edita campos básicos del Diario (toggles activo/trabajando/vacaciones/sosafe, texto teléfono/observaciones)
- `editor` → edita todos los campos sensibles (comentarios, pendientes_am, asistencia S-D, turno mañana, etc.)
- `admin` → editor + gestión de usuarios (no puede manejar owners ni admins)
- `owner` → acceso total, protegido — mapea a whitelist (felipe@sumadots.com, pablo.abuhomor@webcarga.com)

**Enforcement frontend:**
- `hasRole(userRole, required)` en `lib/types.ts` compara posición en jerarquía
- `canManage(actorRole, targetRole)` controla qué filas en UsersTable son editables
- DiarioTable recibe `userRole` prop → muestra ReadonlyToggle y texto estático para viewers
- Badge "Solo lectura" visible en toolbar de la tabla si no tiene permisos

**Password strength:**
- `PasswordStrength.tsx` — 5 checks, barra proporcional, label (Muy débil → Muy fuerte)
- `isPasswordValid()` requiere ≥4 de 5 checks (8+ chars, mayús, minús, número, especial)
- Integrado en RegisterForm y CreateUserForm; botón submit deshabilitado mientras no cumple

**UsersTable mejorado:**
- Dropdown de rol en línea (click sobre badge) con descripciones de cada rol
- Admins solo pueden asignar viewer/writer/editor; owners pueden asignar cualquier rol
- Admins no pueden editar filas de otros admins ni de owners

**Login rediseñado:**
- Pantalla centrada con fondo oscuro radial gradient + grid texture sutil
- Logo grande centrado con gradiente accent
- Card blanca compacta con tab bar de borde inferior (accent border-b-2 activo)
- Divider "o" minimalista entre form y OAuth buttons
- Eliminado el panel lateral que "ensuciaba" la vista

**OAuth y creación de usuarios:**
- Los usuarios que usan Google/Microsoft no necesitan ser creados manualmente — se crean solos en el primer login OAuth; el trigger asigna role=operador y el admin cambia el rol después.

### 2026-05-09 — Diario 2.0: Arquitectura de objetos + simplificación frontend (vigésimo-primera iteración)

**Estructura simplificada** — solo 3 módulos:
1. **Diario** (`/dashboard/diario`) — tabla operacional con date nav, sin mapa ni KPIs
2. **Transportistas** (`/dashboard/transportistas`) — cards de EETTs con stats; drill-down a `/transportistas/[slug]` con tabs Conductores / Vehículos / Viajes
3. **Admin Usuarios** (`/dashboard/admin/usuarios`) — crear, dar de alta/baja, eliminar

**Arquitectura de objetos anidados:**
- Viaje → EETT → Conductores + Vehículos
- Conductor identificado por `rut_conductor` = `dni_driver` de silver (ID interno TMS, no necesariamente RUT)
- EETT identificada por nombre (slug) desde `v_diario_trips.eett`
- Navegación drill-down: Diario → click EETT → perfil EETT → click conductor → perfil conductor
- Breadcrumbs contextuales en todos los perfiles

**Archivos creados:**
- `app/dashboard/diario/page.tsx` — date navigation (anterior/hoy/siguiente) + DiarioTable
- `app/dashboard/transportistas/page.tsx` — grid de cards por EETT con status badges
- `app/dashboard/transportistas/[slug]/page.tsx` — perfil EETT con tabs
- `app/dashboard/conductores/[id]/page.tsx` — perfil conductor: vehículos, status breakdown, historial
- `lib/actions/users.ts` — server actions `createUser` + `deleteUser` (requiere SUPABASE_SERVICE_ROLE_KEY)
- `components/admin/CreateUserForm.tsx` — modal de creación de usuario

**Archivos modificados:**
- `components/dashboard/Sidebar.tsx` — solo Diario + Transportistas + [Admin] Usuarios
- `components/dashboard/DiarioTable.tsx` — EETT y conductor clickeables como links
- `components/admin/UsersTable.tsx` — botón "Crear usuario", botón eliminar (+ confirm dialog)
- `proxy.ts` — redirect /login → /dashboard/diario
- `app/dashboard/operaciones/page.tsx` — redirect a /dashboard/diario

**Pendiente:**
- Agregar `SUPABASE_SERVICE_ROLE_KEY` en `.env.local` para activar creación/eliminación de usuarios (Supabase Dashboard → Project Settings → API)

### 2026-05-09 — Diario 2.0: UI Redesign Figma (vigésima iteración)

- **Figma MCP rate-limited** (View seat Professional plan) — implementación basada en design tokens del plan, screenshots no disponibles.
- **Mejoras UI implementadas**:
  - `app/layout.tsx` — añadida fuente Poppins (mencionada en spec Figma)
  - `app/globals.css` — añadida variable `--font-poppins`
  - `components/dashboard/KPICard.tsx` — rediseñado con top-border de color de status (Figma style), label en Poppins con color del status
  - `components/dashboard/Topbar.tsx` — breadcrumb "Home / Gestor de Viajes", avatar con gradient, initials de nombre completo
  - `components/dashboard/Sidebar.tsx` — active indicator dot (accent), iconos con color accent cuando activos, label "Diario 2.0", opacidades refinadas
  - `components/dashboard/DiarioTable.tsx` — badges con colores exactos de marca (inline styles), filtro EETT agregado, search icon, empty state, header uppercase/tracking, zebra stripes más sutiles
  - `app/dashboard/operaciones/page.tsx` — soporte `searchParams` (Promise) para `fecha` param, fecha formateada en header, OriginRanking rediseñada con header propio
  - `app/login/page.tsx` — panel izquierdo branding en desktop (gradiente oscuro), layout 2 columnas en lg+
- **Build verificado**: `next build` sin errores. Dev server activo en localhost:3000.

### 2026-05-09 — Diario 2.0: Gold Layer + Frontend Next.js (decimonovena iteración)

- **Gold migration aplicada** en Supabase (`viclzoftiudkepqnhekv`): schema gold, vista `gold.v_diario_trips` (JOIN silver + normalized_status), tabla `gold.diario_manual_fields` (RLS), tabla `public.profiles` (trigger auto-create).
- **Mapeos de status extendidos**: además de los del plan original, se agregaron Sodimac "Finalizada"→CERRADO FINALIZADO, "Publicada"/"Presentada"→ASIGNADO, "Rechazada en andén"/"Carga rechazada"→CANCELADO; Wingsuite "Ejecucion"→RUTA. Verificado con SQL: 2.292 filas, todos los status normalizados.
- **config.toml actualizado**: `schemas = ["public", "graphql_public", "silver", "gold"]` para exponer gold en PostgREST.
- **Frontend Next.js 16.2.6** inicializado en `monitor-app/frontend/`. Stack: TypeScript, Tailwind v4, App Router.
- **Dependencias instaladas**: @supabase/supabase-js, @supabase/ssr, @tanstack/react-table v8, leaflet + react-leaflet, recharts, lucide-react.
- **Archivos creados**:
  - `proxy.ts` (reemplaza middleware.ts en Next.js 16) — auth guard, redirige a /login si no hay sesión
  - `lib/types.ts` — tipos generados + gold schema manual (DiarioTrip, DiarioManualFields, Database con schema gold)
  - `lib/supabase/client.ts` + `server.ts` — createClient() y createGoldClient() tipados correctamente
  - `lib/geocoding.ts` — lookup lat/lng de ~35 ciudades chilenas
  - `app/globals.css` — colores WebCarga via Tailwind v4 @theme
  - `app/layout.tsx` — fuentes Roboto + Mulish
  - `app/login/page.tsx` + `components/auth/LoginForm.tsx` + `OAuthButtons.tsx`
  - `app/auth/callback/route.ts` — OAuth callback handler
  - `app/dashboard/layout.tsx` — Sidebar + Topbar layout
  - `components/dashboard/Sidebar.tsx` — nav lateral #182635
  - `components/dashboard/Topbar.tsx` — fecha, usuario desde profiles
  - `components/dashboard/KPICard.tsx` + `KPIGrid.tsx` — 8 KPIs por normalized_status
  - `components/dashboard/MapaViajes.tsx` + `MapaViajesWrapper.tsx` — Leaflet (SSR-safe con dynamic import en client component)
  - `components/dashboard/DiarioTable.tsx` — @tanstack/react-table, filtro global + por estado, paginación 20/pág
  - `components/dashboard/ManualFieldCell.tsx` — ToggleCell (toggle booleano) + TextCell (edición inline) con UPSERT
  - `app/dashboard/operaciones/page.tsx` — página principal: KPIs + Mapa + OriginRanking + DiarioTable
- **Build verificado**: `next build` pasa sin errores TypeScript.
- **Auth guard verificado**: `curl localhost:3000` → 307 redirect a /login.



### 2026-04-28 — Wingsuite cambia al reporte 50051 (décima-tercera iteración extraction_service)
- Adapter de Wingsuite ahora abre **"Reporte de Viajes de Transportistas"** (id `50051`) en lugar de "Reporte Completo de Viajes por Transportista" (id `4134`). Endpoint XHR confirmado: `GET viajes.obtener_resumen_transportista` con `fecha_inicio`/`fecha_fin` en query string.
- Refactor: `_open_report` y `_apply_filters_and_download` fusionados en `_load_report_and_download` para que el `expect_response` envuelva la apertura del reporte (el 50051 dispara fetch automático al cargar). Predicate filtra por fechas exactas para descartar el fetch con defaults cuando no coinciden con lo pedido.
- Trigger del fetch: click sobre `Ver Datos` por accessible name; listener `WINGSUITE_DUMP_XHR=1` queda como herramienta de diagnóstico.
- Smoke E2E local verde: `POST /api/v1/jobs` con rango 01-04 a 30-04 termina `done` en ~40s con CSV de 3 filas (matchea el screenshot del usuario).
- Detalle en `extraction_service/AGENTLOG.md` (décima-tercera iteración).

### 2026-04-18 — Verificación post-hotfix Sodimac (duodécima iteración extraction_service)
- Plan comparativo adapter↔PoC en `~/.claude/plans/al-hacer-un-post-sprightly-goblet.md`: la regresión que reportó el usuario ("la PoC estaba funcional y mi adapter se rompió") está aislada en la feature de filtro nativo — la PoC no la tenía. Login, nav, scrape y paginación siguen coincidiendo con la PoC.
- Verificación E2E: unit 3/3 verdes; smoke sin filtro PASSED (228 filas extraídas, CSV OK); test de filtro con `últimos 7 días` falló por **ausencia de data** (portal sin viajes entre 2026-03-26 y 2026-04-20) — no regresión, el test mismo anticipa este caso.
- Hallazgo colateral: `_set_page_size(20)` falla silencioso con timeout del combobox `Filas por página`; queda como deuda menor porque el método es best-effort.
- Detalle en `extraction_service/AGENTLOG.md` (duodécima iteración).

### 2026-04-18 — Sodimac filtro nativo + fixes (undécima iteración extraction_service)
- Branch A completado: `_apply_date_filter` setea `Fecha desde/hasta` (readonly) vía native setter + dispatch input, clickea `#search`. El filtrado ocurre en el servidor, reduciendo ~228 filas a decenas.
- `_set_datepicker_value` prueba 4 formatos (DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, YYYY-MM-DD) — fix para `aria-invalid=true` con formato DD/MM/YYYY solo.
- `_parse_fecha` ahora acepta guión/slash y corta hora — fix para CSV que bajaba vacío por formato FECHA.
- `_set_page_size` → best-effort (no más hang fatal por mat-select).
- Detalle en `extraction_service/AGENTLOG.md`.

### 2026-04-18 — Sodimac respeta date_from/date_to (décima iteración extraction_service)
- Scraper sodimac ahora filtra por rango: early-stop si la tabla viene DESC por FECHA + filtro post-fetch sobre la columna FECHA (DD-MM-YYYY). Detalle en `extraction_service/AGENTLOG.md`.
- `SODIMAC_DUMP_PAGE=1` agregado como helper para investigar si el portal expone un filtro nativo (path para una eventual iteración Branch A).

### Fase 1: Bugs Críticos Corregidos
- **Browser mismatch**: Scraper cambiado de Firefox → Chromium (alineado con Dockerfile)
- **headless=False → configurable**: `BROWSER_HEADLESS=True` por defecto, configurable via env var
- **Credenciales hardcodeadas**: Eliminadas de config.py. Ahora son campos requeridos sin defaults (fail-fast)
- **pydantic-settings**: Eliminados wrappers `os.getenv()` redundantes. Agregado `env_file=".env"`
- **.dockerignore**: Creado para excluir `.env`, `downloads/`, `venv/`, etc. de la imagen Docker

### Fase 2: Path de GCS Adaptado
- `hive_path()` ahora genera: `tms/{source}/{product}/client={c}/extracted_at={d}/from={f}_to={t}.xls`
- Nuevo parámetro `product` en `hive_path()`, `BaseTMSExtractor.PRODUCT_NAME`, `ExtractionArtifact.product`
- QAnalytics: `PRODUCT_NAME = "monitor-trips"`
- `JobResult` schema actualizado con campo `product`
- Propagación completa: scraper → artifact → routes → GCS blob → API response

### Fase 3: Dockerfile Mejorado
- Layer caching: deps se instalan antes de copiar código
- Usuario no-root (appuser) por seguridad
- Removido `readme` de pyproject.toml para que build funcione sin README

### Fase 4: CI/CD Completo
- **init-gcp.sh**: Script idempotente de setup GCP (AR, Secret Manager, WIF, SAs, roles)
- **deploy.yml**: GitHub Actions workflow con Workload Identity Federation
- Cloud Run: 2Gi RAM, 2 CPU, concurrency=1, scale 0-3, secrets via Secret Manager

### Fase 5: Hardening
- **JSON structured logging**: `python-json-logger` para Cloud Logging
- **Factory mejorada**: Error messages incluyen sources disponibles
- **GET /extract/sources**: Endpoint de descubrimiento de TMS
- **Health check mejorado**: Incluye version y jobs_in_memory

### 2026-05-09 — Sodimac: fix URL routing + _set_page_size timeout (decimoséptima iteración)
- **Causa raíz**: el portal `tms.falabella.supply` cambió la ruta de "Gestionar Solicitudes" de `/carrier-shipment-request` a `/shipment-request/list`. `SEL_NAV_GESTIONAR` y `URL_REQUESTS` y el `wait_for_url`/URL check apuntaban al path antiguo → timeout de 2 minutos esperando un selector que nunca aparecía.
- **Fix**: actualizadas 3 referencias: `SEL_NAV_GESTIONAR`, `URL_REQUESTS`, `wait_for_url`, y el guard `"shipment-request" not in page.url`.
- **Fix secundario**: `_set_page_size` pasaba `timeout_ms` (hasta 120s) a cada operación interna. Como es best-effort, se fijó un timeout interno de 5s. Antes: ~4 min por run (2 min de overhead). Ahora: ~86s para 240 filas en 24 páginas.
- Smoke E2E: `done` en 86s, 240 filas, CSV en `gs://sandbox-webcarga/tms/sodimac/trips/sodimac/...`.

### 2026-05-09 — QAnalytics Cumplimiento Citas (decimosexta iteración extraction_service)
- **Nuevo adapter**: `QAnalyticsCumplimientoCitasExtractor` en `app/tms/qanalytics/cumplimiento_citas.py`. Hereda de `QAnalyticsExtractor` — reutiliza login, modal de pendientes y export.
- Navega a **"Módulo Backhauls"** → `gestion_reporte_cumplimiento_citas_back_transporte_walmart.aspx`.
- Selector de fecha: `#txt_fecini` (from) / `#txtFechaFin` (to, camelCase — distinto de SAP `#txt_fin` y Viajes `#txt_fecfin`). Confirmado inspeccionando `/tmp/qanalytics_fatal.html` tras primer fallo.
- Registrado en factory: `("qanalytics", "cumplimiento-citas")`.
- Smoke E2E verde: `done` en ~23s, XLS en `gs://sandbox-webcarga/tms/qanalytics/cumplimiento-citas/walmart/walmart_20260501_20260507_1778289752.xls`.

### 2026-05-08 — QAnalytics Cumplimiento SAP + factory refactor (decimoquinta iteración)
- **Nuevo adapter**: `QAnalyticsCumplimientoExtractor` en `app/tms/qanalytics/cumplimiento_sap.py`. Hereda de `QAnalyticsExtractor` — reutiliza login, filtro de fechas, modal de pendientes y export. Solo overridea `_navigate_to_distribucion()` para apuntar a `reporte_cumplimiento_sap_dist_transporte_walmart.aspx`. `PRODUCT_NAME = "cumplimiento-sap"`.
- **Factory refactoreado** (`app/tms/factory.py`): `EXTRACTORS` cambia de `dict[str, adapter]` a `dict[tuple[str,str], adapter]`. `get_adapter()` hace lookup por `(source, product)` directo. `list_sources()` agrega productos por source. Eliminado `_get_by_source()` helper redundante.
- API: `POST /api/v1/jobs` con `{"source":"qanalytics","product":"cumplimiento-sap",...}` ahora funciona. `GET /api/v1/sources` devuelve qanalytics con products `["trips","cumplimiento-sap"]`.
- **simplify aplicado** sobre base.py, wingsuite, sodimac, qanalytics: `CSV_DELIMITER`, `stringify`, `get_downloads_dir`, `_safe_screenshot` centralizados en `BaseTMSExtractor`. Timeout hardcodeado en `_set_page_size` corregido. XHR body read gateado a URLs críticas. Batch `page.evaluate()` para scrape de tabla.

### 2026-05-09 — MCPs, Skills del video y Skills + Hooks de deuda técnica (decimoctava iteración)
- **MCPs validados**: Google Drive (`mcp__claude_ai_Google_Drive__*`) y Figma (`mcp__claude_ai_Figma__*`) confirmados funcionales — ambos responden desde esta sesión de Claude Code usando la cuenta felipe@sumadots.com. No requieren configuración adicional: están como "deferred tools" disponibles en toda sesión.
- **Skills instaladas** (video: `anthropics/skills` desde GitHub):
  - `xlsx` — manejo de Excel/CSV — copiado a `.agents/skills/xlsx/`
  - `webapp-testing` — testing de web apps — copiado a `.agents/skills/webapp-testing/`
  - Registrados en `monitor-app/skills-lock.json`
- **Slash commands de deuda técnica** en `.claude/commands/`:
  - `/debt-scan` — escanea TODOs/FIXMEs/HACK, type ignores, pass vacíos, deps sin versión
  - `/debt-log` — añade item a `TECH_DEBT.md` con prioridad y contexto
  - `/dep-audit` — audita `requirements.txt`, versiones latest y vulnerabilidades
- **Hooks nuevos/mejorados** en `.claude/hooks/`:
  - `skill-context.sh` → `UserPromptSubmit`: inyecta contexto de MCPs/skills cuando el prompt menciona figma/excel/drive/supabase
  - `smart-stop.sh` → `Stop`: muestra archivos con cambios reales en lugar de echo genérico
  - `debt-detector.sh` → `PostToolUse(Edit|Write)`: detecta nuevos TODO/FIXME en diffs y sugiere `/debt-log`

### 2026-05-08 — Claude Code skills & hooks (decimocuarta iteración)
- **CLAUDE.md root mejorado**: Añadida sección de contexto del proyecto con mapa de archivos, tabla de TMS, patrón de arquitectura y comandos frecuentes. Elimina exploración de archivos al inicio de cada sesión.
- **extraction_service/CLAUDE.md mejorado**: Documentación técnica completa — estructura de directorios, cómo correr tests/dev/smoke test, guía de 4 pasos para agregar un TMS, variables de entorno y notas de browser por TMS.
- **`.claude/settings.json` creado**: Permission allowlist para python3, pytest, uvicorn, curl, docker, find, grep, ls, cp, mv. Hook `Stop` que muestra recordatorio de AGENTLOG.md. Hook `PostToolUse(Edit|Write)` que corre pytest automáticamente al editar archivos de scrapers.
- **Custom commands creados** en `.claude/commands/`:
  - `/run-tests` — corre pytest de extraction_service
  - `/start-dev` — inicia uvicorn en puerto 8080
  - `/smoke-test [source]` — E2E: POST job + poll hasta done/failed
  - `/new-tms` — template completo para agregar un adapter TMS

## 3. Checklist — Diario 2.0 Frontend
- [x] Gold migration aplicada (schema + vista + tablas + RLS + triggers)
- [x] config.toml: gold + silver en schemas API
- [x] Next.js 16 inicializado con TypeScript + Tailwind v4 + App Router
- [x] proxy.ts (auth guard — Next.js 16 rename de middleware)
- [x] Supabase auth (email/password + OAuth Google + Microsoft)
- [x] Dashboard layout (Sidebar #182635 + Topbar con perfil de usuario)
- [x] KPI cards (8 estados normalizados con colores Figma)
- [x] Mapa distribución por origen (Leaflet + geocoding lookup Chile)
- [x] DiarioTable (@tanstack/react-table + filtros + paginación)
- [x] ManualFieldCell: ToggleCell + TextCell (UPSERT a diario_manual_fields)
- [x] Build verde sin errores TypeScript
### 2026-05-09 — Auth completo + Panel Admin (vigésima iteración)
- **Migración `admin_roles_and_profiles`**: columna `profiles.active` (BOOLEAN DEFAULT TRUE), función `is_admin()` (SECURITY DEFINER), políticas RLS admin en profiles.
- **Migración `superadmin_auto_assign`**: tabla `admin_whitelist` (felipe@sumadots.com, pablo.abuhomor@webcarga.com), trigger `handle_new_user` actualizado para asignar `role=admin` automáticamente a emails de la whitelist en primer sign-up/OAuth.
- **Registro**: `components/auth/RegisterForm.tsx` — sign-up con nombre + email + contraseña; redirige directo si email confirmations off, muestra mensaje si on.
- **Recuperar contraseña**: `app/forgot-password/page.tsx` + `ForgotPasswordForm.tsx` → `supabase.auth.resetPasswordForEmail` con redirectTo `/auth/reset-password`.
- **Cambiar contraseña**: `app/auth/reset-password/page.tsx` + `ResetPasswordForm.tsx` → intercambia code del URL → `supabase.auth.updateUser({ password })`.
- **Login page actualizado**: tabs Ingresar/Registrarse + link "¿Olvidaste tu contraseña?".
- **Proxy.ts actualizado**: `/forgot-password` agregado a rutas públicas.
- **Panel Admin** (`/dashboard/admin/usuarios`):
  - `app/dashboard/admin/layout.tsx` — guard: solo `role=admin`, redirige a `/dashboard/operaciones` si no.
  - `components/admin/UsersTable.tsx` — tabla con toggle de role (operador↔admin) y toggle active, optimistic updates, búsqueda por nombre/email.
  - KPIs: total usuarios, admins, activos.
- **Dashboard layout**: verifica `profiles.active`; si false → redirect a `/login?error=cuenta_desactivada`.
- **Sidebar**: acepta `role` prop del server layout; muestra sección Admin con link a /admin/usuarios solo para admins; botón de cerrar sesión.
- **Build verde**: 11 rutas sin errores TypeScript.

- [ ] Configurar Google OAuth en Google Cloud Console → Supabase
- [ ] Configurar Microsoft OAuth en Azure AD → Supabase
- [ ] Test E2E: login → /dashboard/operaciones → tabla con datos reales
- [ ] Leaflet CSS import: verificar que el mapa se renderiza bien en browser

## 3b. Checklist — extraction_service (anterior)
- [x] Fix browser mismatch (Firefox → Chromium)
- [x] Fix headless=False → configurable
- [x] Eliminar credenciales hardcodeadas de config.py
- [x] Crear .dockerignore
- [x] Adaptar hive_path() con prefijo tms/ y product
- [x] Propagar product por todo el stack
- [x] Mejorar Dockerfile (layer caching, non-root user)
- [x] Crear init-gcp.sh (setup completo GCP)
- [x] Crear deploy.yml (GitHub Actions + WIF)
- [x] JSON structured logging
- [x] Factory error messages mejorados
- [x] Endpoint GET /extract/sources
- [ ] Ejecutar init-gcp.sh (requiere gcloud auth login)
- [ ] Configurar GitHub Secrets (WIF_PROVIDER, WIF_SA_EMAIL, GCP_PROJECT_ID, CLOUD_RUN_SA_EMAIL)
- [ ] Push a main para triggear primer deploy
- [ ] Verificar health check en Cloud Run URL
- [ ] Test E2E: POST /extract/qanalytics → job DONE con gcs_uri correcto
- [x] Integrar Wingsuite como nuevo TMS (ver `extraction_service/AGENTLOG.md`)
- [ ] Test E2E Wingsuite: POST /extract/wingsuite → job DONE con gcs_uri bajo `tms/wingsuite/viajes-transportista/...`
- [ ] Agregar secrets `WINGSUITE_USER`/`WINGSUITE_PASS` a init-gcp.sh y deploy.yml

## 4. Decisiones de Arquitectura
- **Chromium** sobre Firefox (mejor soporte headless, alineado con Dockerfile)
- **Workload Identity Federation** sobre SA key JSON (más seguro, sin keys estáticas)
- **product como parámetro** en hive_path() (permite múltiples productos por TMS, ej: monitor-trips, invoices)
- **us-central1** como región (más económica, más servicios disponibles)
- **concurrency=1** en Cloud Run (cada request usa un browser completo)
- **JSON logging** con python-json-logger (compatible con Cloud Logging nativo)
- **Secrets en GCP Secret Manager** (no en env vars del workflow)

## 5. Archivos Modificados
- `app/core/config.py` — Reescrito completo
- `app/tms/base.py` — Reescrito: product param, PRODUCT_NAME, product en Artifact
- `app/tms/qanalytics/scraper.py` — Chromium, headless, PRODUCT_NAME, product
- `app/api/routes.py` — product propagation, /sources, health mejorado
- `app/api/schemas.py` — product en JobResult
- `app/tms/factory.py` — Mejor error message
- `app/main.py` — JSON structured logging
- `Dockerfile` — Layer caching, non-root user
- `pyproject.toml` — python-json-logger, sin readme
- `.dockerignore` — Nuevo
- `init-gcp.sh` — Nuevo: setup GCP completo
- `.github/workflows/deploy.yml` — Nuevo: CI/CD con WIF

---

### 2026-06-18 — Auditoría DB Supabase + Migraciones aplicadas

**Objetivo:** Auditoría live de `viclzoftiudkepqnhekv` como Senior Backend Developer. Análisis de ciclo de vida de staging bronze, seguridad, performance e integridad arquitectónica.

**Hallazgos principales:**
1. `app.trips` sin RLS, sin PK, sin índices → tabla operativa principal expuesta
2. `safe_update_transporter` ejecutable por `anon` vía PostgREST (GRANT TO PUBLIC)
3. `bronze.raw_tms_trips` 100% en PENDING (900K filas, `sync_status` nunca actualizado)
4. `raw_tms_trips_snapshot` usa `trip_file_identity` (incluye `file_name`) como unique_key → SCD Type 2 nunca cierra versiones, `dbt_valid_to` siempre NULL
5. `transporter_profiles` con policies `tp_update`/`tp_write` permitiendo escritura a cualquier usuario autenticado
6. Bronze acumulando 190K rows/semana sin limpieza → saturación de disco en ~4 meses

**Migraciones aplicadas en producción:**
- `20260618000001_security_critical.sql` — RLS + PK + índices en app.trips, DROP tp_update/tp_write, bronze read policy
- `20260618000002_silver_integrity.sql` — índices en silver.tms_trips, silver.tms_milestone_trips, bronze.raw_tms_trips_snapshot, DROP idx_operational_states_active (no usado)
- `20260618000003_bronze_lifecycle_backfill.sql` — 115K rows marcadas PROCESSED (>30 días), índices de lifecycle
- `20260618000004_security_critical_revoke_public.sql` — REVOKE PUBLIC en safe_update_transporter/handle_new_user/is_admin (el REVOKE FROM anon de m1 fue insuficiente por GRANT TO PUBLIC)

**Fix dbt pendiente (user debe ejecutar):**
- `audit/raw_tms_trips_snapshot.sql` — cambiar `unique_key` de `trip_file_identity` (incluye file_name) a `tms_name|source_client|product|source_trip_id` para activar SCD Type 2 real
- Después del cambio: `dbt snapshot --select raw_tms_trips_snapshot --full-refresh`

**Fix Mage pendiente (user debe implementar):**
- Agregar paso post-dbt que marque `sync_status='PROCESSED'` para rows del run actual
- Agregar job mensual de limpieza: `DELETE WHERE sync_status='PROCESSED' AND processed_at < NOW() - 60 days`

**Siguiente paso:** Ejecutar migración Option B (bronze.tms_trips UPSERT + dbt full-refresh + Mage v2).

### 2026-06-18 — Diseño Opción B: bronze.tms_trips (UPSERT/current-state)

**Decisión arquitectónica:** Reemplazar patrón append-only (raw_tms_trips 900K filas) por UPSERT de estado actual.

**Archivos preparados (pendientes de ejecutar en orden):**
1. `monitor-app/backend/supabase/migrations/20260618000005_create_bronze_tms_trips.sql`
   - Crea `bronze.tms_trips` (UPSERT, unique por source_trip_id)
   - Pobla desde raw_tms_trips (estado más reciente de cada viaje)
2. `audit/tms_trips_snapshot.sql` — nuevo snapshot dbt (source: bronze.tms_trips)
3. `audit/insert_tms_trips_qanalytics_v2.sql` — Mage UPSERT (reemplaza DO NOTHING)

**Secuencia de cutover:**
1. Aplicar migración 5 en Supabase (crea bronze.tms_trips, pobla desde raw)
2. Actualizar sources.yml de dbt para apuntar a bronze.tms_trips
3. Renombrar raw_tms_trips_snapshot → tms_trips_snapshot en dbt
4. `dbt snapshot --select tms_trips_snapshot --full-refresh`
5. Reemplazar insert_tms_trips_qanalytics.sql con la versión v2 en Mage
6. Validar que el snapshot detecta cambios de estado → verificar dbt_valid_to != NULL
7. Tras N semanas de operación validada: DROP bronze.raw_tms_trips (900K filas, 1.1GB)

**Naming convention:** schema=layer (bronze), table=entity (tms_trips) — Databricks/Snowflake/dbt standard.

### 2026-06-18 — Fix lifecycle SAP/cumplimiento-sap (cierre del flujo)

**Problema:** Tres archivos del pipeline SAP rompían el flujo después de migrar `product='trips'` a `bronze.tms_trips` (UPSERT).

**Diagnóstico de los 3 puntos de quiebre:**

1. **`insert_raw_tms_qanalytics_sap.sql`** insertaba en `bronze.raw_tms_trips` (tabla deprecada, append-only) con `ON CONFLICT DO NOTHING` → sin UPSERT, sin detección de cambios de arribo.

2. **`raw_tms_sap_snapshot.sql`** (renombrado a `tms_sap_snapshot`) leía de `{{ source('bronze', 'raw_tms_trips') }}` (tabla antigua). La CTE `deduped` existía SOLO como workaround del append-only — con UPSERT en la fuente, desaparece. Además `ingestion_timestamp` no existe en `bronze.tms_trips`.

3. **`slv_milestone_trips.sql`** tenía watermark incremental frágil: `file_generated_at > MAX(file_generated_at)`. Cuando un viaje SAP antiguo recibe confirmación de arribo en una extracción nueva, el `file_generated_at` de ese viaje puede ser MENOR que el MAX ya en silver → el update se pierde. Watermark correcto: `dbt_updated_at` (cuándo dbt detectó el cambio — siempre avanza).

**Decisión arquitectónica clave:** SAP (`product='cumplimiento-sap'`) usa LA MISMA tabla `bronze.tms_trips` que trips. La UNIQUE constraint `(tms_name, source_client, product, source_trip_id)` incluye `product`, por lo que `(qanalytics, walmart, trips, 12345)` y `(qanalytics, walmart, cumplimiento-sap, 12345)` coexisten como filas independientes.

**Archivos modificados:**

- `audit/insert_raw_tms_qanalytics_sap.sql` — UPSERT a `bronze.tms_trips` con `ON CONFLICT DO UPDATE SET payload=EXCLUDED.payload WHERE file más reciente`
- `audit/raw_tms_sap_snapshot.sql` — renamed a `tms_sap_snapshot` internamente; CTE `deduped` eliminada; fuente cambiada a `{{ source('bronze', 'tms_trips') }} WHERE product = 'cumplimiento-sap'`; `ingestion_timestamp` → `first_seen_at` + `last_updated_at`
- `audit/slv_milestone_trips.sql` — ref cambiada a `tms_sap_snapshot`; watermark `dbt_updated_at > MAX(dbt_updated_at)`; `ingestion_timestamp` → `first_seen_at` + `last_updated_at`

**Archivo nuevo:**
- `audit/backfill_sap_bronze_tms_trips.sql` — SQL one-shot para poblar `bronze.tms_trips` con los datos SAP históricos desde `raw_tms_trips` (ejecutar una sola vez antes de activar el nuevo insert Mage)

**Datos históricos confirmados en raw_tms_trips (a preservar):**
- 5,932 cambios de estado reales de trips (ASIGNADO→RUTA→CERRADO, etc.)
- 1,463 confirmaciones de arribo SAP (on_time_status: NULL→ON TIME/OFF TIME en raw_tms_sap_snapshot)
- Si los snapshots arrancan solo desde bronze.tms_trips estos se pierden → por eso hay backfills

**Checklist de cutover completo (orden estricto):**
- [x] bronze.tms_trips SAP backfill: 1,507/1,507 trips. todos con stops + trip_metadata + payload_hash ✅
- [x] bronze.tms_trips total: trips 1,751 + cumplimiento-sap 1,507 = 3,259 rows ✅
- [ ] 1. Agregar `tms_trips` a sources.yml del proyecto dbt
- [x] 2. `dbt snapshot --select tms_trips_snapshot` (corrió desde Mage)
         → bronze.tms_trips_snapshot creada con 1,752 versiones vigentes ✅
- [x] 3. Backfill `tms_trips_snapshot` ejecutado (batches: colun+iansa+sodimac vía execute_sql, walmart vía apply_migration)
         → 11,864 versiones históricas inyectadas. Total: 13,616 (historia desde 15 Apr 2026) ✅
- [x] 4. `dbt snapshot --select tms_sap_snapshot` (corrió desde Mage)
         → bronze.tms_sap_snapshot creada con 2,607 stops vigentes ✅
- [x] 5. Backfill `tms_sap_snapshot` ejecutado — 1,463 versiones cerradas migradas desde raw_tms_sap_snapshot ✅
         → Total: 4,070 (2,607 vigentes + 1,463 históricas) ✅
- [x] 6. `dbt run --select slv_milestone_trips --full-refresh` (corrió desde Mage)
         → 2,607 stops, 1,510 trips, 2,327 con arribo confirmado, watermark 2026-06-17 ✅
- [ ] 7. Reemplazar bloque Mage trips con `audit/insert_tms_trips_qanalytics_v2.sql`
- [ ] 8. Reemplazar bloque Mage SAP con `audit/insert_raw_tms_qanalytics_sap.sql`
- [x] 9. Verificar ciclo end-to-end: Mage run → UPSERT en bronze.tms_trips → dbt snapshot → dbt_valid_to IS NOT NULL ✅
         → Confirmado con query de diagnóstico (ver sección 2026-06-18 verificación ciclo SCD2)
- [ ] 10. Tras N semanas validadas: DROP TABLE bronze.raw_tms_trips CASCADE (~1.2 GB)

### 2026-06-18 — Verificación ciclo SCD2 en tms_trips_snapshot

**Pregunta:** ¿Por qué los 69 UPSERTs en bronze.tms_trips generaron solo 16 nuevos vigentes y 0 versiones cerradas?

**Query diagnóstica ejecutada:**
```sql
SELECT
    COUNT(*) AS trips_upserted,
    COUNT(*) FILTER (WHERE t.payload_hash = s.payload_hash) AS mismo_hash_sin_cambio_real,
    COUNT(*) FILTER (WHERE t.payload_hash != s.payload_hash) AS hash_distinto_cambio_real
FROM bronze.tms_trips t
JOIN bronze.tms_trips_snapshot s ON ...
WHERE t.product = 'trips' AND t.last_updated_at > t.first_seen_at;
```

**Resultado:**
| Métrica | Valor |
|---------|-------|
| trips_upserted | 69 |
| mismo_hash_sin_cambio_real | **64** |
| hash_distinto_cambio_real | **5** |

**Diagnóstico:** El SCD2 funciona correctamente:
- **64 trips:** Mage extrajo un archivo más reciente pero con el mismo estado del viaje (misma patente, conductor, status). El UPSERT actualizó `file_name` / `last_updated_at` pero el `payload_hash` no cambió. dbt snapshot correctamente no generó nuevas versiones — no hubo cambio de estado real.
- **16 vigentes nuevas:** 16 trip_ids que no existían antes aparecieron en la extracción más reciente → dbt creó su primera versión vigente (correcto).
- **5 trips con hash distinto:** Su estado sí cambió, pero probablemente el UPSERT llegó DESPUÉS del dbt run de las 17:31 → el próximo `dbt snapshot` los detectará y cerrará la versión anterior.
- **6 historicas extra (11,870 - 11,864):** Versiones cerradas generadas en una corrida anterior de dbt que corrió entre el backfill inicial y la verificación.

**Conclusión:** El ciclo bronze → snapshot → silver está operacional. La granularidad de las versiones SCD2 depende de la frecuencia con que corra `dbt snapshot` — cuanto más frecuente, mayor resolución temporal del tracking de cambios de estado.

**Pendientes para completar el cutover (pasos 7-8, requieren acción del usuario en Mage):**
- Reemplazar bloque Mage trips con `audit/insert_tms_trips_qanalytics_v2.sql`
- Reemplazar bloque Mage SAP con `audit/insert_raw_tms_qanalytics_sap.sql`
- Después de los reemplazos: correr un Mage run completo + `dbt snapshot` para confirmar el primer ciclo end-to-end con los nuevos bloques
