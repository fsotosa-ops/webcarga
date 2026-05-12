#!/usr/bin/env bash
# =============================================================================
# init-gcp-monitor-api.sh — Setup GCP para webcarga monitor API
#
# Reutiliza el Artifact Registry repo, WIF pool/provider y SA de deploy
# que ya creó init-gcp.sh para extraction_service.
# Solo crea: nuevo Cloud Run SA (runtime) + secrets propios del monitor API.
#
# Uso:
#   1. Revisar variables abajo (proyecto y repo GitHub ya están pre-cargados)
#   2. gcloud auth login
#   3. bash init-gcp-monitor-api.sh
#   4. Copiar los GitHub Secrets que se imprimen al final
# =============================================================================
set -euo pipefail

# ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────
PROJECT_ID="webcarga-dev-493220"
REGION="us-central1"
SERVICE_NAME="webcarga-monitor-api"
AR_REPO="webcarga"
IMAGE_NAME="monitor-api"

# SA para el runtime de Cloud Run (nuevo, separado del de extraction)
CLOUD_RUN_SA_NAME="webcarga-monitor-api-sa"

# SA y WIF que ya existen (creados por init-gcp.sh de extraction_service)
WIF_SA_NAME="github-actions-sa"
WIF_POOL="github-actions-pool"
WIF_PROVIDER_ID="github-provider"
GITHUB_ORG_OR_USER="fsotosa-ops"
GITHUB_REPO="webcarga"

# Secretos del monitor API — completar antes de ejecutar, NO commitear con valores reales
DATABASE_URL_VALUE="postgresql://postgres:CAMBIAR_DB_PASSWORD@db.CAMBIAR_PROJECT_REF.supabase.co:5432/postgres"
SUPABASE_URL_VALUE="https://CAMBIAR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_ROLE_KEY_VALUE="CAMBIAR_SERVICE_ROLE_KEY"
ALLOWED_ORIGINS_VALUE='["https://frontend-two-alpha-39.vercel.app"]'
# ─────────────────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════════════════════════════"
echo "  webcarga Monitor API — GCP Setup"
echo "  Proyecto: ${PROJECT_ID}"
echo "══════════════════════════════════════════════════════════════"

# ─── 1. Proyecto ─────────────────────────────────────────────────────────────
echo ""
echo "▸ [1/5] Seteando proyecto..."
gcloud config set project "${PROJECT_ID}"

# ─── 2. APIs (ya deberían estar habilitadas, idempotente) ────────────────────
echo ""
echo "▸ [2/5] Verificando APIs..."
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iamcredentials.googleapis.com \
    iam.googleapis.com \
    cloudresourcemanager.googleapis.com
echo "  ✓ APIs activas."

# ─── 3. Secrets en Secret Manager ────────────────────────────────────────────
echo ""
echo "▸ [3/5] Creando secrets del monitor API..."

create_secret() {
    local name=$1
    local value=$2
    if gcloud secrets describe "${name}" &>/dev/null; then
        echo "  ✓ '${name}' ya existe (no se sobreescribe)."
    else
        echo -n "${value}" | gcloud secrets create "${name}" --data-file=-
        echo "  ✓ '${name}' creado."
    fi
}

create_secret "monitor-api-database-url"            "${DATABASE_URL_VALUE}"
create_secret "monitor-api-supabase-url"            "${SUPABASE_URL_VALUE}"
create_secret "monitor-api-supabase-service-role-key" "${SUPABASE_SERVICE_ROLE_KEY_VALUE}"
create_secret "monitor-api-allowed-origins"         "${ALLOWED_ORIGINS_VALUE}"

# ─── 4. Cloud Run SA (runtime) ───────────────────────────────────────────────
echo ""
echo "▸ [4/5] Creando Service Account de runtime..."

CLOUD_RUN_SA_EMAIL="${CLOUD_RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_SA_EMAIL="${WIF_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

if gcloud iam service-accounts describe "${CLOUD_RUN_SA_EMAIL}" &>/dev/null; then
    echo "  ✓ SA '${CLOUD_RUN_SA_NAME}' ya existe."
else
    gcloud iam service-accounts create "${CLOUD_RUN_SA_NAME}" \
        --display-name="webcarga Monitor API Cloud Run SA"
    echo "  ✓ SA creado. Esperando propagación..."
    sleep 10
fi

# Permitir que el SA acceda a los secrets del monitor API
echo "  Asignando rol secretAccessor al SA de runtime..."
for secret in \
    monitor-api-database-url \
    monitor-api-supabase-url \
    monitor-api-supabase-service-role-key \
    monitor-api-allowed-origins; do
    gcloud secrets add-iam-policy-binding "${secret}" \
        --member="serviceAccount:${CLOUD_RUN_SA_EMAIL}" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet
done

# El SA de deploy (WIF) también necesita poder leer los secrets al deployar
echo "  Asignando rol secretAccessor al SA de deploy (WIF)..."
for secret in \
    monitor-api-database-url \
    monitor-api-supabase-url \
    monitor-api-supabase-service-role-key \
    monitor-api-allowed-origins; do
    gcloud secrets add-iam-policy-binding "${secret}" \
        --member="serviceAccount:${WIF_SA_EMAIL}" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet
done

# El SA de deploy necesita poder actuar como el SA de runtime
gcloud iam service-accounts add-iam-policy-binding "${CLOUD_RUN_SA_EMAIL}" \
    --member="serviceAccount:${WIF_SA_EMAIL}" \
    --role="roles/iam.serviceAccountUser" \
    --quiet
echo "  ✓ Permisos configurados."

# ─── 5. Resumen ──────────────────────────────────────────────────────────────
PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")
WIF_PROVIDER_FULL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER_ID}"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ Setup completado!"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "Los siguientes GitHub Secrets YA EXISTEN del setup de extraction_service:"
echo "  WIF_PROVIDER        = ${WIF_PROVIDER_FULL}"
echo "  WIF_SA_EMAIL        = ${WIF_SA_EMAIL}"
echo "  GCP_PROJECT_ID      = ${PROJECT_ID}"
echo ""
echo "Agrega este nuevo Secret en GitHub → Settings → Secrets → Actions:"
echo "  MONITOR_API_CLOUD_RUN_SA  = ${CLOUD_RUN_SA_EMAIL}"
echo ""
echo "Imagen Docker:"
echo "  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}"
echo ""
echo "Cloud Run service:"
echo "  ${SERVICE_NAME} en ${REGION}"
echo ""
echo "Siguiente paso: ejecutar el workflow haciendo push a main con"
echo "cambios en monitor-app/backend/api/"
