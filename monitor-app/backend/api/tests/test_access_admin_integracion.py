# tests/test_access_admin_integracion.py
import pytest

from app.authz.sync import sync_catalog
from app.services.access_admin import AccessError, create_role, delete_role, set_user_roles
from tests.conftest import usuario

pytestmark = pytest.mark.integracion


async def _perfiles(conn, n):
    return [str(r["id"]) for r in await conn.fetch("SELECT id FROM public.profiles ORDER BY created_at LIMIT $1", n)]


async def _solo_propietario(conn, uid):
    await conn.execute("DELETE FROM app.user_roles WHERE role_id = (SELECT id FROM app.roles WHERE code='owner')")
    await conn.execute("INSERT INTO app.user_roles (user_id, role_id) SELECT $1, id FROM app.roles WHERE code='owner'", uid)


async def test_no_queda_cero_propietarios(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    (uid,) = await _perfiles(conn, 1)
    await _solo_propietario(conn, uid)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("owner", sub=uid), uid, ["reader"])
    assert err.value.status == 409


async def test_admin_no_escala(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("admin", sub=a), b, ["operations_supervisor"])
    assert err.value.status == 403


async def test_admin_no_nombra_propietario(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("admin", sub=a), b, ["owner"])
    assert err.value.status == 403


async def test_propietario_asigna_y_queda_auditado(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await set_user_roles(conn, usuario("owner", sub=a), b, ["certification_operator", "reader"])
    codigos = {r["code"] for r in await conn.fetch(
        "SELECT r.code FROM app.user_roles ur JOIN app.roles r ON r.id = ur.role_id WHERE ur.user_id = $1", b)}
    assert codigos == {"certification_operator", "reader"}
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'USER_ROLE' AND entity_id = $1::uuid", b) >= 1


async def test_rol_de_sistema_inmutable_y_rol_en_uso_no_se_borra(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    actor = usuario("owner", sub=a)
    sistema = await conn.fetchval("SELECT id::text FROM app.roles WHERE code = 'reader'")
    with pytest.raises(AccessError) as err:
        await delete_role(conn, actor, sistema)
    assert err.value.status == 409
    rol = await create_role(conn, actor, "custom_lectura_ops", "Lectura de Operaciones", "", ["operations.read"])
    await set_user_roles(conn, actor, b, ["custom_lectura_ops"])
    with pytest.raises(AccessError) as err:
        await delete_role(conn, actor, rol["id"])
    assert err.value.status == 409


async def test_assert_can_grant_frena_la_escalada_antes_de_invitar(conexion_revertida):
    from app.services.access_admin import assert_can_grant
    conn = conexion_revertida
    await sync_catalog(conn)
    (a,) = await _perfiles(conn, 1)
    with pytest.raises(AccessError) as err:
        await assert_can_grant(conn, usuario("certification_supervisor", sub=a), ["operations_supervisor"])
    assert err.value.status == 403
    await assert_can_grant(conn, usuario("certification_supervisor", sub=a), ["certification_operator"])
    with pytest.raises(AccessError) as err:
        await assert_can_grant(conn, usuario("owner", sub=a), ["no_existe"])
    assert err.value.status == 422


async def test_no_se_desactiva_al_ultimo_propietario(conexion_revertida):
    from app.services.access_admin import assert_can_manage_user
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await _solo_propietario(conn, b)
    with pytest.raises(AccessError) as err:
        await assert_can_manage_user(conn, usuario("owner", sub=a), b, deactivating=True)
    assert err.value.status == 409
    with pytest.raises(AccessError) as err:
        await assert_can_manage_user(conn, usuario("admin", sub=a), b, deactivating=False)
    assert err.value.status == 403
