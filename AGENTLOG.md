# CLAUDE CONTEXT MEMORY
> Proyecto: webcarga

### 2026-06-18 — CI/CD + Upstash Redis + Bronze Cleanup + README (COMPLETO)

**Objetivo:** 6 tareas — branch-aware CI/CD, frontend de Vercel a Cloud Run, Upstash Redis (cache + rate limiting), DROP tablas bronze deprecadas, README profesional. Todo completado, revisado y aprobado.

---

## Commits de esta sesión

| Hash | Descripción |
|------|-------------|
| `799945f` | feat(frontend): Next.js standalone output + Dockerfile para Cloud Run |
| `acee7de` | feat(ci): branch-aware dev/prod Cloud Run + migrate frontend from Vercel |
| `d4aae4e` | feat(frontend): rate limiting via Upstash en middleware |
| `b8eaf31` | feat(monitor-api): Upstash Redis — JWT cache + API response cache |
| `01a766e` | feat(db): drop bronze.raw_tms_trips + raw_tms_trips_snapshot |
| `0abd4b0` | docs: add professional monorepo README |
| `fd3bcbc` | fix: cache auth bypass + remove dead test + add env examples |

---

## Qué hicimos

### Task 1 — Frontend Dockerfile (799945f)
- `monitor-app/frontend/next.config.ts`: agregado `output: 'standalone'`
- `monitor-app/frontend/Dockerfile`: multi-stage Node 22-alpine (deps → builder → runner)
  - Build-args: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - Runtime env: `FASTAPI_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `PORT=3000`

### Task 2 — CI/CD Branch-aware (acee7de)
- **`.github/workflows/deploy.yml`**: branches `[main, dev]`, `ENV_SUFFIX` condicional, service `webcarga-extraction-${{ env.ENV_SUFFIX }}`
- **`.github/workflows/deploy-monitor-api.yml`**: idem + secrets Upstash
- **`.github/workflows/deploy-frontend.yml`**: reemplazado completamente Vercel → GCP Docker + Cloud Run, service `webcarga-frontend-${{ env.ENV_SUFFIX }}`

### Task 3 — Frontend Rate Limiting (d4aae4e)
- `monitor-app/frontend/proxy.ts`: Upstash `@upstash/ratelimit` sliding window (20 req/10s por IP)
- Solo limita `/api/*` y `/dashboard/*`; 429 con `Retry-After: 10`

### Task 4 — Monitor-API Redis Cache (b8eaf31)
- `monitor-app/backend/api/app/cache.py`: helpers `cache_get` / `cache_set` con Redis opcional
- `monitor-app/backend/api/app/middleware/cache.py`: solo cachea rutas públicas (`/api/v1/roles`, `/api/v1/trips/meta`) — rutas auth-protected NO se cachean a nivel middleware
- `monitor-app/backend/api/app/auth.py`: JWT cache 60s (`jwt:{sha256[:16]}`)
- 12/12 tests pasan

### Task 5 — Bronze DROP Migration (01a766e)
- `monitor-app/backend/supabase/migrations/20260618000006_drop_deprecated_bronze_tables.sql`
- Aplicada a Supabase `viclzoftiudkepqnhekv`
- Pre-drop: `tms_trips` = 3322 filas, `tms_trips_snapshot` = 13805 filas (backfill OK)
- Post-drop: solo `tms_trips` + `tms_trips_snapshot` en bronze schema

### Task 6 — README (0abd4b0 + fix fd3bcbc)
- `README.md`: badges, arquitectura ASCII, tabla de servicios, CI/CD branch strategy, local dev para 3 servicios, infra table
- Fix final: security issue en CacheMiddleware (auth bypass en cache hits de rutas dinámicas) + test file muerto eliminado + `.env.example` files creados

---

## Decisiones de arquitectura clave

| Decisión | Elección | Razón |
|----------|----------|-------|
| CacheMiddleware scope | Solo rutas públicas (`/roles`, `/trips/meta`) | Middleware corre ANTES de `Depends(get_current_user)` — cachear rutas auth es bypass de seguridad |
| Middleware ordering (Starlette) | `CacheMiddleware` add BEFORE `CORSMiddleware` | Último en `add_middleware` = más externo; CORS debe ser outer para headers en cache hits |
| `NEXT_PUBLIC_*` en build | Build-args Docker (no runtime) | Son claves públicas del browser — se hornean en el bundle |
| Redis en monitor-api | Upstash REST (no TCP) | Serverless-friendly, no requiere VPC Connector como Cloud Memorystore |

---

## Próximos pasos (manual)

### Antes del primer push a `dev`:

1. **GCP Secret Manager** — ejecutar `./scripts/infra-init.sh` (lee credenciales de `.env.local`)

2. **GitHub Secrets** — el mismo script los setea vía `gh secret set`
   - `FRONTEND_CLOUD_RUN_SA` = Service Account JSON para el frontend Cloud Run

3. **Después del primer deploy** — actualizar `frontend-fastapi-url-{dev,prod}` secrets con las URLs reales de Cloud Run del monitor-api

4. **Supabase Auth** — agregar nuevas URLs de Cloud Run del frontend en Authentication → URL Configuration → Redirect URLs

5. **Service Account** — crear SA para `webcarga-frontend-{dev,prod}` si no existe

---

## Estado del branch

`main` branch — 7 commits sobre `eb2af2a`. Review final: **Ready to merge** (no hay findings pendientes).
