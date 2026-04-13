#!/usr/bin/env bash
# =============================================================================
# init-gcp.sh — Setup completo de GCP para webcarga extraction-service
#
# Configura: Artifact Registry, Secret Manager, Service Accounts,
#            Workload Identity Federation (para GitHub Actions), y Cloud Run.
#
# Uso:
#   1. Editar las variables de configuración abajo
#   2. Autenticarse: gcloud auth login
#   3. Ejecutar: bash init-gcp.sh
#   4. Configurar los GitHub Secrets que se imprimen al final
#
# El script es idempotente — puede re-ejecutarse sin crear duplicados.
# =============================================================================
set -euo pipefail

# ─── CONFIGURACIÓN (editar antes de ejecutar) ────────────────────────────────
PROJECT_ID="webcarga-dev-493220"           # Tu proyecto GCP
REGION="us-central1"
SERVICE_NAME="webcarga-extraction"      # Nombre del servicio en Cloud Run
AR_REPO="webcarga"                      # Nombre del repo en Artifact Registry
IMAGE_NAME="extraction-service"

# Service Accounts
CLOUD_RUN_SA_NAME="webcarga-extraction-sa"
WIF_SA_NAME="github-actions-sa"

# Workload Identity Federation
WIF_POOL="github-actions-pool"
WIF_PROVIDER="github-provider"
GITHUB_ORG_OR_USER="fsotosa-ops"  # ← CAMBIAR: tu usuario u org de GitHub
GITHUB_REPO="webcarga"                  # ← CAMBIAR: nombre del repo en GitHub

# Secrets (valores que se guardarán en Secret Manager)
QANALYTICS_USER_VALUE="76376879-1"      # ← CAMBIAR si es diferente
QANALYTICS_PASS_VALUE="q8791"           # ← CAMBIAR si es diferente
GCS_BUCKET_VALUE="sandbox-webcarga"     # ← CAMBIAR si es diferente
# ─────────────────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════════════════════════════"
echo "  webcarga GCP Setup — Proyecto: ${PROJECT_ID}"
echo "══════════════════════════════════════════════════════════════"

# ─── 1. Setear proyecto ──────────────────────────────────────────────────────
echo ""
echo "▸ [1/7] Seteando proyecto ${PROJECT_ID}..."
gcloud config set project "${PROJECT_ID}"

# ─── 2. Habilitar APIs necesarias ────────────────────────────────────────────
echo ""
echo "▸ [2/7] Habilitando APIs..."
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    secretmanager.googleapis.com \
    iamcredentials.googleapis.com \
    iam.googleapis.com \
    cloudresourcemanager.googleapis.com

# ─── 3. Crear Artifact Registry repo ─────────────────────────────────────────
echo ""
echo "▸ [3/7] Creando repo en Artifact Registry..."
if gcloud artifacts repositories describe "${AR_REPO}" \
    --location="${REGION}" &>/dev/null; then
    echo "  ✓ Repo '${AR_REPO}' ya existe."
else
    gcloud artifacts repositories create "${AR_REPO}" \
        --repository-format=docker \
        --location="${REGION}" \
        --description="Docker images para webcarga extraction service"
    echo "  ✓ Repo '${AR_REPO}' creado."
fi

# ─── 4. Crear secrets en Secret Manager ──────────────────────────────────────
echo ""
echo "▸ [4/7] Creando secrets en Secret Manager..."

create_secret() {
    local name=$1
    local value=$2
    if gcloud secrets describe "${name}" &>/dev/null; then
        echo "  ✓ Secret '${name}' ya existe (no se sobreescribe)."
    else
        echo -n "${value}" | gcloud secrets create "${name}" --data-file=-
        echo "  ✓ Secret '${name}' creado."
    fi
}

create_secret "qanalytics-user" "${QANALYTICS_USER_VALUE}"
create_secret "qanalytics-pass" "${QANALYTICS_PASS_VALUE}"
create_secret "gcs-bucket-name" "${GCS_BUCKET_VALUE}"

# ─── 5. Crear Service Accounts ───────────────────────────────────────────────
echo ""
echo "▸ [5/7] Creando Service Accounts..."

CLOUD_RUN_SA_EMAIL="${CLOUD_RUN_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
WIF_SA_EMAIL="${WIF_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# SA para Cloud Run (runtime)
if gcloud iam service-accounts describe "${CLOUD_RUN_SA_EMAIL}" &>/dev/null; then
    echo "  ✓ SA '${CLOUD_RUN_SA_NAME}' ya existe."
