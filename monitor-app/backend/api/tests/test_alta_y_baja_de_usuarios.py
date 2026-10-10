"""Alta y baja de usuarios, solo por la API y solo para admin (09/10).

Antes vivían en una server action del frontend (`lib/actions/users.ts`) que
usaba la clave de servicio de Supabase sin verificar quién llamaba: una server
action es un POST público, así que proteger la página no la protegía. Ahora
pasan por acá con `users.manage` (privilegiado: exige aal2). Las reglas de
escalada y del Propietario viven en services/access_admin.py y se prueban
contra la base en test_access_admin_integracion.py; acá se simula el servicio
y se prueba el cableado de la ruta.

Se sobreescribe `get_current_user` (no el guardia): así el test ejerce
require(...) de verdad.
"""
from __future__ import annotations

import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.db import get_pool
from app.routers.users import router
from app.services.access_admin import AccessError
from tests.conftest import usuario, wire_transactional_conn

ADMIN = usuario("admin", "operations_supervisor", "certification_supervisor", "insurance_supervisor", "commercial_supervisor", sub="a-1", aal="aal2")
VIEWER = usuario("reader", sub="v-1")


@pytest.fixture(autouse=True)
def reglas_permiten():
    """El servicio de acceso, simulado: por defecto permite."""
    with patch("app.routers.users.assert_can_grant", AsyncMock()) as dar, \
         patch("app.routers.users.retirar_persona", AsyncMock()) as retirar, \
         patch("app.routers.users.actualizar_persona", AsyncMock()) as actualizar, \
         patch("app.routers.users.invalidate_access", AsyncMock()):
        yield {"dar": dar, "retirar": retirar, "actualizar": actualizar}


def _cliente(user, pool=None, supabase=None):
    if pool is not None:
        wire_transactional_conn(pool, AsyncMock())
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool or AsyncMock()
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    if user is not None:
        app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def _supabase_que_crea(user_id="nuevo-1"):
    sb = MagicMock()
    sb.auth.admin.create_user.return_value = MagicMock(user=MagicMock(id=user_id))
    sb.auth.admin.invite_user_by_email.return_value = MagicMock(user=MagicMock(id=user_id))
    return sb


def _pool_con_perfil():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "nuevo-1", "full_name": "Ana", "email": "ana@webcarga.com",
        "roles": ["reader"], "active": True, "created_at": None}
    return pool


ALTA = {"email": "Ana@WebCarga.com", "full_name": "Ana", "roles": ["reader"]}


def test_sin_sesion_no_crea():
    res = _cliente(None).post("/api/v1/users", json=ALTA)
    assert res.status_code in (401, 403)


def test_un_viewer_no_crea():
    sb = _supabase_que_crea()
    res = _cliente(VIEWER, supabase=sb).post("/api/v1/users", json=ALTA)
    assert res.status_code == 403
    sb.auth.admin.create_user.assert_not_called()


def test_un_admin_sin_verificacion_en_dos_pasos_no_crea():
    """MFA para roles privilegiados (09/10): la sesión tiene que ser aal2."""
    sb = _supabase_que_crea()
    res = _cliente({**ADMIN, "aal": "aal1"}, supabase=sb).post("/api/v1/users", json=ALTA)
    assert res.status_code == 403
    assert "dos pasos" in res.json()["detail"]
    sb.auth.admin.create_user.assert_not_called()


def test_la_escalada_se_frena_antes_de_invitar(reglas_permiten):
    """Si el servicio niega dar esos roles, no se escribe la invitación ni se crea la cuenta."""
    reglas_permiten["dar"].side_effect = AccessError(403, "No puedes dar permisos que no tienes")
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    res = _cliente(ADMIN, pool=pool, supabase=sb).post("/api/v1/users", json={**ALTA, "roles": ["owner"]})
    assert res.status_code == 403
    pool.execute.assert_not_called()
    sb.auth.admin.create_user.assert_not_called()


