# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga

## 1. Meta Actual
- **FastAPI Monitor API** (`monitor-app/backend/api/`) — API operacional de master data de transportistas, pendiente deploy Cloud Run
- Deploy de extraction_service en Cloud Run con CI/CD via GitHub Actions
- Servicio escalable para múltiples TMS ("torres de control")
- QAnalytics adapter escribe en `tms/qanalytics/monitor-trips/`
- Wingsuite adapter escribe en `tms/wingsuite/viajes-transportista/` (integrado 2026-04-14, séptima iteración — ver `extraction_service/AGENTLOG.md` para detalle)
- API unificado (octava iteración, 2026-04-14): `POST /jobs` con `{source, product, ...}` en el body, producto canónico `trips` para qanalytics y wingsuite. Endpoints legacy `/extract/*` quedan como alias deprecados.

## 2. Qué Hicimos

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

**Checklist (vigésimo-séptima):**
- [x] Root cause confirmado via logs Cloud Run
- [x] Tests RED escritos antes del fix
- [x] Fix 1: eliminar loop `.check()` → evaluate atómico
- [x] Fix 2: `wait_for_timeout(400)` post modal visible
- [x] Fix 3: `expect_response` en `_submit_search`
- [x] 7/7 tests GREEN
- [ ] Deploy a Cloud Run (push a main → CI/CD)
- [ ] Verificar en logs que ya no aparece `Timeout 5000ms exceeded` en modal

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