else
    gcloud iam service-accounts create "${CLOUD_RUN_SA_NAME}" \
        --display-name="webcarga Cloud Run SA"
    echo "  ✓ SA '${CLOUD_RUN_SA_NAME}' creado."
    echo "  Esperando propagación del SA..."
    sleep 10
fi

# Roles para Cloud Run SA
echo "  Asignando roles a Cloud Run SA..."
for role in roles/storage.objectCreator roles/secretmanager.secretAccessor; do
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${CLOUD_RUN_SA_EMAIL}" \
        --role="${role}" \
        --quiet
done

# SA para GitHub Actions (deploy)
if gcloud iam service-accounts describe "${WIF_SA_EMAIL}" &>/dev/null; then
    echo "  ✓ SA '${WIF_SA_NAME}' ya existe."
else
    gcloud iam service-accounts create "${WIF_SA_NAME}" \
        --display-name="GitHub Actions deploy SA"
    echo "  ✓ SA '${WIF_SA_NAME}' creado."
    echo "  Esperando propagación del SA..."
    sleep 10
fi

# Roles para GitHub Actions SA
echo "  Asignando roles a GitHub Actions SA..."
for role in \
    roles/artifactregistry.writer \
    roles/run.admin \
    roles/iam.serviceAccountUser \
    roles/secretmanager.secretAccessor; do
    gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
        --member="serviceAccount:${WIF_SA_EMAIL}" \
        --role="${role}" \
        --quiet
done

# ─── 6. Configurar Workload Identity Federation ─────────────────────────────
echo ""
echo "▸ [6/7] Configurando Workload Identity Federation..."

PROJECT_NUMBER=$(gcloud projects describe "${PROJECT_ID}" --format="value(projectNumber)")

# Crear WI Pool
if gcloud iam workload-identity-pools describe "${WIF_POOL}" \
    --location=global &>/dev/null; then
    echo "  ✓ WI Pool '${WIF_POOL}' ya existe."
else
    gcloud iam workload-identity-pools create "${WIF_POOL}" \
        --location=global \
        --display-name="GitHub Actions Pool"
    echo "  ✓ WI Pool '${WIF_POOL}' creado."
fi

# Crear WI Provider
if gcloud iam workload-identity-pools providers describe "${WIF_PROVIDER}" \
    --workload-identity-pool="${WIF_POOL}" \
    --location=global &>/dev/null; then
    echo "  ✓ WI Provider '${WIF_PROVIDER}' ya existe."
else
    gcloud iam workload-identity-pools providers create-oidc "${WIF_PROVIDER}" \
        --location=global \
        --workload-identity-pool="${WIF_POOL}" \
        --display-name="GitHub Provider" \
        --attribute-mapping="google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository" \
        --attribute-condition="assertion.repository=='${GITHUB_ORG_OR_USER}/${GITHUB_REPO}'" \
        --issuer-uri="https://token.actions.githubusercontent.com"
    echo "  ✓ WI Provider '${WIF_PROVIDER}' creado."
fi

# Bind: permitir que GitHub Actions impersone el SA
echo "  Configurando binding de impersonación..."
gcloud iam service-accounts add-iam-policy-binding "${WIF_SA_EMAIL}" \
    --role="roles/iam.workloadIdentityUser" \
    --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/attribute.repository/${GITHUB_ORG_OR_USER}/${GITHUB_REPO}" \
    --quiet

WIF_PROVIDER_FULL="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${WIF_POOL}/providers/${WIF_PROVIDER}"

# ─── 7. Resumen ──────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  ✅ Setup completado!"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "Configura estos valores como GitHub Secrets"
echo "(Settings > Secrets and variables > Actions):"
echo ""
echo "  GCP_PROJECT_ID      = ${PROJECT_ID}"
echo "  WIF_PROVIDER        = ${WIF_PROVIDER_FULL}"
echo "  WIF_SA_EMAIL        = ${WIF_SA_EMAIL}"
echo "  CLOUD_RUN_SA_EMAIL  = ${CLOUD_RUN_SA_EMAIL}"
echo ""
echo "Imagen Docker:"
echo "  ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/${IMAGE_NAME}"
echo ""
echo "Cloud Run service:"
echo "  ${SERVICE_NAME} en ${REGION}"
echo ""
echo "Siguiente paso: push a main con cambios en extraction_service/"
echo "para triggear el workflow de deploy."
