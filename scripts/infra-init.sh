#!/usr/bin/env bash
# =============================================================================
# infra-init.sh — Webcarga infrastructure bootstrap
#
# Idempotente: crea GCP Secret Manager secrets + configura GitHub Secrets.
# Corre ANTES del primer `git push origin dev`.
#
# Prerequisitos:
#   - gcloud auth login && gcloud config set project <PROJECT_ID>
#   - gh auth login  (GitHub CLI)
#   - jq instalado
#
# Uso:
#   ./scripts/infra-init.sh
#   ./scripts/infra-init.sh --post-deploy   # después del primer deploy
# =============================================================================
set -euo pipefail

# ── Colores ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; NC='\033[0m'
ok()   { echo -e "${GREEN}  ✓ $*${NC}"; }
warn() { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail() { echo -e "${RED}  ✗ $*${NC}"; exit 1; }
hdr()  { echo -e "\n${BLUE}▶ $*${NC}"; }

# ── Configuración del proyecto ────────────────────────────────────────────────
GITHUB_ORG="fsotosa-ops"
GITHUB_REPO="webcarga"
REGION="us-central1"

# Detectar PROJECT_ID desde gcloud
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
[[ -z "$PROJECT_ID" ]] && fail "Ningún proyecto GCP activo. Ejecuta: gcloud config set project <PROJECT_ID>"
echo -e "${GREEN}Proyecto GCP: $PROJECT_ID${NC}"

# Detectar si estamos en modo post-deploy
POST_DEPLOY=false
[[ "${1:-}" == "--post-deploy" ]] && POST_DEPLOY=true

# ── Helpers ──────────────────────────────────────────────────────────────────

# Crea un GCP secret si no existe; si existe, agrega una nueva versión solo si
# el valor cambió. Idempotente.
gcp_secret_upsert() {
    local name="$1" value="$2"
    if ! gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
        printf '%s' "$value" | gcloud secrets create "$name" \
            --data-file=- --project="$PROJECT_ID" --replication-policy="automatic" --quiet
        ok "GCP secret creado: $name"
    else
        # Comparar con versión actual para evitar versiones innecesarias
        current=$(gcloud secrets versions access latest --secret="$name" --project="$PROJECT_ID" 2>/dev/null || echo "")
        if [[ "$current" != "$value" ]]; then
            printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT_ID" --quiet
            ok "GCP secret actualizado: $name"
        else
            ok "GCP secret sin cambios: $name (ya al día)"
        fi
    fi
}

# Establece un GitHub secret via gh CLI
# IMPORTANTE: usar --body "$value" NO --body - (stdin piping no funciona con gh secret set)
gh_secret_set() {
    local name="$1" value="$2"
    gh secret set "$name" --repo="${GITHUB_ORG}/${GITHUB_REPO}" --body "$value"
    ok "GitHub secret: $name"
}

# ── Verificar herramientas ────────────────────────────────────────────────────
hdr "Verificando herramientas"
command -v gcloud &>/dev/null || fail "gcloud no instalado"
command -v gh     &>/dev/null || fail "gh (GitHub CLI) no instalado — brew install gh"
command -v jq     &>/dev/null || fail "jq no instalado — brew install jq"
ok "gcloud, gh, jq disponibles"

# Verificar autenticación GitHub
gh auth status &>/dev/null || fail "No autenticado en gh. Ejecuta: gh auth login"
ok "GitHub CLI autenticado"

# ── Leer .env.local para valores de Supabase ─────────────────────────────────
ENV_FILE="$(dirname "$0")/../monitor-app/frontend/.env.local"
if [[ ! -f "$ENV_FILE" ]]; then
    fail ".env.local no encontrado en monitor-app/frontend/ — copia desde .env.local.example"
fi

load_env_var() {
    local key="$1"
    grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'"
}

SUPABASE_URL=$(load_env_var "NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_ANON_KEY=$(load_env_var "NEXT_PUBLIC_SUPABASE_ANON_KEY")
UPSTASH_URL=$(load_env_var "UPSTASH_REDIS_REST_URL")
UPSTASH_TOKEN=$(load_env_var "UPSTASH_REDIS_REST_TOKEN")

[[ -z "$SUPABASE_URL" ]]    && fail "NEXT_PUBLIC_SUPABASE_URL vacío en .env.local"
[[ -z "$SUPABASE_ANON_KEY" ]] && fail "NEXT_PUBLIC_SUPABASE_ANON_KEY vacío en .env.local"
[[ -z "$UPSTASH_URL" ]]     && fail "UPSTASH_REDIS_REST_URL vacío en .env.local"
[[ -z "$UPSTASH_TOKEN" ]]   && fail "UPSTASH_REDIS_REST_TOKEN vacío en .env.local"
ok "Valores leídos desde .env.local"

# =============================================================================
# MODO POST-DEPLOY: actualizar FASTAPI_URL secrets con URLs reales de Cloud Run
# =============================================================================
if [[ "$POST_DEPLOY" == "true" ]]; then
    hdr "Modo post-deploy: actualizando FASTAPI_URL secrets"

    for env in dev prod; do
        service="webcarga-monitor-api-${env}"
        url=$(gcloud run services describe "$service" --region="$REGION" \
            --project="$PROJECT_ID" --format="value(status.url)" 2>/dev/null || echo "")
        if [[ -z "$url" ]]; then
            warn "Servicio $service no encontrado — skipping"
        else
            gcp_secret_upsert "frontend-fastapi-url-${env}" "$url"
        fi
    done

    echo ""
    echo -e "${GREEN}✅ Post-deploy completado. Los siguientes deploys del frontend usarán las URLs reales.${NC}"
    echo ""
    echo -e "${YELLOW}Paso manual restante:${NC}"
    echo "  → Supabase Dashboard → Authentication → URL Configuration → Redirect URLs"
    echo "  → Agregar las URLs de Cloud Run del frontend (webcarga-frontend-dev y webcarga-frontend-prod)"
    exit 0
fi

# =============================================================================
# FASE 1 — GCP Secret Manager (nuevos secrets para esta sesión)
# =============================================================================
hdr "GCP Secret Manager — secrets de Upstash"

gcp_secret_upsert "monitor-api-upstash-url"   "$UPSTASH_URL"
gcp_secret_upsert "monitor-api-upstash-token" "$UPSTASH_TOKEN"
gcp_secret_upsert "frontend-upstash-url"      "$UPSTASH_URL"
gcp_secret_upsert "frontend-upstash-token"    "$UPSTASH_TOKEN"

hdr "GCP Secret Manager — FASTAPI_URL placeholders"
# Placeholders temporales — actualizar con ./infra-init.sh --post-deploy
for env in dev prod; do
    secret_name="frontend-fastapi-url-${env}"
    if ! gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
        gcp_secret_upsert "$secret_name" "https://PLACEHOLDER-monitor-api-${env}.run.app"
        warn "frontend-fastapi-url-${env}: placeholder creado — ejecuta --post-deploy después del primer deploy"
    else
        ok "GCP secret ya existe: $secret_name (no sobreescrito)"
    fi
done

# =============================================================================
# FASE 2 — GitHub Secrets
# =============================================================================
hdr "GitHub Secrets — Supabase (build-time)"

gh_secret_set "NEXT_PUBLIC_SUPABASE_URL"     "$SUPABASE_URL"
gh_secret_set "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$SUPABASE_ANON_KEY"

hdr "GitHub Secrets — GCP (leer de configuración existente)"

# GCP_PROJECT_ID
gh_secret_set "GCP_PROJECT_ID" "$PROJECT_ID"

# WIF_PROVIDER — leer de pool existente
POOL_NAME="github-actions-pool"
PROVIDER_NAME="github-provider"
WIF_PROVIDER=""
if gcloud iam workload-identity-pools describe "$POOL_NAME" --location="global" --project="$PROJECT_ID" &>/dev/null; then
    WIF_PROVIDER=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
        --workload-identity-pool="$POOL_NAME" --location="global" \
        --project="$PROJECT_ID" --format="value(name)" 2>/dev/null || echo "")
fi

if [[ -n "$WIF_PROVIDER" ]]; then
    gh_secret_set "WIF_PROVIDER" "$WIF_PROVIDER"
else
    warn "WIF_PROVIDER no encontrado automáticamente — agrega manualmente en GitHub Secrets"
    warn "  Valor: projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/${POOL_NAME}/providers/${PROVIDER_NAME}"
fi

# WIF_SA_EMAIL — SA del deployer
DEPLOYER_SA="github-actions-sa@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$DEPLOYER_SA" --project="$PROJECT_ID" &>/dev/null; then
    gh_secret_set "WIF_SA_EMAIL" "$DEPLOYER_SA"
else
    warn "WIF_SA_EMAIL no encontrado automáticamente — agrega manualmente: <deployer-sa>@${PROJECT_ID}.iam.gserviceaccount.com"
fi

hdr "GitHub Secrets — Service Accounts de Cloud Run"

# Runtime SA — se reutiliza entre servicios
gh_secret_set "CLOUD_RUN_SA_EMAIL"       "webcarga-extraction-sa@${PROJECT_ID}.iam.gserviceaccount.com"
gh_secret_set "MONITOR_API_CLOUD_RUN_SA" "webcarga-monitor-api-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Frontend SA — crear si no existe
FRONTEND_SA="webcarga-frontend-sa@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$FRONTEND_SA" --project="$PROJECT_ID" &>/dev/null; then
    gcloud iam service-accounts create "webcarga-frontend-sa" \
        --display-name="Webcarga Frontend Cloud Run SA" --project="$PROJECT_ID" --quiet
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${FRONTEND_SA}" --role="roles/secretmanager.secretAccessor" \
        --condition=None --quiet >/dev/null
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:${FRONTEND_SA}" --role="roles/logging.logWriter" \
        --condition=None --quiet >/dev/null
    gcloud iam service-accounts add-iam-policy-binding "$FRONTEND_SA" \
        --member="serviceAccount:${DEPLOYER_SA}" --role="roles/iam.serviceAccountUser" \
        --project="$PROJECT_ID" --quiet >/dev/null
    ok "Frontend SA creado: $FRONTEND_SA"
else
    ok "Frontend SA ya existe: $FRONTEND_SA"
fi
gh_secret_set "FRONTEND_CLOUD_RUN_SA" "$FRONTEND_SA"

# =============================================================================
# RESUMEN FINAL
# =============================================================================
echo ""
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✅  Infraestructura lista para el primer deploy${NC}"
echo -e "${GREEN}══════════════════════════════════════════════════════${NC}"
echo ""
echo "GCP Secret Manager:"
echo "  ✓ monitor-api-upstash-url / monitor-api-upstash-token"
echo "  ✓ frontend-upstash-url / frontend-upstash-token"
echo "  ✓ frontend-fastapi-url-dev / frontend-fastapi-url-prod (placeholders)"
echo ""
echo "GitHub Secrets:"
echo "  ✓ NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY"
echo "  ✓ GCP_PROJECT_ID / WIF_PROVIDER / WIF_SA_EMAIL"
echo "  ✓ CLOUD_RUN_SA_EMAIL / MONITOR_API_CLOUD_RUN_SA / FRONTEND_CLOUD_RUN_SA"
echo ""
echo -e "${YELLOW}Pasos siguientes:${NC}"
echo "  1. git checkout -b dev && git push origin dev"
echo "     → CI/CD desplegará los 3 servicios *-dev en Cloud Run"
echo ""
echo "  2. Cuando los deploys terminen:"
echo "     ./scripts/infra-init.sh --post-deploy"
echo "     → Actualiza frontend-fastapi-url-{dev,prod} con URLs reales"
echo ""
echo "  3. Supabase Auth → Redirect URLs → agregar URLs de frontend-dev y frontend-prod"
echo ""
