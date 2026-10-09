# tests/test_matriz_roles.py
"""Matriz rol × ruta: qué acepta y qué rechaza cada rol de sistema.
Se arma desde el catálogo y la ruta: no hay una segunda lista escrita a mano."""
import pytest
from fastapi.routing import APIRoute

from app.authz.permissions import SYSTEM_ROLES, Permission
from app.main import app
from tests.test_toda_ruta_declara_permiso import _permisos

RUTAS = [(r, _permisos(r.dependant)) for r in app.routes if isinstance(r, APIRoute) and _permisos(r.dependant)]


@pytest.mark.parametrize("rol", SYSTEM_ROLES, ids=lambda r: r.code)
def test_rol_contra_cada_ruta(rol):
    tiene = set(Permission) if rol.grants_all else set(rol.permissions)
    for ruta, requeridos in RUTAS:
        acepta = set(requeridos) <= tiene
        if rol.code == "reader":
            assert acepta == all(p.value.endswith(".read") for p in requeridos), ruta.path
        if rol.code == "owner":
            assert acepta, ruta.path


def test_casos_de_negocio():
    por = {r.code: r.permissions for r in SYSTEM_ROLES}
    assert Permission.CLOSURES_SIGN in por["operations_operator"]
    assert Permission.DOCUMENTS_REVIEW not in por["certification_operator"]
    assert Permission.USERS_MANAGE not in por["support"]
    assert Permission.POLICIES_DELETE not in por["insurance_operator"]
