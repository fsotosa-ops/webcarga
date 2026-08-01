#!/bin/bash
# Hook: PostToolUse (Edit|Write) — Detecta hallazgos de negocio nuevos en los
# archivos donde suele vivir la lógica de negocio del Monitor (trips.py,
# temperature.ts/kpis.ts, AGENTLOG.md), buscando las mismas frases marcadoras
# que ya se usan en los comentarios/AGENTLOG de esta sesión.

INPUT=$(cat /dev/stdin)
FILE=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    ti = d.get('tool_input', d)
    print(ti.get('file_path', ''))
except:
    print('')
" 2>/dev/null <<< "$INPUT")

PROJECT_DIR="/Users/usuario/Desktop/projects/webcarga"

# Solo aplica a los archivos donde suele vivir la lógica de negocio del Monitor
if [[ "$FILE" =~ (routers/trips\.py|lib/utils/temperature\.ts|lib/utils/kpis\.ts|AGENTLOG\.md)$ ]]; then
  REL_FILE="${FILE#$PROJECT_DIR/}"

  NEW_FINDING=$(cd "$PROJECT_DIR" && git diff HEAD -- "$REL_FILE" 2>/dev/null \
    | grep '^+' | grep -v '^+++' \
    | grep -iE 'no es un bug|bug real|confirmado con datos reales|causa raíz|causa raiz|FIX 202[0-9]-' \
    | head -3)

  if [ -n "$NEW_FINDING" ]; then
    python3 -c "
import json
msg = 'Parece que se documentó un hallazgo de negocio en $REL_FILE. Si es un comportamiento que el equipo de negocio debería entender, considera ejecutar /log-casuistica para registrarlo en docs/casuistica-negocio-diario.md.'
print(json.dumps({'decision': 'continue', 'systemMessage': msg}))
"
  fi
fi
exit 0
