# Design: CI/CD Cloud Run (dev/prod) + Upstash Redis + Bronze Cleanup + README
**Date:** 2026-06-18  
**Status:** Approved

---

## Context

El proyecto webcarga tiene tres servicios productivos:
- `extraction_service` — FastAPI + Playwright, desplegado en Cloud Run (`webcarga-extraction`)
- `monitor-api` — FastAPI + asyncpg, desplegado en Cloud Run (`webcarga-monitor-api`)
- `frontend` — Next.js 16.2.6, desplegado en Vercel

Los tres workflows de CI/CD existentes solo tienen un ambiente (prod directo desde `main`). El objetivo es:
1. Agregar ambiente `dev` branch-based para los tres servicios, migrando el frontend de Vercel a Cloud Run
2. Integrar Upstash Redis en monitor-api (API cache, JWT cache, rate limiting) y en el frontend (rate limiting de middleware)
3. Eliminar `bronze.raw_tms_trips` y `bronze.raw_tms_trips_snapshot` (reemplazadas por `bronze.tms_trips` + `bronze.tms_trips_snapshot` en migración `20260618000005`)
4. Escribir un README.md profesional a nivel de monorepo

---

## Decisiones de arquitectura

| Decisión | Elección | Alternativa descartada |
|----------|----------|----------------------|
| Dev/prod strategy | Branch-based (`dev`→dev, `main`→prod) | Manual promotion con approval gate |
| Frontend runtime | Next.js standalone en Cloud Run | Mantener Vercel |
| Redis provider | Upstash REST API (HTTP, serverless-friendly) | Cloud Memorystore (requiere VPC Connector) |
| Dominios | URLs automáticas Cloud Run | Custom domain (postergar) |

---

## Bloque 1 — CI/CD Branch-aware (3 workflows)

### Patrón de branching

```
push a `dev`  → SERVICE_NAME = webcarga-{service}-dev  (resources reducidos)
push a `main` → SERVICE_NAME = webcarga-{service}-prod (resources full)
```

Implementado con una sola variable condicional en cada workflow:

```yaml
env:
  ENV_SUFFIX: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}
```

Y el SERVICE_NAME se convierte en `webcarga-{service}-${{ env.ENV_SUFFIX }}`.

### Cambios por workflow

**`.github/workflows/deploy.yml`** (extraction_service)  
- Trigger: branches `[main, dev]`; paths `extraction_service/**`
- Agregar `ENV_SUFFIX` condicional
- SERVICE_NAME: `webcarga-extraction-${{ env.ENV_SUFFIX }}`
- Dev resources: `--memory=2Gi --cpu=1 --max-instances=1` (prod mantiene 4Gi/2cpu/3 instancias)

**`.github/workflows/deploy-monitor-api.yml`** (monitor-api)  
- Trigger: branches `[main, dev]`; paths `monitor-app/backend/api/**`
- SERVICE_NAME: `webcarga-monitor-api-${{ env.ENV_SUFFIX }}`
- Agregar secrets Upstash (ver Bloque 2)
- Dev resources: iguales (512Mi ya es mínimo razonable)

**`.github/workflows/deploy-frontend.yml`** (frontend → Cloud Run)  
- Reemplazar completamente: eliminar steps de Vercel, agregar GCP auth + Docker + Cloud Run
- SERVICE_NAME: `webcarga-frontend-${{ env.ENV_SUFFIX }}`
- Trigger: branches `[main, dev]`; paths `monitor-app/frontend/**`
- Pasar `NEXT_PUBLIC_*` como build-args desde GitHub Secrets
- `FASTAPI_URL` como runtime env var (apunta a monitor-api dev o prod según ENV_SUFFIX)
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` como secrets de Cloud Run
- Resources: `--memory=512Mi --cpu=1 --concurrency=80 --max-instances=5`

---

## Bloque 2 — Frontend: Dockerfile + next.config.ts

### `monitor-app/frontend/Dockerfile` (nuevo)

Build multi-stage, patrón Next.js standalone:

```
Stage 1 (deps):  node:22-alpine — npm ci
Stage 2 (build): COPY deps + source; ARGs para NEXT_PUBLIC_*; npm run build
Stage 3 (runner): node:22-alpine — solo .next/standalone + static + public; CMD node server.js
```

Variables en el Dockerfile:
- Build-args: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Runtime env: `FASTAPI_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PORT=3000`, `HOSTNAME=0.0.0.0`

### `monitor-app/frontend/next.config.ts`

Agregar `output: 'standalone'` — único cambio requerido para que `npm run build` genere `.next/standalone/`.

### Supabase redirect URLs post-deploy

Después del primer deploy, agregar las nuevas URLs de Cloud Run en Supabase → Authentication → URL Configuration → Redirect URLs. Mantener la URL de Vercel hasta completar la migración.

### GitHub Secrets requeridos (nuevos)

| Secret | Uso |
|--------|-----|
| `NEXT_PUBLIC_SUPABASE_URL` | Build-arg frontend |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Build-arg frontend |
| `FRONTEND_CLOUD_RUN_SA` | Service Account para Cloud Run frontend |
| `MONITOR_API_URL_DEV` | Runtime FASTAPI_URL para frontend-dev |
| `MONITOR_API_URL_PROD` | Runtime FASTAPI_URL para frontend-prod |
| `UPSTASH_REDIS_REST_URL` | Compartido frontend + monitor-api |
| `UPSTASH_REDIS_REST_TOKEN` | Compartido frontend + monitor-api |

Valores de Upstash (ya en `.env.local`):
- URL: `https://included-serval-41602.upstash.io`
- Token: `AqKCAAIgcDFbv_jln02vOCwWYhqxELNg4FoZNxy5lEkVWq03tgD1pQ`

