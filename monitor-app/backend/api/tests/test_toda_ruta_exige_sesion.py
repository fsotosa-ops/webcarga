"""Toda ruta de la API exige sesión (seguridad, 09/10).

La auditoría encontró rutas que respondían sin token: GET /config/* (estados,
umbrales, temperaturas, reglas de alerta, revisiones, búsqueda), /taxonomies,
/roles y /trips/meta. Cada una se olvidó de poner `Depends(get_current_user)`
en su firma, y nada lo detectaba. Este test recorre las rutas de la app
y falla con la lista de las que no dependen —directa o indirectamente, vía
require_writer/require_editor/require_admin— de get_current_user.
"""
from __future__ import annotations

from fastapi.routing import APIRoute

from app.auth import get_current_user
from app.main import app

# Lo único que responde sin sesión: el chequeo de vida de Cloud Run.
PUBLICAS = {"/health"}
# test_error_inesperado.py registra rutas de prueba en la misma app.
DE_PRUEBA = "/__test__/"


def _exige_sesion(dependant) -> bool:
    return any(d.call is get_current_user or _exige_sesion(d) for d in dependant.dependencies)


def test_toda_ruta_exige_sesion():
    sin_sesion = sorted(
        f"{sorted(r.methods)[0]} {r.path}"
        for r in app.routes
        if isinstance(r, APIRoute) and r.path not in PUBLICAS and not r.path.startswith(DE_PRUEBA)
        and not _exige_sesion(r.dependant)
    )
    assert sin_sesion == [], "Rutas que responden sin sesión:\n" + "\n".join(sin_sesion)
