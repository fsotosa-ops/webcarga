# app/authz/deps.py
"""Guardias por permiso. Reemplazan a require_writer/editor/admin."""
from __future__ import annotations

from collections.abc import Iterable, Mapping

from fastapi import Depends, HTTPException

from ..auth import MFA_REQUERIDO, get_current_user
from .permissions import PERMISSION_META, Permission


def require(*permissions: Permission):
    if not permissions:
        raise ValueError("require() necesita al menos un permiso")
    privilegiado = any(PERMISSION_META[p].privileged for p in permissions)

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        faltan = [p for p in permissions if p.value not in user["permissions"]]
        if faltan:
            nombres = ", ".join(PERMISSION_META[p].description for p in faltan)
            raise HTTPException(403, f"No tienes permiso para: {nombres}")
        if privilegiado and user.get("aal") != "aal2":
            raise HTTPException(403, MFA_REQUERIDO)
        return user

    _dep.required_permissions = tuple(permissions)  # lo lee la guarda de rutas (Task 8)
    return _dep


def require_fields(user: dict, sent: Iterable[str], field_map: Mapping[str, Permission]) -> None:
    """Permiso por campo: un campo sin permiso invalida el cuerpo completo."""
    sin_permiso = sorted(f for f in sent if f in field_map and field_map[f].value not in user["permissions"])
    if sin_permiso:
        raise HTTPException(403, "No tienes permiso para editar estos campos: " + ", ".join(sin_permiso))
