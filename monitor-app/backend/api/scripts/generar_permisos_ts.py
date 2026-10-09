# scripts/generar_permisos_ts.py
"""Genera frontend/lib/authz/permisos.generated.ts desde el catálogo.
Uso: venv/bin/python scripts/generar_permisos_ts.py"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.authz.permissions import PERMISSION_META  # noqa: E402

DESTINO = Path(__file__).resolve().parents[3] / "frontend/lib/authz/permisos.generated.ts"


def contenido() -> str:
    lineas = [
        "// GENERADO por backend/api/scripts/generar_permisos_ts.py desde app/authz/permissions.py.",
        "// No editar a mano: el test test_permisos_ts_en_sincronia.py falla si queda desfasado.",
        "export const PERMISOS = {",
    ]
    for p, m in PERMISSION_META.items():
        lineas.append(f"  '{p.value}': {{ area: '{m.area}', privileged: {str(m.privileged).lower()} }},")
    lineas += ["} as const", "", "export type PermissionCode = keyof typeof PERMISOS", ""]
    return "\n".join(lineas)


if __name__ == "__main__":
    DESTINO.write_text(contenido())
    print(f"escrito {DESTINO}")
