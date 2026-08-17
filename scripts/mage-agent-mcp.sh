#!/bin/bash
# Levanta el MCP server de mage-agent con un HOME propio de este repo, para que
# su cluster quede aislado del de cualquier otro proyecto de esta máquina, y
# renueva el oauth_token solo cuando está por vencer.
#
# Por qué existe:
#   mage-agent guarda sus credenciales en un único archivo global
#   (~/.mage-agent/config.json). No hay flag CLI ni env var propia para elegir
#   otro path: core/config.py hace `Path.home() / ".mage-agent" / "config.json"`.
#   Peor todavía, el MCP relee ese archivo desde disco EN CADA TOOL CALL (cada
#   handler de mcp/tools.py es un `SkillRuntime.from_config()` → `load_config()`),
#   así que no basta con presetear el cluster al arrancar: si otro proyecto se
#   loguea a su propio cluster mientras esta sesión está abierta, las tool calls
#   de acá se van en silencio al cluster equivocado.
#
#   (Este script antes copiaba un snapshot de perfil sobre el config global.
#   Eso arreglaba el arranque pero no el problema de fondo, justamente por la
#   relectura por-call de arriba: con dos sesiones abiertas se cruzaban.)
#
#   La única palanca real es HOME: `Path.home()` sí respeta $HOME. Fijándolo en
#   este proceso, TODOS los load_config() del MCP resuelven al config de este
#   repo, pase lo que pase en el resto de la máquina. Dos sesiones de Claude
#   Code en dos repos = dos procesos = dos HOME = aislamiento real.
#
# Auto-renovación:
#   El oauth_token vence (~30 días) y no se refresca solo: el único save_config()
#   del paquete está en el login. Este script mira el claim `expires` del JWT y,
#   si quedan menos de RENEW_IF_DAYS_LEFT días, re-loguea usando la password
#   guardada en el Keychain de macOS bajo el servicio KEYCHAIN_SERVICE.
#
#   La password no pasa nunca por argv (visible en `ps` para toda la máquina) ni
#   por el environment: va por stdin al helper de Python. Tampoco se hardcodea el
#   email acá — sale del atributo `acct` del mismo item del Keychain, así que hay
#   una sola fuente de verdad.
#
# Setup, una vez por repo (lo corre el humano). `-w` va ÚLTIMO y sin valor: así
# `security` pide la password interactivamente, con confirmación, en vez de
# dejarla en el history. Si -w no va al final se come el flag siguiente como si
# fuera la password (`-w -T /usr/bin/security` guarda el literal "-T"):
#
#   security add-generic-password -s mage-agent-webcarga \
#     -a <email-del-cluster> -T /usr/bin/security -w
#
#   La primera lectura macOS puede pedir confirmación por GUI: darle
#   "Permitir siempre".
#
# Re-login manual (fallback si el Keychain no está configurado):
#
#   cd /Users/usuario/Desktop/projects/webcarga
#   HOME="$PWD/.mage-agent-home" monitor-app/backend/venv/bin/mage-agent login \
#     --cluster-url https://cluster.mage.ai/mageai-20874-development --force
#
# Hay un respaldo offline del config en ~/.mage-agent-profiles/webcarga.json
# (ya fuera del camino crítico: este script no lo lee). Sirve para re-sembrar
# .mage-agent-home/.mage-agent/config.json sin re-loguear, mientras el token
# siga vigente.

set -euo pipefail

# Todos los paths se calculan ANTES de exportar HOME: después del export, `~` y
# $HOME ya apuntan al directorio aislado.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAGE_AGENT_BIN="$REPO_ROOT/monitor-app/backend/venv/bin/mage-agent"
MAGE_PYTHON="$REPO_ROOT/monitor-app/backend/venv/bin/python"
AGENT_HOME="$REPO_ROOT/.mage-agent-home"
CONFIG="$AGENT_HOME/.mage-agent/config.json"
CLUSTER_URL="https://cluster.mage.ai/mageai-20874-development"
KEYCHAIN_SERVICE="mage-agent-webcarga"
RENEW_IF_DAYS_LEFT=3
PROFILE_BACKUP="$HOME/.mage-agent-profiles/webcarga.json"

log() { echo "mage-agent-mcp.sh: $*" >&2; }

manual_login_hint() {
  log "  Opción A — guardar la password en el Keychain para que se renueve sola:"
  log "    security add-generic-password -s $KEYCHAIN_SERVICE -a <email> -T /usr/bin/security -w"
  log "  Opción B — re-sembrar del respaldo (si el token sigue vigente):"
  log "    mkdir -p \"$AGENT_HOME/.mage-agent\" && cp \"$PROFILE_BACKUP\" \"$CONFIG\" && chmod 600 \"$CONFIG\""
  log "  Opción C — re-loguear a mano (pide email + password):"
  log "    cd $REPO_ROOT && HOME=\"\$PWD/.mage-agent-home\" monitor-app/backend/venv/bin/mage-agent login --cluster-url $CLUSTER_URL --force"
}

