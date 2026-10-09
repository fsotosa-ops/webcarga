from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import get_current_user

# Toda ruta exige sesión (seguridad, 09/10): ver tests/test_toda_ruta_exige_sesion.py.
router = APIRouter(prefix="/roles", tags=["roles"], dependencies=[Depends(get_current_user)])

ROLE_ORDER = ["viewer", "writer", "editor", "admin", "owner"]

ROLE_META: dict[str, dict] = {
    "viewer": {
        "label":       "Viewer",
        "description": "Solo lectura — ve Diario, EETT y conductores",
        "level":       0,
    },
    "writer": {
        "label":       "Writer",
        "description": "Edita campos básicos del Diario (toggles, observaciones, teléfono)",
        "level":       1,
    },
    "editor": {
        "label":       "Editor",
        "description": "Edita todos los campos del Diario incluyendo los sensibles",
        "level":       2,
    },
    "admin": {
        "label":       "Admin",
        "description": "Editor + gestión de usuarios",
        "level":       3,
    },
    "owner": {
        "label":       "Owner",
        "description": "Acceso total — protegido, no puede ser degradado por admins",
        "level":       4,
    },
}


class RoleInfo(BaseModel):
    id:          str
    label:       str
    description: str
    level:       int


@router.get("", response_model=list[RoleInfo])
def list_roles():
    return [RoleInfo(id=r, **ROLE_META[r]) for r in ROLE_ORDER]
