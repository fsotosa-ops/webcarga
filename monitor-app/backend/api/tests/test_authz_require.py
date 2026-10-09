# tests/test_authz_require.py
import pytest
from fastapi import HTTPException

from app.authz import Permission
from app.authz.deps import require


def _user(*perms, aal="aal1"):
    return {"sub": "u-1", "email": "x@webcarga.com", "aal": aal, "roles": ["r"],
            "permissions": frozenset(p.value for p in perms)}


async def test_con_el_permiso_pasa():
    dep = require(Permission.CLOSURES_SIGN)
    user = _user(Permission.CLOSURES_SIGN)
    assert await dep(user) is user


async def test_sin_el_permiso_403_con_el_nombre():
    dep = require(Permission.CLOSURES_SIGN)
    with pytest.raises(HTTPException) as err:
        await dep(_user(Permission.OPERATIONS_READ))
    assert err.value.status_code == 403
    assert "Firmar y reabrir el cierre del día" in err.value.detail


async def test_varios_permisos_exigen_todos():
    dep = require(Permission.TRIPS_EDIT_BASIC, Permission.TRIPS_EDIT_SENSITIVE)
    with pytest.raises(HTTPException):
        await dep(_user(Permission.TRIPS_EDIT_BASIC))


async def test_privilegiado_exige_aal2():
    dep = require(Permission.USERS_MANAGE)
    with pytest.raises(HTTPException) as err:
        await dep(_user(Permission.USERS_MANAGE, aal="aal1"))
    assert "dos pasos" in err.value.detail
    assert await dep(_user(Permission.USERS_MANAGE, aal="aal2"))


def test_require_sin_permisos_es_error_de_programacion():
    with pytest.raises(ValueError):
        require()