---

## Bloque 3 — Upstash Redis Integration

### 3a. Frontend — `@upstash/ratelimit` en middleware

Paquetes a instalar: `@upstash/redis @upstash/ratelimit`

**`monitor-app/frontend/proxy.ts`** (ya existe como middleware):
- Inicializar Redis client y Ratelimit (sliding window, 20 req/10s por IP)
- Si rate limit excedido → return `Response` 429 con `Retry-After`
- Solo limitar requests a `/api/*` y `/dashboard/*`, no assets estáticos

```ts
// patrón upstash ratelimit en middleware
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),  // lee UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
  limiter: Ratelimit.slidingWindow(20, "10 s"),
})
```

### 3b. Monitor-api — cache + JWT cache

**Paquete:** `upstash-redis>=1.1.0` (agregar a `monitor-app/backend/api/pyproject.toml`)

**`monitor-app/backend/api/app/cache.py`** (nuevo):  
- Singleton `get_redis()` → `Redis(url=settings.UPSTASH_REDIS_REST_URL, token=settings.UPSTASH_REDIS_REST_TOKEN)`
- `cache_get(key)` / `cache_set(key, value, ex=30)` helpers

**`monitor-app/backend/api/app/core/config.py`** (existente):  
- Agregar `UPSTASH_REDIS_REST_URL: str = ""` y `UPSTASH_REDIS_REST_TOKEN: str = ""`
- Redis opcional (si las vars están vacías, cache está deshabilitado)

**`monitor-app/backend/api/app/auth.py`** (existente):  
- Antes de verificar JWT con PyJWT: intentar `cache_get(f"jwt:{token_hash}")`
- Si hit → retornar directo (evita PyJWT + lookup en `public.profiles`)
- Si miss → verificar normalmente y `cache_set(key, payload, ex=60)`
- Token hash = `hashlib.sha256(token.encode()).hexdigest()[:16]` (no guardar el token completo)

**`monitor-app/backend/api/app/middleware/cache.py`** (nuevo):  
- FastAPI middleware que cachea respuestas GET con status 200
- Cache key: `api:{path}:{sorted_query_string}`
- TTL: 30s para `/api/v1/trips*`, `/api/v1/transporters*`; 300s para `/api/v1/roles`, `/api/v1/trips/meta`
- Excluye rutas con auth write: `PATCH`, `POST`, `DELETE` nunca se cachean

**`monitor-app/backend/api/app/main.py`** (existente):  
- Registrar `CacheMiddleware` antes de las rutas

### GCP Secret Manager (nuevos secrets para monitor-api)

```bash
echo -n "https://included-serval-41602.upstash.io" | gcloud secrets create monitor-api-upstash-url --data-file=-
echo -n "AqKCAAIgcDFbv_jln02vOCwWYhqxELNg4FoZNxy5lEkVWq03tgD1pQ" | gcloud secrets create monitor-api-upstash-token --data-file=-
```

Agregar al deploy-monitor-api.yml en `--set-secrets`:
```
UPSTASH_REDIS_REST_URL=monitor-api-upstash-url:latest,UPSTASH_REDIS_REST_TOKEN=monitor-api-upstash-token:latest
```

