#!/bin/bash
# Levanta el MCP server de mage-agent con un HOME propio de este repo, para que
# su cluster quede aislado del de cualquier otro proyecto de esta máquina.
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
# Bootstrap / re-login (el oauth_token no se refresca solo — el único
# save_config() del paquete está en el login, así que cuando expire hay que
# repetir esto):
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
AGENT_HOME="$REPO_ROOT/.mage-agent-home"
CONFIG="$AGENT_HOME/.mage-agent/config.json"
CLUSTER_URL="https://cluster.mage.ai/mageai-20874-development"
PROFILE_BACKUP="$HOME/.mage-agent-profiles/webcarga.json"

if [ ! -x "$MAGE_AGENT_BIN" ]; then
  echo "mage-agent-mcp.sh: no existe el binario $MAGE_AGENT_BIN" >&2
  exit 1
fi

if [ ! -f "$CONFIG" ]; then
  echo "mage-agent-mcp.sh: falta $CONFIG" >&2
  echo "  Opción A — re-sembrar del respaldo (si el token sigue vigente):" >&2
  echo "    mkdir -p \"$AGENT_HOME/.mage-agent\" && cp \"$PROFILE_BACKUP\" \"$CONFIG\" && chmod 600 \"$CONFIG\"" >&2
  echo "  Opción B — re-loguear (pide email + password):" >&2
  echo "    cd $REPO_ROOT && HOME=\"\$PWD/.mage-agent-home\" monitor-app/backend/venv/bin/mage-agent login --cluster-url $CLUSTER_URL --force" >&2
  exit 1
fi

# Sin `cd`: el cwd lo fija Claude Code en la raíz del repo y el sync de mage
# resuelve .mage-agent/local_sync relativo a cwd. `exec` lo preserva.
export HOME="$AGENT_HOME"
exec "$MAGE_AGENT_BIN" mcp "$@"
