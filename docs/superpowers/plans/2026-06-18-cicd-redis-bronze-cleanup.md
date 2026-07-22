# CI/CD Cloud Run + Upstash Redis + Bronze Cleanup + README — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar CI/CD branch-aware dev/prod para los 3 servicios (migrar frontend de Vercel a Cloud Run), integrar Upstash Redis en monitor-api y frontend, eliminar tablas bronze deprecadas, y escribir un README profesional.

**Architecture:** Branch `dev` → servicios Cloud Run `*-dev`; branch `main` → servicios `*-prod`. Frontend usa Next.js standalone output en Docker. Redis (Upstash REST) provee JWT cache + API response cache en monitor-api, y rate limiting en el middleware de Next.js.

**Tech Stack:** Next.js 16.2.6 (standalone), Docker multi-stage (Node 22-alpine), GitHub Actions, `@upstash/redis`, `@upstash/ratelimit`, `upstash-redis` (Python async), FastAPI `BaseHTTPMiddleware`, Supabase SQL migrations.

## Global Constraints

- Node version: 22-alpine en Dockerfile del frontend
- Python: >=3.11 (monitor-api pyproject.toml)
- Next.js: 16.2.6 — leer `node_modules/next/dist/docs/` antes de tocar config
- `proxy.ts` es el middleware de Next.js (no `middleware.ts`) — ver AGENTS.md del frontend
- Upstash REST URL: `https://included-serval-41602.upstash.io` — token en `.env.local`
- Todos los ENV vars nuevos en Cloud Run se pasan via `--set-secrets` apuntando a GCP Secret Manager
- GitHub Secrets ya existentes usados por workflows: `GCP_PROJECT_ID`, `WIF_PROVIDER`, `WIF_SA_EMAIL`
- Orden de middleware en FastAPI (Starlette): last-added = outermost — CacheMiddleware se agrega ANTES que CORSMiddleware para que CORS sea outer

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `monitor-app/frontend/next.config.ts` | Modify | Habilitar `output: 'standalone'` |
| `monitor-app/frontend/Dockerfile` | Create | Build multi-stage Next.js → imagen Cloud Run |
| `.github/workflows/deploy-frontend.yml` | Rewrite | Reemplazar Vercel por Cloud Run branch-aware |
| `.github/workflows/deploy.yml` | Modify | Agregar branch `dev` + ENV_SUFFIX + recursos dev |
| `.github/workflows/deploy-monitor-api.yml` | Modify | Agregar branch `dev` + ENV_SUFFIX + secrets Upstash |
| `monitor-app/frontend/proxy.ts` | Modify | Agregar rate limiting Upstash antes del auth check |
| `monitor-app/backend/api/pyproject.toml` | Modify | Agregar `upstash-redis>=1.1.0` |
| `monitor-app/backend/api/app/config.py` | Modify | Agregar `upstash_redis_rest_url` + `upstash_redis_rest_token` |
| `monitor-app/backend/api/app/cache.py` | Create | Singleton Redis async + helpers `cache_get`/`cache_set` |
| `monitor-app/backend/api/app/auth.py` | Modify | JWT cache: hash token → Redis (TTL 60s) |
| `monitor-app/backend/api/app/middleware/__init__.py` | Create | Paquete vacío |
| `monitor-app/backend/api/app/middleware/cache.py` | Create | BaseHTTPMiddleware que cachea GET 200 (TTL variable) |
| `monitor-app/backend/api/app/main.py` | Modify | Registrar CacheMiddleware (antes de CORS) |
| `monitor-app/backend/supabase/migrations/20260618000006_drop_deprecated_bronze_tables.sql` | Create | DROP bronze.raw_tms_trips + bronze.raw_tms_trips_snapshot |
| `README.md` | Create | Documentación monorepo completa |

---

## Task 1: Frontend Standalone Dockerfile

**Files:**
- Modify: `monitor-app/frontend/next.config.ts`
- Create: `monitor-app/frontend/Dockerfile`

**Interfaces:**
- Produces: imagen Docker que arranca en `PORT=3000` con `node server.js`; acepta build-args `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`; acepta runtime env `FASTAPI_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

- [ ] **Step 1: Agregar `output: 'standalone'` a next.config.ts**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Verificar que el build local genera standalone**

```bash
cd monitor-app/frontend
npm run build
ls .next/standalone/
```

Esperado: directorio con `server.js` y subdirectorio `node_modules`.

- [ ] **Step 3: Crear Dockerfile**

```dockerfile
# monitor-app/frontend/Dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
```

- [ ] **Step 4: Hacer build Docker local y verificar que arranca**

```bash
cd monitor-app/frontend
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://viclzoftiudkepqnhekv.supabase.co \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpY2x6b2Z0aXVka2VwcW5oZWt2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0MzgzNTQsImV4cCI6MjA5MjAxNDM1NH0.YcNTWctL1JLvsi0RY3G6HX7MeKpvw4OkMvfI4wDZqPs \
  -t webcarga-frontend-test .
