#!/bin/bash
# Hook post-tool-use: detecta cuando se hizo un commit con cambios en frontend/
# y sugiere deployar a Vercel.

# Solo actuar después de un commit exitoso
TOOL_NAME="${CLAUDE_TOOL_NAME:-}"
if [[ "$TOOL_NAME" != "Bash" ]]; then
  exit 0
fi

TOOL_OUTPUT="${CLAUDE_TOOL_OUTPUT:-}"

# Verificar si el output indica un commit exitoso
if echo "$TOOL_OUTPUT" | grep -q "^\[main\|^feat:\|^fix:\|^chore:"; then
  # Verificar si el commit tocó archivos del frontend
  LAST_COMMIT_FILES=$(git -C /Users/usuario/Desktop/projects/webcarga diff --name-only HEAD~1 HEAD 2>/dev/null)
  if echo "$LAST_COMMIT_FILES" | grep -q "monitor-app/frontend/"; then
    echo ""
    echo "⚡ Hay cambios en el frontend commiteados."
    echo "   Usa /deploy para deployar a Vercel, o corre: vercel --prod --yes"
  fi
fi
