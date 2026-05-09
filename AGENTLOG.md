# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga

## 1. Meta Actual
- Deploy de extraction_service en Cloud Run con CI/CD via GitHub Actions
- Servicio escalable para múltiples TMS ("torres de control")
- QAnalytics adapter escribe en `tms/qanalytics/monitor-trips/`
- Wingsuite adapter escribe en `tms/wingsuite/viajes-transportista/` (integrado 2026-04-14, séptima iteración — ver `extraction_service/AGENTLOG.md` para detalle)
- API unificado (octava iteración, 2026-04-14): `POST /jobs` con `{source, product, ...}` en el body, producto canónico `trips` para qanalytics y wingsuite. Endpoints legacy `/extract/*` quedan como alias deprecados.

## 2. Qué Hicimos

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

### 2026-05-08 — Claude Code skills & hooks (decimocuarta iteración)
- **CLAUDE.md root mejorado**: Añadida sección de contexto del proyecto con mapa de archivos, tabla de TMS, patrón de arquitectura y comandos frecuentes. Elimina exploración de archivos al inicio de cada sesión.
- **extraction_service/CLAUDE.md mejorado**: Documentación técnica completa — estructura de directorios, cómo correr tests/dev/smoke test, guía de 4 pasos para agregar un TMS, variables de entorno y notas de browser por TMS.
- **`.claude/settings.json` creado**: Permission allowlist para python3, pytest, uvicorn, curl, docker, find, grep, ls, cp, mv. Hook `Stop` que muestra recordatorio de AGENTLOG.md. Hook `PostToolUse(Edit|Write)` que corre pytest automáticamente al editar archivos de scrapers.
- **Custom commands creados** en `.claude/commands/`:
  - `/run-tests` — corre pytest de extraction_service
  - `/start-dev` — inicia uvicorn en puerto 8080
  - `/smoke-test [source]` — E2E: POST job + poll hasta done/failed
  - `/new-tms` — template completo para agregar un adapter TMS

## 3. Checklist
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
