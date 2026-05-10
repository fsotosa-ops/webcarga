#!/bin/bash
# Carga variables de entorno a Vercel desde .env.local.
# Uso: bash scripts/setup-vercel-env.sh
# Requisito previo: vercel login

set -e

ENV_FILE="$(dirname "$0")/../.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: no se encontró .env.local en $(realpath "$ENV_FILE")"
  exit 1
fi

load_var() {
  local VAR_NAME="$1"
  local ENV="$2"
  local VALUE
  VALUE=$(grep "^${VAR_NAME}=" "$ENV_FILE" | cut -d'=' -f2-)
  if [ -z "$VALUE" ]; then
    echo "  ⚠️  ${VAR_NAME} no encontrada en .env.local — omitida para ${ENV}"
    return
  fi
  echo "$VALUE" | vercel env add "$VAR_NAME" "$ENV" --force 2>&1 | grep -E "Overrode|Added|Error" || true
  echo "  ✓ ${VAR_NAME} → ${ENV}"
}

echo "→ Cargando variables públicas (todos los ambientes)..."
for ENV in production preview development; do
  load_var "NEXT_PUBLIC_SUPABASE_URL" "$ENV"
  load_var "NEXT_PUBLIC_SUPABASE_ANON_KEY" "$ENV"
done

echo ""
echo "→ Cargando SUPABASE_SERVICE_ROLE_KEY..."
SERVICE_KEY=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" "$ENV_FILE" | cut -d'=' -f2-)

if [ -z "$SERVICE_KEY" ]; then
  echo "  ⚠️  SUPABASE_SERVICE_ROLE_KEY no está en .env.local (está comentada)."
  echo "     Obtenerla en: Supabase Dashboard → Project Settings → API → service_role"
  echo ""
  read -r -p "  Pega el service_role key aquí (Enter para omitir): " SERVICE_KEY
fi

if [ -n "$SERVICE_KEY" ]; then
  echo "$SERVICE_KEY" | vercel env add SUPABASE_SERVICE_ROLE_KEY production --force 2>&1 | grep -E "Overrode|Added|Error" || true
  echo "  ✓ SUPABASE_SERVICE_ROLE_KEY → production"
else
  echo "  → Omitida. Sin ella, crear/eliminar usuarios en el panel admin no funcionará."
fi

echo ""
echo "✓ Listo. Para aplicar los cambios: vercel --prod --yes"
