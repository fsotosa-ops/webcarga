# tests/test_toda_ruta_declara_permiso.py
"""Toda ruta declara el permiso que exige (RBAC). Negar por defecto: una ruta
nueva sin require(...) hace fallar este test."""
from fastapi.routing import APIRoute

from app.main import app

EXCEPCIONES = {
    "/health",                        # chequeo de vida de Cloud Run
    "/api/v1/me",                     # mis propios permisos
    "/api/v1/filter-groups",          # filtros personales: se validan por dueño
    "/api/v1/filter-groups/{group_id}",
}
DE_PRUEBA = "/__test__/"


def _permisos(dependant) -> tuple:
    for d in dependant.dependencies:
        req = getattr(d.call, "required_permissions", None)
        if req:
            return req
        sub = _permisos(d)
        if sub:
            return sub
    return ()


def test_toda_ruta_declara_permiso():
    sin_permiso = sorted(
        f"{sorted(r.methods)[0]} {r.path}"
        for r in app.routes
        if isinstance(r, APIRoute) and r.path not in EXCEPCIONES
        and not r.path.startswith(DE_PRUEBA) and not _permisos(r.dependant)
    )
    assert sin_permiso == [], "Rutas sin permiso declarado:\n" + "\n".join(sin_permiso)


def test_las_excepciones_igual_exigen_sesion():
    from app.auth import get_current_user

    def exige(dep):
        return any(d.call is get_current_user or exige(d) for d in dep.dependencies)
    for r in app.routes:
        if isinstance(r, APIRoute) and r.path in EXCEPCIONES - {"/health"}:
            assert exige(r.dependant), r.path
