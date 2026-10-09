"""Alta y baja de usuarios, solo por la API y solo para admin (09/10).

Antes vivían en una server action del frontend (`lib/actions/users.ts`) que
usaba la clave de servicio de Supabase sin verificar quién llamaba: una server
action es un POST público, así que proteger la página no la protegía. Ahora
pasan por acá con `require_admin`, y el que crea no puede dar un rol igual o
superior al propio.

Se sobreescribe `get_current_user` (no `require_admin`): así el test ejerce la
regla de rol de verdad, no la salta.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.db import get_pool
from app.routers.users import router

ADMIN = {"sub": "a-1", "email": "admin@webcarga.com", "role": "admin", "aal": "aal2"}
VIEWER = {"sub": "v-1", "email": "viewer@webcarga.com", "role": "viewer"}


def _cliente(user, pool=None, supabase=None):
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
    return sb


def _pool_con_perfil():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "nuevo-1", "full_name": "Ana", "email": "ana@webcarga.com",
        "role": "viewer", "active": True, "created_at": None}
    return pool


ALTA = {"email": "Ana@WebCarga.com", "full_name": "Ana", "role": "viewer"}


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


def test_un_admin_no_puede_crear_otro_admin():
    sb = _supabase_que_crea()
    res = _cliente(ADMIN, supabase=sb).post("/api/v1/users", json={**ALTA, "role": "admin"})
    assert res.status_code == 403
    sb.auth.admin.create_user.assert_not_called()


def test_un_admin_crea_e_invita_con_el_rol_pedido():
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    res = _cliente(ADMIN, pool=pool, supabase=sb).post("/api/v1/users", json=ALTA)

    assert res.status_code == 201
    # La invitación (quién puede entrar y con qué rol) se escribe ANTES de crear
    # la cuenta: el alta en Auth dispara handle_new_user, que lee el rol de ahí.
    invitacion = pool.execute.call_args_list[0]
    assert "admin_whitelist" in invitacion.args[0]
    assert "ana@webcarga.com" in invitacion.args and "viewer" in invitacion.args
    creado = sb.auth.admin.create_user.call_args.args[0]
    assert creado["email"] == "ana@webcarga.com"
    assert creado["email_confirm"] is True
    assert "password" not in creado


def test_con_contrasena_la_pasa_a_auth():
    sb, pool = _supabase_que_crea(), _pool_con_perfil()
    res = _cliente(ADMIN, pool=pool, supabase=sb).post(
        "/api/v1/users", json={**ALTA, "password": "una-clave-larga-y-segura"})
    assert res.status_code == 201
    assert sb.auth.admin.create_user.call_args.args[0]["password"] == "una-clave-larga-y-segura"


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


def test_un_admin_no_borra_a_un_owner():
    sb, pool = MagicMock(), AsyncMock()
    pool.fetchrow.return_value = {"role": "owner", "email": "duena@webcarga.com"}
    res = _cliente(ADMIN, pool=pool, supabase=sb).delete("/api/v1/users/o-1")
    assert res.status_code == 403
    sb.auth.admin.delete_user.assert_not_called()


def test_un_admin_borra_y_retira_la_invitacion():
    sb, pool = MagicMock(), AsyncMock()
    pool.fetchrow.return_value = {"role": "viewer", "email": "ana@webcarga.com"}
    res = _cliente(ADMIN, pool=pool, supabase=sb).delete("/api/v1/users/u-1")
    assert res.status_code == 204
    sb.auth.admin.delete_user.assert_called_once_with("u-1")
    assert any("DELETE FROM public.admin_whitelist" in c.args[0] for c in pool.execute.call_args_list)
