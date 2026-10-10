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
    # El sujeto lo arma el test: con datos reales, b ya podía tener el rol, y
    # conservarlo no es escalar (menor 7).
    await set_user_roles(conn, usuario("owner", sub=a), b, ["reader"])
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


# ── Último Propietario en carrera (revisión final RBAC, hallazgo 2) ──────────
# Dos Propietarios que se desactivan uno al otro a la vez: sin un candado que
# dure hasta el UPDATE, los dos chequeos ven al otro activo y quedan cero. Todo
# lo que toca Propietarios toma el mismo advisory lock transaccional.

async def _candado_tomado(conn) -> bool:
    from app.services.access_admin import LLAVE_PROPIETARIOS
    return await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid() "
        "AND granted AND ((classid::bigint << 32) | objid::bigint) = $1)", LLAVE_PROPIETARIOS)


async def test_gestionar_persona_toma_el_candado_de_propietarios(conexion_revertida):
    from app.services.access_admin import assert_can_manage_user
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await assert_can_manage_user(conn, usuario("owner", sub=a), b, deactivating=False)
    assert await _candado_tomado(conn)


async def test_cambiar_roles_toma_el_candado_de_propietarios(conexion_revertida):
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await set_user_roles(conn, usuario("owner", sub=a), b, ["reader"])
    assert await _candado_tomado(conn)


async def test_retirar_al_penultimo_propietario_lo_desactiva_y_el_ultimo_queda_protegido(conexion_revertida):
    from app.services.access_admin import retirar_persona
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await _solo_propietario(conn, a)
    await conn.execute("INSERT INTO app.user_roles (user_id, role_id) SELECT $1, id FROM app.roles WHERE code='owner'", b)
    await retirar_persona(conn, usuario("owner", sub=a), b)
    assert await conn.fetchval("SELECT active FROM public.profiles WHERE id = $1", b) is False
    with pytest.raises(AccessError) as err:
        await retirar_persona(conn, usuario("owner", sub=b), a)
    assert err.value.status == 409


# Menores 5 y 7 de la revisión final RBAC.
async def test_poner_roles_a_alguien_que_no_existe_es_404(conexion_revertida):
    import uuid
    conn = conexion_revertida
    await sync_catalog(conn)
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, usuario("owner"), str(uuid.uuid4()), ["reader"])
    assert err.value.status == 404


async def test_conservar_un_rol_que_el_actor_no_podria_dar_no_es_escalar(conexion_revertida):
    """Administración no tiene documents.review: no puede DAR Supervisor de
    Certificación, pero sí cambiarle otro rol a quien ya lo tiene."""
    conn = conexion_revertida
    await sync_catalog(conn)
    a, b = await _perfiles(conn, 2)
    await set_user_roles(conn, usuario("owner", sub=a), b, ["certification_supervisor"])
    admin = usuario("admin", sub=a)
    assert await set_user_roles(conn, admin, b, ["certification_supervisor", "reader"]) == \
        ["certification_supervisor", "reader"]
    with pytest.raises(AccessError) as err:
        await set_user_roles(conn, admin, b, ["certification_supervisor", "reader", "insurance_supervisor"])
    assert err.value.status == 403