def test_sin_contrasena_invita_por_correo_con_el_rol_pedido():
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    res = _cliente(ADMIN, pool=pool, supabase=sb).post("/api/v1/users", json=ALTA)

    assert res.status_code == 201
    assert res.json()["invitation_sent"] is True
    # La invitación (quién puede entrar y con qué roles) se escribe ANTES de
    # crear la cuenta: el alta en Auth dispara handle_new_user, que crea las
    # asignaciones desde ahí. Sin `role`: la escalera vieja se retiró (contract).
    invitacion = pool.execute.call_args_list[0]
    assert "admin_whitelist" in invitacion.args[0]
    assert "ana@webcarga.com" in invitacion.args and ["reader"] in invitacion.args
    assert "viewer" not in invitacion.args
    # Ninguna escritura de la API toca la columna vieja (que el contract borra).
    for c in pool.execute.call_args_list:
        assert not re.search(r"\brole\b(?!_)", c.args[0]), c.args[0]
    email, opciones = sb.auth.admin.invite_user_by_email.call_args.args
    assert email == "ana@webcarga.com"
    assert opciones["data"]["full_name"] == "Ana"
    sb.auth.admin.create_user.assert_not_called()


def test_si_el_correo_falla_igual_crea_la_cuenta_y_lo_dice():
    """El correo de Supabase tiene límite de envíos en el plan free: la cuenta
    se crea igual y la pantalla ofrece el mensaje para copiar."""
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    sb.auth.admin.invite_user_by_email.side_effect = Exception("email rate limit exceeded")
    res = _cliente(ADMIN, pool=pool, supabase=sb).post("/api/v1/users", json=ALTA)

    assert res.status_code == 201
    assert res.json()["invitation_sent"] is False
    assert sb.auth.admin.create_user.call_args.args[0]["email_confirm"] is True


def test_con_contrasena_la_pasa_a_auth_sin_correo():
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    res = _cliente(ADMIN, pool=pool, supabase=sb).post(
        "/api/v1/users", json={**ALTA, "password": "una-clave-larga-y-segura"})
    assert res.status_code == 201
    assert res.json()["invitation_sent"] is False
    assert sb.auth.admin.create_user.call_args.args[0]["password"] == "una-clave-larga-y-segura"
    sb.auth.admin.invite_user_by_email.assert_not_called()


def test_un_viewer_no_borra():
    sb = MagicMock()
    res = _cliente(VIEWER, supabase=sb).delete("/api/v1/users/x-1")
    assert res.status_code == 403
    sb.auth.admin.delete_user.assert_not_called()


def test_nadie_se_borra_a_si_mismo():
    sb = MagicMock()
    res = _cliente(ADMIN, supabase=sb).delete("/api/v1/users/a-1")
    assert res.status_code == 403
    sb.auth.admin.delete_user.assert_not_called()


def test_las_reglas_del_propietario_frenan_la_baja(reglas_permiten):
    reglas_permiten["retirar"].side_effect = AccessError(409, "Debe quedar al menos un Propietario")
    sb, pool = MagicMock(), AsyncMock()
    pool.fetchrow.return_value = {"email": "duena@webcarga.com"}
    res = _cliente(ADMIN, pool=pool, supabase=sb).delete("/api/v1/users/o-1")
    assert res.status_code == 409
    sb.auth.admin.delete_user.assert_not_called()


def test_desactivar_pasa_por_las_reglas_del_propietario(reglas_permiten):
    pool = AsyncMock()
    pool.fetchval.return_value = 1
    pool.fetchrow.return_value = {"id": "u-1", "full_name": "Ana", "email": "a@b.c", "roles": [],
                                  "active": False, "created_at": None}
    res = _cliente(ADMIN, pool=pool).patch("/api/v1/users/u-1", json={"active": False})
    assert res.status_code == 200
    # El chequeo y el UPDATE van juntos en el servicio (candado de Propietarios).
    assert reglas_permiten["actualizar"].call_args.kwargs == {"active": False, "full_name": None}


def test_un_admin_borra_y_retira_la_invitacion(reglas_permiten):
    sb, pool = MagicMock(), AsyncMock()
    pool.fetchrow.return_value = {"email": "ana@webcarga.com"}
    orden = []
    reglas_permiten["retirar"].side_effect = lambda *a, **k: orden.append("desactiva")
    sb.auth.admin.delete_user.side_effect = lambda *a: orden.append("borra en Auth")
    res = _cliente(ADMIN, pool=pool, supabase=sb).delete("/api/v1/users/u-1")
    assert res.status_code == 204
    sb.auth.admin.delete_user.assert_called_once_with("u-1")
    # Primero se desactiva bajo el candado; recién después se borra en Auth.
    assert orden == ["desactiva", "borra en Auth"]
    assert any("DELETE FROM public.admin_whitelist" in c.args[0] for c in pool.execute.call_args_list)
