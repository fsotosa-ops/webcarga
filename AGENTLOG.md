# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga

## 1. Meta Actual
- Deploy de extraction_service en Cloud Run con CI/CD via GitHub Actions
- Servicio escalable para múltiples TMS ("torres de control")
- QAnalytics adapter escribe en `tms/qanalytics/monitor-trips/`
- Wingsuite adapter escribe en `tms/wingsuite/viajes-transportista/` (integrado 2026-04-14, séptima iteración — ver `extraction_service/AGENTLOG.md` para detalle)
- API unificado (octava iteración, 2026-04-14): `POST /jobs` con `{source, product, ...}` en el body, producto canónico `trips` para qanalytics y wingsuite. Endpoints legacy `/extract/*` quedan como alias deprecados.

## 2. Qué Hicimos

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
