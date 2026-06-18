# Webcarga — Transport Operations Platform

[![Deploy Extraction Service](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy.yml/badge.svg)](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy.yml)
[![Deploy Monitor API](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy-monitor-api.yml/badge.svg)](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy-monitor-api.yml)
[![Deploy Frontend](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy-frontend.yml/badge.svg)](https://github.com/fsotosa-ops/webcarga/actions/workflows/deploy-frontend.yml)

Plataforma operacional para monitoreo y trazabilidad de viajes en empresas de transporte. Extrae datos de múltiples TMS (Transport Management Systems), normaliza en una arquitectura medallón, y los expone en un dashboard en tiempo real.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     EXTRACTION LAYER                        │
│  extraction_service (Cloud Run)                             │
│  POST /api/v1/jobs → Playwright headless → GCS              │
│  Soporta: QAnalytics · Wingsuite · Sodimac                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ archivos XLS/CSV en GCS
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     DATA PIPELINE (Mage.ai + dbt)           │
│                                                             │
│  bronze.tms_trips (UPSERT, estado actual)                   │
│       ↓ dbt snapshot                                        │
│  bronze.tms_trips_snapshot (SCD Type 2 — historial)         │
│       ↓ dbt run                                             │
│  silver.tms_trips · silver.tms_milestone_trips              │
│       ↓ dbt run                                             │
│  app.trips (agregado operativo, fuente del dashboard)       │
└──────────────────────┬──────────────────────────────────────┘
                       │ PostgreSQL (Supabase)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                     APPLICATION LAYER                       │
│                                                             │
│  monitor-api (Cloud Run)              frontend (Cloud Run)  │
│  FastAPI + asyncpg                    Next.js 16 standalone  │
│  JWT auth (Supabase)                  Supabase Auth          │
│  Redis cache (Upstash)                Rate limiting (Upstash)│
└─────────────────────────────────────────────────────────────┘
```

---

## Services

| Servicio | Ruta | Stack | Ambiente Dev | Ambiente Prod |
|----------|------|-------|--------------|---------------|
| `extraction_service` | `extraction_service/` | Python 3.11, FastAPI, Playwright | `webcarga-extraction-dev` | `webcarga-extraction-prod` |
| `monitor-api` | `monitor-app/backend/api/` | Python 3.11, FastAPI, asyncpg | `webcarga-monitor-api-dev` | `webcarga-monitor-api-prod` |
| `frontend` | `monitor-app/frontend/` | Next.js 16.2.6, TypeScript, Tailwind v4 | `webcarga-frontend-dev` | `webcarga-frontend-prod` |

---

## CI/CD

### Branch Strategy

```
dev   ──push──▶  GitHub Actions  ──▶  Cloud Run *-dev   (staging)
main  ──push──▶  GitHub Actions  ──▶  Cloud Run *-prod  (production)
```

Cada servicio tiene su propio workflow en `.github/workflows/` con path filters — solo se despliega cuando cambian archivos de ese servicio.

### GitHub Secrets requeridos

| Secret | Descripción |
|--------|-------------|
| `GCP_PROJECT_ID` | ID del proyecto GCP |
| `WIF_PROVIDER` | Workload Identity Federation provider |
| `WIF_SA_EMAIL` | Service Account para WIF |
| `CLOUD_RUN_SA_EMAIL` | SA para extraction_service Cloud Run |
| `MONITOR_API_CLOUD_RUN_SA` | SA para monitor-api Cloud Run |
| `FRONTEND_CLOUD_RUN_SA` | SA para frontend Cloud Run |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública de Supabase (build-arg frontend) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key de Supabase (build-arg frontend) |

### GCP Secret Manager (secrets de runtime)

```bash
# extraction_service
gcloud secrets create qanalytics-user --data-file=-
gcloud secrets create gcs-bucket-name --data-file=-
# (ver deploy.yml para lista completa)

# monitor-api
gcloud secrets create monitor-api-database-url --data-file=-
gcloud secrets create monitor-api-upstash-url --data-file=-
gcloud secrets create monitor-api-upstash-token --data-file=-

# frontend
gcloud secrets create frontend-fastapi-url-dev --data-file=-   # URL de webcarga-monitor-api-dev
gcloud secrets create frontend-fastapi-url-prod --data-file=-  # URL de webcarga-monitor-api-prod
gcloud secrets create frontend-upstash-url --data-file=-
gcloud secrets create frontend-upstash-token --data-file=-
```

---

## Local Development

### Prerequisites

- Python 3.11+ — `pyenv install 3.11`
- Node.js 22+ — `nvm install 22`
- Docker Desktop
- GCP CLI (`brew install google-cloud-sdk`)

### extraction_service

```bash
cd extraction_service
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env  # llenar credenciales TMS
uvicorn app.main:app --reload --port 8080

# Smoke test
curl -s -X POST http://localhost:8080/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"source":"sodimac","product":"trips","client_name":"test"}' | python3 -m json.tool
```

### monitor-api

```bash
cd monitor-app/backend/api
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env  # llenar DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
uvicorn app.main:app --reload --port 8001

# Tests
python -m pytest tests/ -v
```

### frontend

```bash
cd monitor-app/frontend
npm install
cp .env.local.example .env.local  # llenar NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, FASTAPI_URL
npm run dev  # http://localhost:3000
```

---

## Data Pipeline

El pipeline corre en **Mage.ai** cada 15 minutos:

1. `extraction_service` descarga archivos desde cada TMS → los sube a GCS
2. Mage lee los archivos de GCS y hace UPSERT en `bronze.tms_trips`
3. `dbt snapshot tms_trips_snapshot` detecta cambios de estado → registra historial SCD2
4. `dbt run` genera `silver.tms_trips`, `silver.tms_milestone_trips`, y `app.trips`

Para agregar un nuevo TMS adapter: ver skill `/new-tms` en `extraction_service/`.

---

## Infrastructure

| Servicio GCP | Uso |
|-------------|-----|
| Cloud Run | Los 3 servicios de aplicación |
| Artifact Registry | Repositorio Docker (`us-central1-docker.pkg.dev/{PROJECT}/webcarga/`) |
| Secret Manager | Credenciales de runtime (TMS passwords, DB URL, Upstash tokens) |
| GCS | Almacenamiento de archivos TMS extraídos |
| Workload Identity Federation | Auth sin service account keys para GitHub Actions |

| Servicio externo | Uso |
|-----------------|-----|
| Supabase | PostgreSQL + Auth + Row Level Security |
| Upstash | Redis serverless — JWT cache, API response cache, rate limiting |
| Mage.ai | Orquestación del pipeline de datos |