if [ ! -x "$MAGE_AGENT_BIN" ]; then
  log "no existe el binario $MAGE_AGENT_BIN"
  exit 1
fi

# --- Estado del token -------------------------------------------------------
# Imprime "<estado> <usable> <días_restantes>": renew|ok, usable|expired.
# No toca ningún secreto, así que corre en todos los arranques sin costo.
TOKEN_STATUS_PY='
import base64, json, sys, time
cfg_path, days = sys.argv[1], float(sys.argv[2])
try:
    tok = json.load(open(cfg_path))["oauth_token"]
    p = tok.split(".")[1]
    p += "=" * (-len(p) % 4)
    exp = float(json.loads(base64.urlsafe_b64decode(p))["expires"])
except Exception:
    print("renew expired 0")
    raise SystemExit(0)
left = exp - time.time()
print("%s %s %d" % (
    "renew" if left < days * 86400 else "ok",
    "usable" if left > 0 else "expired",
    left // 86400,
))
'

# --- Renovación -------------------------------------------------------------
# Usa las funciones del propio paquete (authenticate_with_cluster + save_config)
# en vez de reimplementar el endpoint /api/sessions. La password entra por stdin.
RENEW_PY='
import sys
from mage_agent.core.config import AgentConfig, load_config, save_config
from mage_agent.core.http import authenticate_with_cluster

cluster_url, email = sys.argv[1], sys.argv[2]
password = sys.stdin.read().rstrip("\n")
auth = authenticate_with_cluster(cluster_url, email, password)
try:
    prev = load_config()
except Exception:
    prev = AgentConfig()
save_config(AgentConfig(
    cluster_url=cluster_url,
    api_key=prev.api_key,
    oauth_token=auth.oauth_token,
    management_cluster_url=prev.management_cluster_url or cluster_url,
    workspace_name=prev.workspace_name,
))
'

renew_token() {
  # OJO: el Keychain se lee con el HOME real. `security` resuelve el llavero
  # login y su search list bajo $HOME (~/Library/Keychains, ~/Library/
  # Preferences/com.apple.security.plist); con HOME ya apuntando a
  # .mage-agent-home/ no encontraría nada. Por eso esto corre antes del export.
  local password email
  if ! password="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)"; then
    log "no hay item '$KEYCHAIN_SERVICE' en el Keychain — no puedo renovar solo."
    return 1
  fi
  email="$(security find-generic-password -s "$KEYCHAIN_SERVICE" 2>/dev/null \
    | awk -F'"' '/"acct"<blob>=/ {print $4}')"
  if [ -z "$email" ]; then
    log "el item '$KEYCHAIN_SERVICE' no tiene email en su atributo 'acct'."
    return 1
  fi

  # El helper sí necesita el HOME aislado: save_config() escribe en
  # Path.home()/.mage-agent/config.json. Se lo pasamos sólo a esta invocación.
  if printf '%s' "$password" \
     | HOME="$AGENT_HOME" "$MAGE_PYTHON" -c "$RENEW_PY" "$CLUSTER_URL" "$email" >&2; then
    log "token renovado para $email en $CLUSTER_URL"
    return 0
  fi
  log "falló la renovación contra $CLUSTER_URL"
  return 1
}

# --- Arranque ---------------------------------------------------------------
if [ ! -f "$CONFIG" ]; then
  log "falta $CONFIG — intento crearlo desde el Keychain."
  if ! renew_token; then
    manual_login_hint
    exit 1
  fi
fi

read -r TOKEN_STATE TOKEN_USABLE TOKEN_DAYS_LEFT <<<"$(
  "$MAGE_PYTHON" -c "$TOKEN_STATUS_PY" "$CONFIG" "$RENEW_IF_DAYS_LEFT"
)"

if [ "${MAGE_FORCE_RENEW:-}" = "1" ]; then
  log "MAGE_FORCE_RENEW=1 — renuevo aunque queden $TOKEN_DAYS_LEFT días."
  TOKEN_STATE="renew"
fi

if [ "$TOKEN_STATE" = "renew" ]; then
  if ! renew_token; then
    if [ "$TOKEN_USABLE" = "usable" ]; then
      # Un fallo de renovación no debe tumbar una sesión que iba a andar igual.
      log "sigo con el token actual (vence en $TOKEN_DAYS_LEFT días)."
      manual_login_hint
    else
      log "el token está vencido y no pude renovarlo."
      manual_login_hint
      exit 1
    fi
  fi
fi

# Sin `cd`: el cwd lo fija Claude Code en la raíz del repo y el sync de mage
# resuelve .mage-agent/local_sync relativo a cwd. `exec` lo preserva.
export HOME="$AGENT_HOME"
exec "$MAGE_AGENT_BIN" mcp "$@"
