"""El CacheMiddleware responde ANTES de las dependencias de FastAPI: si cachea
una ruta que exige sesión, cualquiera sin token recibe la respuesta cacheada
de otra persona (09/10: /trips/meta y /roles quedaron así al exigirles sesión).
Ninguna ruta cacheada por el middleware puede exigir sesión."""
from fastapi.routing import APIRoute

from app.auth import get_current_user
from app.main import app
from app.middleware.cache import _STATIC_ROUTES


def _exige_sesion(dependant) -> bool:
    return any(d.call is get_current_user or _exige_sesion(d) for d in dependant.dependencies)


def test_el_middleware_no_cachea_rutas_con_sesion():
    con_sesion = sorted(
        r.path for r in app.routes
        if isinstance(r, APIRoute) and r.path in _STATIC_ROUTES and _exige_sesion(r.dependant)
    )
    assert con_sesion == [], f"Rutas cacheadas por el middleware que exigen sesión: {con_sesion}"