---

## Bloque 4 — Bronze Tables Deprecation

### Nueva migración: `20260618000006_drop_deprecated_bronze_tables.sql`

```sql
-- Seguro: bronze.tms_trips + bronze.tms_trips_snapshot son las tablas activas.
-- raw_tms_trips: sin referencias en frontend/API; pipeline migrado a bronze.tms_trips.
-- raw_tms_trips_snapshot: reemplazada por tms_trips_snapshot (dbt snapshot desde tms_trips).

-- 1. Revocar permisos / eliminar políticas (CASCADE las elimina con la tabla, pero explícito)
DROP POLICY IF EXISTS "bronze_trips_read" ON bronze.raw_tms_trips;

-- 2. Drop tablas deprecated (CASCADE elimina índices, constraints, RLS)
DROP TABLE IF EXISTS bronze.raw_tms_trips_snapshot CASCADE;
DROP TABLE IF EXISTS bronze.raw_tms_trips CASCADE;
```

**Por qué es seguro:**
- Migration `20260618000005` backfilleó todos los datos a `bronze.tms_trips`
- El mismo archivo tiene los DROPs comentados al final (líneas 83-84), indicando intención explícita
- No hay referencias en `monitor-app/frontend/` ni en `monitor-app/backend/api/`
- El pipeline de Mage ya apunta a `bronze.tms_trips` (UPSERT)

**Aplicar con:** `mcp__claude_ai_Supabase__apply_migration` o vía Supabase CLI `supabase db push`

---

## Bloque 5 — README.md

**Ubicación:** `/Users/usuario/Desktop/projects/webcarga/README.md` (raíz del monorepo)

**Secciones:**
1. Badges (CI status, Cloud Run deployment, Supabase)
2. Overview del producto (1 párrafo)
3. Architecture diagram (ASCII art con 3 capas: extraction → pipeline → monitor)
4. Services table (nombre, ruta, stack, URL prod)
5. Data pipeline (medallion: bronze → silver → gold → app)
6. Local development (prerequisites, env setup, comandos por servicio)
7. CI/CD (branch strategy diagram, environments, GitHub Secrets checklist)
8. Infrastructure (GCP services, Supabase, Upstash)
9. Adding a new TMS adapter (link a `/new-tms` skill)

---

## Orden de implementación

1. `next.config.ts` → agregar `output: 'standalone'`
2. `monitor-app/frontend/Dockerfile` → crear
3. Actualizar los 3 workflows de CI/CD (branch-aware + frontend a Cloud Run)
4. `@upstash/redis` + `@upstash/ratelimit` → instalar en frontend; update `proxy.ts`
5. `upstash-redis` → agregar en monitor-api `pyproject.toml`; crear `cache.py` + middleware; actualizar `auth.py`, `config.py`, `main.py`
6. Agregar secrets Upstash a GCP Secret Manager + workflows
7. Migración bronze DROP → crear archivo + aplicar vía MCP Supabase
8. `README.md` → escribir

---

## Verificación

```bash
# 1. Build local del frontend (verifica standalone output)
cd monitor-app/frontend && npm run build
ls .next/standalone/  # debe existir server.js

# 2. Test Docker frontend local
docker build -t webcarga-frontend-test \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://viclzoftiudkepqnhekv.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon_key> \
  monitor-app/frontend
docker run -p 3000:3000 -e FASTAPI_URL=http://localhost:8001 webcarga-frontend-test
# curl http://localhost:3000 → 200

# 3. Test Redis cache (monitor-api local)
cd monitor-app/backend/api && UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... uvicorn app.main:app --port 8001
curl http://localhost:8001/api/v1/trips  # 1ra call: cache miss
curl http://localhost:8001/api/v1/trips  # 2da call: X-Cache: HIT en headers

# 4. Verificar migración bronze
SELECT count(*) FROM bronze.raw_tms_trips;        -- debe retornar "relation does not exist"
SELECT count(*) FROM bronze.tms_trips;            -- debe retornar N filas (datos activos)
SELECT count(*) FROM bronze.tms_trips_snapshot;   -- debe existir (dbt snapshot activo)

# 5. CI/CD — push a branch `dev` y verificar que despliega a *-dev en Cloud Run
git checkout -b dev && git push origin dev
# GitHub Actions debe mostrar deploy a webcarga-extraction-dev, webcarga-monitor-api-dev, webcarga-frontend-dev
```