docker run --rm -p 3000:3000 \
  -e FASTAPI_URL=http://host.docker.internal:8001 \
  webcarga-frontend-test &
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://localhost:3000
```

Esperado: `200` (o `307` si redirige a /login).

- [ ] **Step 5: Commit**

```bash
git add monitor-app/frontend/next.config.ts monitor-app/frontend/Dockerfile
git commit -m "feat(frontend): Next.js standalone output + Dockerfile para Cloud Run"
```

---

## Task 2: CI/CD Branch-Aware (3 workflows)

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `.github/workflows/deploy-monitor-api.yml`
- Rewrite: `.github/workflows/deploy-frontend.yml`

**Interfaces:**
- Consumes: Dockerfile de Task 1 para el frontend
- Produces: 6 Cloud Run services (`webcarga-{extraction,monitor-api,frontend}-{dev,prod}`) desplegados automáticamente según rama

- [ ] **Step 1: Actualizar deploy.yml (extraction_service)**

Reemplazar el archivo completo con:

```yaml
name: Deploy Extraction Service

on:
  push:
    branches: [main, dev]
    paths:
      - "extraction_service/**"
      - ".github/workflows/deploy.yml"

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  REPOSITORY: webcarga
  IMAGE_NAME: extraction-service
  CLOUD_RUN_SA: ${{ secrets.CLOUD_RUN_SA_EMAIL }}
  ENV_SUFFIX: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SA_EMAIL }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build Docker image
        run: |
          docker build \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest \
            ./extraction_service

      - name: Push Docker image
        run: |
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: webcarga-extraction-${{ env.ENV_SUFFIX }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          flags: >-
            --memory=${{ env.ENV_SUFFIX == 'prod' && '4Gi' || '2Gi' }}
            --cpu=${{ env.ENV_SUFFIX == 'prod' && '2' || '1' }}
            --timeout=600
            --concurrency=1
            --min-instances=0
            --max-instances=${{ env.ENV_SUFFIX == 'prod' && '3' || '1' }}
            --no-cpu-throttling
            --service-account=${{ env.CLOUD_RUN_SA }}
            --allow-unauthenticated
            --set-env-vars=BROWSER_HEADLESS=true,ENVIRONMENT=${{ env.ENV_SUFFIX }}
            --set-secrets=QANALYTICS_USER=qanalytics-user:latest,QANALYTICS_PASS=qanalytics-pass:latest,WINGSUITE_USER=wingsuite-user:latest,WINGSUITE_PASS=wingsuite-pass:latest,SODIMAC_USER=sodimac-user:latest,SODIMAC_PASS=sodimac-pass:latest,SODIMAC_URL=sodimac-url:latest,GCS_BUCKET_NAME=gcs-bucket-name:latest

      - name: Show service URL
        run: |
          URL=$(gcloud run services describe webcarga-extraction-${{ env.ENV_SUFFIX }} \
            --region=${{ env.REGION }} \
            --format="value(status.url)")
          echo "Service deployed at: ${URL}"
```

- [ ] **Step 2: Actualizar deploy-monitor-api.yml**

Reemplazar el archivo completo con:

```yaml
name: Deploy Monitor API

on:
  push:
    branches: [main, dev]
    paths:
      - "monitor-app/backend/api/**"
      - ".github/workflows/deploy-monitor-api.yml"
  workflow_dispatch:

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  REPOSITORY: webcarga
  IMAGE_NAME: monitor-api
  CLOUD_RUN_SA: ${{ secrets.MONITOR_API_CLOUD_RUN_SA }}
  ENV_SUFFIX: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SA_EMAIL }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build Docker image
        run: |
          docker build \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest \
            ./monitor-app/backend/api

      - name: Push Docker image
        run: |
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: webcarga-monitor-api-${{ env.ENV_SUFFIX }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          flags: >-
            --memory=512Mi
            --cpu=1
            --timeout=60
            --concurrency=80
            --min-instances=0
            --max-instances=5
            --service-account=${{ env.CLOUD_RUN_SA }}
            --allow-unauthenticated
            --set-env-vars=ENVIRONMENT=${{ env.ENV_SUFFIX }}
            --set-secrets=DATABASE_URL=monitor-api-database-url:latest,SUPABASE_URL=monitor-api-supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=monitor-api-supabase-service-role-key:latest,ALLOWED_ORIGINS=monitor-api-allowed-origins:latest,UPSTASH_REDIS_REST_URL=monitor-api-upstash-url:latest,UPSTASH_REDIS_REST_TOKEN=monitor-api-upstash-token:latest

      - name: Show service URL
        run: |
          URL=$(gcloud run services describe webcarga-monitor-api-${{ env.ENV_SUFFIX }} \
            --region=${{ env.REGION }} \
            --format="value(status.url)")
          echo "Service deployed at: ${URL}"
```

- [ ] **Step 3: Reemplazar deploy-frontend.yml (Vercel → Cloud Run)**

```yaml
name: Deploy Frontend

on:
  push:
    branches: [main, dev]
    paths:
      - "monitor-app/frontend/**"
      - ".github/workflows/deploy-frontend.yml"
  workflow_dispatch:

env:
  PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
  REGION: us-central1
  REPOSITORY: webcarga
  IMAGE_NAME: frontend
  CLOUD_RUN_SA: ${{ secrets.FRONTEND_CLOUD_RUN_SA }}
  ENV_SUFFIX: ${{ github.ref_name == 'main' && 'prod' || 'dev' }}

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write

    steps:
      - uses: actions/checkout@v4

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SA_EMAIL }}

      - uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker
        run: gcloud auth configure-docker ${{ env.REGION }}-docker.pkg.dev --quiet

      - name: Build Docker image
        run: |
          docker build \
            --build-arg NEXT_PUBLIC_SUPABASE_URL=${{ secrets.NEXT_PUBLIC_SUPABASE_URL }} \
            --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=${{ secrets.NEXT_PUBLIC_SUPABASE_ANON_KEY }} \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }} \
            -t ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest \
            ./monitor-app/frontend

      - name: Push Docker image
        run: |
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          docker push ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}-${{ env.ENV_SUFFIX }}:latest

      - name: Deploy to Cloud Run
        uses: google-github-actions/deploy-cloudrun@v2
        with:
          service: webcarga-frontend-${{ env.ENV_SUFFIX }}
          region: ${{ env.REGION }}
          image: ${{ env.REGION }}-docker.pkg.dev/${{ env.PROJECT_ID }}/${{ env.REPOSITORY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          flags: >-
            --memory=512Mi
            --cpu=1
            --timeout=60
            --concurrency=80
            --min-instances=0
            --max-instances=5
            --service-account=${{ env.CLOUD_RUN_SA }}
            --allow-unauthenticated
            --set-env-vars=ENVIRONMENT=${{ env.ENV_SUFFIX }}
            --set-secrets=FASTAPI_URL=frontend-fastapi-url-${{ env.ENV_SUFFIX }}:latest,UPSTASH_REDIS_REST_URL=frontend-upstash-url:latest,UPSTASH_REDIS_REST_TOKEN=frontend-upstash-token:latest

      - name: Show service URL
        run: |
          URL=$(gcloud run services describe webcarga-frontend-${{ env.ENV_SUFFIX }} \
            --region=${{ env.REGION }} \
            --format="value(status.url)")
          echo "Frontend deployed at: ${URL}"
          echo "IMPORTANTE: Si es el primer deploy, agregar esta URL en Supabase → Auth → Redirect URLs"
```

> **Nota GCP Secret Manager:** Crear estos secrets antes del primer deploy:
> ```bash
> echo -n "https://webcarga-monitor-api-dev-XXX.run.app" | gcloud secrets create frontend-fastapi-url-dev --data-file=-
> echo -n "https://webcarga-monitor-api-PROD-XXX.run.app" | gcloud secrets create frontend-fastapi-url-prod --data-file=-
> echo -n "https://included-serval-41602.upstash.io" | gcloud secrets create frontend-upstash-url --data-file=-
> echo -n "AqKCAAIgcDFbv_jln02vOCwWYhqxELNg4FoZNxy5lEkVWq03tgD1pQ" | gcloud secrets create frontend-upstash-token --data-file=-
> echo -n "https://included-serval-41602.upstash.io" | gcloud secrets create monitor-api-upstash-url --data-file=-
> echo -n "AqKCAAIgcDFbv_jln02vOCwWYhqxELNg4FoZNxy5lEkVWq03tgD1pQ" | gcloud secrets create monitor-api-upstash-token --data-file=-
> ```
> También crear el GitHub Secret `FRONTEND_CLOUD_RUN_SA` (mismo SA que `MONITOR_API_CLOUD_RUN_SA` o uno dedicado).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy.yml \
        .github/workflows/deploy-monitor-api.yml \
        .github/workflows/deploy-frontend.yml
git commit -m "feat(ci): branch-aware dev/prod Cloud Run + migrate frontend from Vercel"
```

---

## Task 3: Frontend Rate Limiting (Upstash)

**Files:**
- Modify: `monitor-app/frontend/package.json` (via npm install)
- Modify: `monitor-app/frontend/proxy.ts`

**Interfaces:**
- Consumes: env vars `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (runtime, Cloud Run secret; en local se leen de `.env.local`)
- Produces: 429 con `Retry-After: 10` cuando un IP supera 20 req/10s en rutas `/api/*` y `/dashboard/*`

- [ ] **Step 1: Instalar dependencias**

```bash
cd monitor-app/frontend
npm install @upstash/redis @upstash/ratelimit
```

Verificar que se actualizó `package.json` con las nuevas deps.

- [ ] **Step 2: Escribir test del rate limiter (archivo nuevo)**

Crear `monitor-app/frontend/__tests__/ratelimit.test.ts`:

```ts
// Este test verifica la lógica de decisión del rate limiter sin llamar a Redis real.
// Usa un mock de Ratelimit para aislar el comportamiento del middleware.
import { NextRequest } from "next/server"

// Mock de @upstash/ratelimit: simula éxito en el primer intento y falla en el segundo
const mockLimit = jest.fn()
jest.mock("@upstash/ratelimit", () => ({
  Ratelimit: class {
    static slidingWindow = jest.fn().mockReturnValue("limiter")
    constructor() {}
    limit = mockLimit
  },
}))
jest.mock("@upstash/redis", () => ({
  Redis: { fromEnv: jest.fn().mockReturnValue({}) },
}))

// Importar proxy DESPUÉS de los mocks
const { proxy } = require("../proxy")

function makeRequest(pathname: string, ip = "1.2.3.4") {
  return new NextRequest(`http://localhost:3000${pathname}`, {
    headers: { "x-forwarded-for": ip },
  })
}

describe("rate limiting in proxy middleware", () => {
  beforeEach(() => jest.clearAllMocks())

  it("pasa rutas estáticas sin verificar rate limit", async () => {
    const req = makeRequest("/_next/static/chunk.js")
    await proxy(req)
    expect(mockLimit).not.toHaveBeenCalled()
  })

  it("devuelve 429 cuando rate limit excedido en /dashboard", async () => {
    mockLimit.mockResolvedValue({ success: false, limit: 20, remaining: 0 })
    const req = makeRequest("/dashboard/diario")
    const res = await proxy(req)
    expect(res?.status).toBe(429)
    expect(res?.headers.get("Retry-After")).toBe("10")
  })

  it("pasa cuando rate limit no excedido en /api/", async () => {
    mockLimit.mockResolvedValue({ success: true, limit: 20, remaining: 19 })
    const req = makeRequest("/api/v1/health")
    const res = await proxy(req)
    expect(res?.status).not.toBe(429)
  })
})
```

- [ ] **Step 3: Correr el test (debe fallar — proxy.ts no tiene ratelimit aún)**

```bash
cd monitor-app/frontend
npx jest __tests__/ratelimit.test.ts --no-coverage 2>&1 | tail -20
```

Esperado: `FAIL` — error sobre mock o sobre que `proxy` no limita.

- [ ] **Step 4: Actualizar proxy.ts con rate limiting**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

// Inicializar fuera del handler para reutilizar entre invocaciones
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(20, '10 s'),
  analytics: false,
})

const RATE_LIMITED_PREFIXES = ['/api/', '/dashboard']

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Rate limiting: solo rutas API y dashboard (no assets estáticos, no login)
  const shouldLimit = RATE_LIMITED_PREFIXES.some(p => pathname.startsWith(p))
  if (shouldLimit) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1'
    const { success } = await ratelimit.limit(ip)
    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '10' },
      })
    }
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  const isPublic =
    pathname.startsWith('/login') ||
    pathname.startsWith('/forgot-password') ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/api/')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard/diario'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
```

- [ ] **Step 5: Correr el test de nuevo (debe pasar)**

```bash
cd monitor-app/frontend
npx jest __tests__/ratelimit.test.ts --no-coverage
```

Esperado: `PASS` con 3 tests verdes.

- [ ] **Step 6: Verificar TypeScript**

```bash
cd monitor-app/frontend
npx tsc --noEmit
```

Esperado: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add monitor-app/frontend/package.json \
        monitor-app/frontend/package-lock.json \
        monitor-app/frontend/proxy.ts \
        monitor-app/frontend/__tests__/ratelimit.test.ts
git commit -m "feat(frontend): rate limiting via Upstash en middleware"
```

---

## Task 4: Monitor-API Redis Cache

**Files:**
- Modify: `monitor-app/backend/api/pyproject.toml`
- Modify: `monitor-app/backend/api/app/config.py`
- Create: `monitor-app/backend/api/app/cache.py`
- Modify: `monitor-app/backend/api/app/auth.py`
- Create: `monitor-app/backend/api/app/middleware/__init__.py`
- Create: `monitor-app/backend/api/app/middleware/cache.py`
- Modify: `monitor-app/backend/api/app/main.py`

**Interfaces:**
- Consumes: env vars `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` (opcionales — si están vacíos, cache deshabilitado)
- Produces:
  - `get_redis() -> Redis | None` (de `app.cache`)
  - `cache_get(key: str) -> str | None` async
  - `cache_set(key: str, value: str, ex: int) -> None` async
  - Header `X-Cache: HIT | MISS` en responses GET cacheadas
  - JWT cache: 60s por token (hash SHA256[:16])

- [ ] **Step 1: Agregar upstash-redis a pyproject.toml**

En `monitor-app/backend/api/pyproject.toml`, en la sección `dependencies`:

```toml
[project]
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.30",
    "asyncpg>=0.30",
    "pydantic>=2.7",
    "pydantic-settings>=2.3",
    "supabase==2.10.0",
    "upstash-redis>=1.1.0",
]
```

Instalar:
```bash
cd monitor-app/backend/api
pip install upstash-redis>=1.1.0
```

- [ ] **Step 2: Escribir tests para cache.py (RED)**

Crear `monitor-app/backend/api/tests/__init__.py` (vacío) y `monitor-app/backend/api/tests/test_cache.py`:

```python
import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.fixture
def mock_settings_with_redis():
    settings = MagicMock()
    settings.upstash_redis_rest_url = "https://included-serval-41602.upstash.io"
    settings.upstash_redis_rest_token = "token123"
    return settings


@pytest.fixture
def mock_settings_without_redis():
    settings = MagicMock()
    settings.upstash_redis_rest_url = ""
    settings.upstash_redis_rest_token = ""
    return settings


def test_get_redis_returns_none_when_no_url(mock_settings_without_redis):
    with patch("app.cache.get_settings", return_value=mock_settings_without_redis):
        from app.cache import get_redis
        assert get_redis() is None


def test_get_redis_returns_client_when_url_set(mock_settings_with_redis):
    with patch("app.cache.get_settings", return_value=mock_settings_with_redis):
        with patch("app.cache.Redis") as mock_redis_cls:
            mock_redis_cls.return_value = MagicMock()
            from app.cache import get_redis
            result = get_redis()
            assert result is not None
            mock_redis_cls.assert_called_once_with(
                url="https://included-serval-41602.upstash.io",
                token="token123",
            )


@pytest.mark.asyncio
async def test_cache_get_returns_none_when_no_redis():
    with patch("app.cache.get_redis", return_value=None):
        from app.cache import cache_get
        result = await cache_get("some-key")
        assert result is None


@pytest.mark.asyncio
async def test_cache_set_is_noop_when_no_redis():
    with patch("app.cache.get_redis", return_value=None):
        from app.cache import cache_set
        await cache_set("key", "value", ex=30)  # no debe lanzar excepción


@pytest.mark.asyncio
async def test_cache_get_returns_value_when_hit():
    mock_redis = AsyncMock()
    mock_redis.get = AsyncMock(return_value='"cached_data"')
    with patch("app.cache.get_redis", return_value=mock_redis):
        from app.cache import cache_get
        result = await cache_get("api:/trips:")
        assert result == '"cached_data"'


@pytest.mark.asyncio
async def test_cache_set_calls_redis_set():
    mock_redis = AsyncMock()
    mock_redis.set = AsyncMock(return_value=True)
    with patch("app.cache.get_redis", return_value=mock_redis):
        from app.cache import cache_set
        await cache_set("key", "value", ex=30)
        mock_redis.set.assert_called_once_with("key", "value", ex=30)
```

Correr:
```bash
cd monitor-app/backend/api
python -m pytest tests/test_cache.py -v 2>&1 | tail -20
```

Esperado: varios `FAILED` / `ImportError` (módulo no existe aún).

- [ ] **Step 3: Actualizar config.py con vars Upstash**

```python
from functools import lru_cache
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    supabase_url: str
    supabase_service_role_key: str
    allowed_origins: list[str] = ["http://localhost:3000"]
    upstash_redis_rest_url: str = ""
    upstash_redis_rest_token: str = ""

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Crear app/cache.py**

```python
from upstash_redis.asyncio import Redis
from .config import get_settings


def get_redis() -> Redis | None:
    settings = get_settings()
    if not settings.upstash_redis_rest_url:
        return None
    return Redis(
        url=settings.upstash_redis_rest_url,
        token=settings.upstash_redis_rest_token,
    )


async def cache_get(key: str) -> str | None:
    redis = get_redis()
    if redis is None:
        return None
    return await redis.get(key)


async def cache_set(key: str, value: str, ex: int) -> None:
    redis = get_redis()
    if redis is None:
        return
    await redis.set(key, value, ex=ex)
```

- [ ] **Step 5: Correr tests de cache (GREEN)**

```bash
cd monitor-app/backend/api
python -m pytest tests/test_cache.py -v
```

Esperado: todos PASS.

- [ ] **Step 6: Escribir test de JWT cache en auth.py (RED)**

Crear `monitor-app/backend/api/tests/test_auth_cache.py`:

```python
import pytest
import json
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_get_current_user_uses_cache_on_hit():
    """Si Redis tiene el JWT cacheado, no llama a supabase.auth.get_user()."""
    cached_user = {"sub": "user-123", "email": "test@test.com", "role": "editor"}

    mock_cred = MagicMock()
    mock_cred.credentials = "valid-token"

    with patch("app.auth.cache_get", AsyncMock(return_value=json.dumps(cached_user))):
        with patch("app.auth.get_supabase") as mock_get_supabase:
            from app.auth import get_current_user
            result = await get_current_user(mock_cred, supabase=MagicMock(), pool=MagicMock())
            assert result == cached_user
            mock_get_supabase.assert_not_called()


@pytest.mark.asyncio
async def test_get_current_user_caches_on_miss():
    """Si Redis no tiene el token, valida con Supabase y cachea el resultado."""
    mock_user = MagicMock()
    mock_user.id = "user-456"
    mock_user.email = "user@test.com"

    mock_supabase = MagicMock()
    mock_supabase.auth.get_user.return_value = MagicMock(user=mock_user)

    mock_pool = AsyncMock()
    mock_pool.fetchrow = AsyncMock(return_value={"role": "admin"})

    mock_cred = MagicMock()
    mock_cred.credentials = "miss-token"

    with patch("app.auth.cache_get", AsyncMock(return_value=None)):
        with patch("app.auth.cache_set", AsyncMock()) as mock_cache_set:
            from app.auth import get_current_user
            result = await get_current_user(mock_cred, supabase=mock_supabase, pool=mock_pool)
            assert result["role"] == "admin"
            assert result["email"] == "user@test.com"
            mock_cache_set.assert_called_once()
            call_args = mock_cache_set.call_args
            assert call_args.kwargs.get("ex") == 60 or call_args.args[2] == 60
```

Correr (debe fallar — auth.py no tiene cache aún):
```bash
python -m pytest tests/test_auth_cache.py -v 2>&1 | tail -15
```

- [ ] **Step 7: Actualizar auth.py con JWT cache**

```python
import hashlib
import json

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase import Client, create_client

from .cache import cache_get, cache_set
from .config import Settings, get_settings
from .db import get_pool

bearer = HTTPBearer()

EDITOR_ROLES = {"editor", "admin", "owner"}
ADMIN_ROLES = {"admin", "owner"}


def get_supabase(settings: Settings = Depends(get_settings)) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


async def get_current_user(
    cred: HTTPAuthorizationCredentials = Depends(bearer),
    supabase: Client = Depends(get_supabase),
    pool=Depends(get_pool),
) -> dict:
    token = cred.credentials
    token_key = f"jwt:{hashlib.sha256(token.encode()).hexdigest()[:16]}"

    cached = await cache_get(token_key)
    if cached:
        return json.loads(cached)

    try:
        response = supabase.auth.get_user(token)
        user = response.user
    except Exception:
        raise HTTPException(status_code=401, detail="Token inválido o expirado")

    if user is None:
        raise HTTPException(status_code=401, detail="No autenticado")

    row = await pool.fetchrow(
        "SELECT role FROM public.profiles WHERE id = $1", str(user.id)
    )
    role = row["role"] if row else "viewer"
    result = {"sub": str(user.id), "email": user.email, "role": role}

    await cache_set(token_key, json.dumps(result), ex=60)
    return result


async def require_editor(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in EDITOR_ROLES:
        raise HTTPException(status_code=403, detail="Se requiere rol editor o superior")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user["role"] not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="Se requiere rol admin o superior")
    return user
```

- [ ] **Step 8: Correr test de JWT cache (GREEN)**

```bash
cd monitor-app/backend/api
python -m pytest tests/test_auth_cache.py -v
```

Esperado: 2 tests PASS.

- [ ] **Step 9: Crear middleware/__init__.py y middleware/cache.py**

`monitor-app/backend/api/app/middleware/__init__.py` — vacío:
```python
```

`monitor-app/backend/api/app/middleware/cache.py`:

```python
import hashlib

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse

from ..cache import cache_get, cache_set

# Rutas con TTL largo (datos de configuración, cambian raramente)
_STATIC_ROUTES: dict[str, int] = {
    "/api/v1/roles": 300,
    "/api/v1/trips/meta": 300,
}

# Prefijos con TTL corto (datos operativos, cambian cada ~15 min)
_DYNAMIC_PREFIXES: list[tuple[str, int]] = [
    ("/api/v1/trips", 30),
    ("/api/v1/transporters", 30),
]


def _get_ttl(path: str) -> int | None:
    if path in _STATIC_ROUTES:
        return _STATIC_ROUTES[path]
    for prefix, ttl in _DYNAMIC_PREFIXES:
        if path.startswith(prefix):
            return ttl
    return None


class CacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method != "GET":
            return await call_next(request)

        path = request.url.path
        ttl = _get_ttl(path)
        if ttl is None:
            return await call_next(request)

        query = str(request.url.query)
        key = f"api:{path}:{hashlib.md5(query.encode()).hexdigest()[:8]}"

        cached = await cache_get(key)
        if cached:
            return StarletteResponse(
                content=cached,
                media_type="application/json",
                headers={"X-Cache": "HIT"},
            )

        response = await call_next(request)

        if response.status_code == 200:
            body = b""
            async for chunk in response.body_iterator:
                body += chunk
            await cache_set(key, body.decode(), ex=ttl)
            content_type = response.headers.get("content-type", "application/json")
            return StarletteResponse(
                content=body,
                media_type=content_type,
                headers={"X-Cache": "MISS"},
            )

        return response
```

- [ ] **Step 10: Escribir test para CacheMiddleware (RED)**

Crear `monitor-app/backend/api/tests/test_middleware_cache.py`:

```python
import pytest
import json
from unittest.mock import AsyncMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient


def make_app():
    from app.middleware.cache import CacheMiddleware
    app = FastAPI()
    app.add_middleware(CacheMiddleware)

    call_count = {"n": 0}

    @app.get("/api/v1/trips")
    def list_trips():
        call_count["n"] += 1
        return {"trips": [], "call": call_count["n"]}

    @app.get("/api/v1/roles")
    def list_roles():
        call_count["n"] += 1
        return {"roles": []}

    @app.post("/api/v1/trips")
    def create_trip():
        return {"id": "new"}

    return app, call_count


def test_cache_miss_returns_x_cache_miss():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=None)):
        with patch("app.middleware.cache.cache_set", AsyncMock()):
            client = TestClient(app)
            res = client.get("/api/v1/trips")
            assert res.status_code == 200
            assert res.headers.get("x-cache") == "MISS"


def test_cache_hit_returns_cached_body():
    app, _ = make_app()
    cached = json.dumps({"trips": [{"id": "cached"}], "call": 1})
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=cached)):
        client = TestClient(app)
        res = client.get("/api/v1/trips")
        assert res.status_code == 200
        assert res.headers.get("x-cache") == "HIT"
        assert res.json()["trips"][0]["id"] == "cached"


def test_post_not_cached():
    app, _ = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock()) as mock_get:
        client = TestClient(app)
        res = client.post("/api/v1/trips")
        assert res.status_code == 200
        mock_get.assert_not_called()


def test_uncached_route_passes_through():
    app, call_count = make_app()
    with patch("app.middleware.cache.cache_get", AsyncMock(return_value=None)):
        with patch("app.middleware.cache.cache_set", AsyncMock()):
            client = TestClient(app)
            res = client.get("/health")
            assert res.status_code == 404  # /health no está en este test app — pasó sin cache
```

Correr (debe fallar):
```bash
python -m pytest tests/test_middleware_cache.py -v 2>&1 | tail -15
```

- [ ] **Step 11: Registrar CacheMiddleware en main.py**

El orden en Starlette es: último en agregarse = más externo. CacheMiddleware se agrega PRIMERO (será interno a CORS):

```python
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import close_pool, init_pool
from .middleware.cache import CacheMiddleware
from .routers.config import router as config_router
from .routers.filter_groups import router as filter_groups_router
from .routers.roles import router as roles_router
from .routers.transporters import router as transporters_router
from .routers.trips import router as trips_router
from .routers.users import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    pool = await init_pool(settings.database_url)
    app.state.pool = pool
    yield
    await close_pool()


app = FastAPI(
    title="Webcarga Monitor API",
    version="1.0.0",
    description="API operacional de master data — transportistas",
    lifespan=lifespan,
    redirect_slashes=False,
)

settings = get_settings()

# Orden de middlewares (Starlette: último agregado = más externo para requests)
# CacheMiddleware primero → queda interno a CORS (CORS agrega headers incluso en hits)
app.add_middleware(CacheMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(roles_router,         prefix="/api/v1")
app.include_router(config_router,        prefix="/api/v1")
app.include_router(transporters_router,  prefix="/api/v1")
app.include_router(trips_router,         prefix="/api/v1")
app.include_router(users_router,         prefix="/api/v1")
app.include_router(filter_groups_router, prefix="/api/v1")


@app.get("/health", tags=["health"])
def health():
    return {"status": "ok", "service": "webcarga-monitor-api"}
```

- [ ] **Step 12: Correr todos los tests del monitor-api (GREEN)**

```bash
cd monitor-app/backend/api
python -m pytest tests/ -v
```

Esperado: todos PASS.

- [ ] **Step 13: Verificar import limpio**

```bash
cd monitor-app/backend/api
python -c "from app.main import app; print('OK —', len(app.routes), 'routes')"
```

Esperado: `OK — N routes` (sin ImportError).

- [ ] **Step 14: Commit**

```bash
git add monitor-app/backend/api/pyproject.toml \
        monitor-app/backend/api/app/config.py \
        monitor-app/backend/api/app/cache.py \
        monitor-app/backend/api/app/auth.py \
        monitor-app/backend/api/app/middleware/ \
        monitor-app/backend/api/app/main.py \
        monitor-app/backend/api/tests/
git commit -m "feat(monitor-api): Upstash Redis — JWT cache + API response cache + rate limit en frontend"
```

---

## Task 5: Bronze Tables DROP Migration

**Files:**
- Create: `monitor-app/backend/supabase/migrations/20260618000006_drop_deprecated_bronze_tables.sql`

**Interfaces:**
- Consumes: Supabase MCP (`mcp__claude_ai_Supabase__apply_migration` o `mcp__claude_ai_Supabase__execute_sql`)
- Produces: `bronze.raw_tms_trips` y `bronze.raw_tms_trips_snapshot` eliminadas permanentemente

- [ ] **Step 1: Crear archivo de migración**

```sql
-- ==============================================================================
-- MIGRACIÓN: DROP tablas bronze deprecadas
-- Reemplazadas por: bronze.tms_trips (UPSERT) + bronze.tms_trips_snapshot (dbt SCD2)
-- Migración 20260618000005 backfilleó todos los datos. Pipeline ya usa tms_trips.
-- No hay referencias en frontend ni en monitor-api.
-- ==============================================================================

-- 1. RLS policy sobre raw_tms_trips (creada en 20260618000001_security_critical)
DROP POLICY IF EXISTS "bronze_trips_read" ON bronze.raw_tms_trips;

-- 2. Tabla SCD2 antigua (generada por dbt snapshot sobre raw_tms_trips)
--    Los índices sobre esta tabla (en 20260618000002) caen con CASCADE.
DROP TABLE IF EXISTS bronze.raw_tms_trips_snapshot CASCADE;

-- 3. Tabla append-only original (todos los datos migrados a bronze.tms_trips)
--    Los índices (idx_bronze_pending, idx_bronze_mage_run, etc.) caen con CASCADE.
DROP TABLE IF EXISTS bronze.raw_tms_trips CASCADE;
```

- [ ] **Step 2: Verificar que bronze.tms_trips tiene datos antes de hacer el DROP**

Ejecutar en Supabase (vía MCP `execute_sql` o SQL Editor del dashboard):

```sql
SELECT count(*) AS total_active_trips FROM bronze.tms_trips;
SELECT count(*) AS snapshot_rows FROM bronze.tms_trips_snapshot;
```

Esperado: `total_active_trips` > 0 (datos migrados), `snapshot_rows` >= 0.

- [ ] **Step 3: Aplicar la migración**

Usar el MCP de Supabase:
```
mcp__claude_ai_Supabase__apply_migration con el contenido del archivo
```

O via CLI:
```bash
supabase db push --db-url "postgresql://postgres:[PASSWORD]@db.viclzoftiudkepqnhekv.supabase.co:5432/postgres"
```

- [ ] **Step 4: Verificar que las tablas ya no existen**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'bronze'
ORDER BY table_name;
```

Esperado: solo `tms_trips` y `tms_trips_snapshot` — sin `raw_tms_trips` ni `raw_tms_trips_snapshot`.

- [ ] **Step 5: Commit**

```bash
git add monitor-app/backend/supabase/migrations/20260618000006_drop_deprecated_bronze_tables.sql
git commit -m "feat(db): drop bronze.raw_tms_trips + raw_tms_trips_snapshot (migradas a tms_trips)"
```

---

## Task 6: README.md Profesional

**Files:**
- Create: `README.md` (raíz del monorepo)

**Interfaces:**
- Produce: documentación completa legible en GitHub con badges, arquitectura, y guía de desarrollo

- [ ] **Step 1: Crear README.md**

```markdown
# Webcarga — Transport Operations Platform

[![Deploy Extraction Service](https://github.com/OWNER/webcarga/actions/workflows/deploy.yml/badge.svg)](https://github.com/OWNER/webcarga/actions/workflows/deploy.yml)
[![Deploy Monitor API](https://github.com/OWNER/webcarga/actions/workflows/deploy-monitor-api.yml/badge.svg)](https://github.com/OWNER/webcarga/actions/workflows/deploy-monitor-api.yml)
[![Deploy Frontend](https://github.com/OWNER/webcarga/actions/workflows/deploy-frontend.yml/badge.svg)](https://github.com/OWNER/webcarga/actions/workflows/deploy-frontend.yml)

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
```

- [ ] **Step 2: Reemplazar `OWNER/webcarga` con el repo real en los badges**

```bash
git remote get-url origin
```

Usar el output para completar las URLs de badges (formato: `github.com/OWNER/REPO`).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add professional monorepo README with architecture, CI/CD, and local dev guide"
```

---

## Self-Review

**Spec coverage:**
- ✅ CI/CD branch-aware dev/prod → Task 2
- ✅ Frontend migrado de Vercel a Cloud Run → Task 1 + Task 2
- ✅ Dockerfile Next.js standalone → Task 1
- ✅ Rate limiting en frontend (Upstash) → Task 3
- ✅ API response cache en monitor-api → Task 4
- ✅ JWT cache en monitor-api → Task 4
- ✅ upstash-redis en pyproject.toml → Task 4 Step 1
- ✅ GCP Secret Manager commands para nuevos secrets → Task 2 Step 3
- ✅ bronze.raw_tms_trips DROP → Task 5
- ✅ bronze.raw_tms_trips_snapshot DROP → Task 5
- ✅ README.md → Task 6

**Tipo consistency:** `cache_get`/`cache_set` definidos en Task 4 Step 4, usados en Steps 7 y 9. Firmas consistentes: `async def cache_get(key: str) -> str | None` y `async def cache_set(key: str, value: str, ex: int) -> None`.

**Placeholders:** Ninguno. Código completo en cada step. Los únicos valores variables son los GCP resource names que el usuario necesita ajustar una sola vez (paso documentado en Task 2 Step 3).
