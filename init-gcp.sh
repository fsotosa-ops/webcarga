#!/bin/bash
set -e

# ==============================================================================
# CONFIGURACIÓN INICIAL — Frontend (summer-digital) en Cloud Run
# Reutiliza el mismo proyecto GCP, Artifact Registry y WIF pool del backend.
# Solo agrega: binding WIF para este repo + servicio Cloud Run.
# ==============================================================================
PROJECT_ID="fsummer-oasis-dev"
GITHUB_ORG="fsotosa-ops"
GITHUB_REPO="summer-digital"
REGION="us-central1"

# Colores para output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

CLOUD_RUN_SERVICE="summer-up-staging"

echo -e "${GREEN}🚀 Configurando frontend (Summer Up) en proyecto: $PROJECT_ID${NC}"

# Asegurar proyecto activo
gcloud config set project "$PROJECT_ID"

# ==============================================================================
# 1. VERIFICAR PREREQUISITOS (ya creados por oasis-backend/init-gcp.sh)
# ==============================================================================
echo -e "\n${YELLOW}[1/3] Verificando prerequisitos del backend...${NC}"

SA_NAME="cloudrun-deployer"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
RUNTIME_SA_NAME="cloudrun-runtime"
RUNTIME_SA_EMAIL="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"
REPO_NAME="oasis-api"

# Verificar que el Artifact Registry existe
if ! gcloud artifacts repositories describe "$REPO_NAME" --location="$REGION" &>/dev/null; then
    echo -e "${RED}❌ Artifact Registry '$REPO_NAME' no existe. Ejecuta primero oasis-backend/init-gcp.sh${NC}"
    exit 1
fi
echo "✅ Artifact Registry: $REPO_NAME"

# Verificar que el WIF pool existe
if ! gcloud iam workload-identity-pools describe "$POOL_NAME" --location="global" &>/dev/null; then
    echo -e "${RED}❌ WIF pool '$POOL_NAME' no existe. Ejecuta primero oasis-backend/init-gcp.sh${NC}"
    exit 1
fi
echo "✅ WIF Pool: $POOL_NAME"

# Verificar service accounts
if ! gcloud iam service-accounts describe "$SA_EMAIL" &>/dev/null; then
    echo -e "${RED}❌ Service account deployer no existe. Ejecuta primero oasis-backend/init-gcp.sh${NC}"
    exit 1
fi
echo "✅ Deployer SA: $SA_EMAIL"
echo "✅ Runtime SA: $RUNTIME_SA_EMAIL"

# ==============================================================================
# 2. VINCULAR REPO FRONTEND AL WIF (para que GitHub Actions pueda deployar)
# ==============================================================================
echo -e "\n${YELLOW}[2/3] Vinculando repo $GITHUB_ORG/$GITHUB_REPO al WIF...${NC}"

POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" --location="global" --format="value(name)")

# Agregar binding para este repo (idempotente — si ya existe no falla)
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/${POOL_ID}/attribute.repository/${GITHUB_ORG}/${GITHUB_REPO}" \
    --quiet >/dev/null 2>&1 || true

echo "✅ WIF binding creado para ${GITHUB_ORG}/${GITHUB_REPO}"

PROVIDER_FULL_NAME=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
    --workload-identity-pool="$POOL_NAME" --location="global" --format="value(name)")

# ==============================================================================
# 3. MOSTRAR SECRETS NECESARIOS PARA GITHUB
# ==============================================================================
echo -e "\n${YELLOW}[3/3] Secrets para GitHub Actions...${NC}"

# Leer valores del backend para reutilizar
BACKEND_URL=""
if gcloud run services describe oasis-backend --region="$REGION" --format="value(status.url)" &>/dev/null; then
    BACKEND_URL=$(gcloud run services describe oasis-backend --region="$REGION" --format="value(status.url)")
fi

echo ""
echo -e "${GREEN}✅ ¡CONFIGURACIÓN COMPLETADA!${NC}"
echo "------------------------------------------------------------------------"
echo "Guarda estos valores en GitHub (Settings > Secrets and variables > Actions)"
echo "del repo: ${GITHUB_ORG}/${GITHUB_REPO}"
echo "------------------------------------------------------------------------"
echo -e "GCP_PROJECT_ID:                 ${GREEN}$PROJECT_ID${NC}"
echo -e "GCP_REGION:                     ${GREEN}$REGION${NC}"
echo -e "GCP_SERVICE_ACCOUNT:            ${GREEN}$SA_EMAIL${NC}"
echo -e "GCP_WORKLOAD_IDENTITY_PROVIDER: ${GREEN}$PROVIDER_FULL_NAME${NC}"
echo "------------------------------------------------------------------------"
echo ""
echo "Además, agrega estos secrets de build (NEXT_PUBLIC_* se inyectan en build time):"
echo "------------------------------------------------------------------------"
if [ -n "$BACKEND_URL" ]; then
    echo -e "NEXT_PUBLIC_API_URL:            ${GREEN}${BACKEND_URL}/api/v1${NC}"
else
    echo -e "NEXT_PUBLIC_API_URL:            ${YELLOW}<URL del backend en Cloud Run>/api/v1${NC}"
fi
echo -e "NEXT_PUBLIC_SUPABASE_URL:       ${YELLOW}<tu SUPABASE_URL>${NC}"
echo -e "NEXT_PUBLIC_SUPABASE_ANON_KEY:  ${YELLOW}<tu SUPABASE_ANON_KEY>${NC}"
echo "------------------------------------------------------------------------"
echo ""
echo -e "${YELLOW}IMPORTANTE — Después del primer deploy del frontend:${NC}"
echo "1. Copia la URL del servicio Cloud Run (será algo como https://${CLOUD_RUN_SERVICE}-XXXXX.${REGION}.run.app)"
echo "2. Agrega esa URL a ALLOWED_ORIGINS en GCP Secret Manager del backend:"
echo "   gcloud secrets versions add ALLOWED_ORIGINS --data-file=- <<< 'http://localhost:3000,https://${CLOUD_RUN_SERVICE}-XXXXX.${REGION}.run.app'"
echo "------------------------------------------------------------------------"
