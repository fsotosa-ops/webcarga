"""Directorio › Clientes (Configuración, Parte 3) contra Postgres de verdad: los
conteos de la lista salen de los datos que crea el test, y editar un cliente
audita sin tocar sus lugares ni sus vínculos."""
import uuid
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.routers.shippers import ShipperPatchBody, _detalle, patch_shipper
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba

pytestmark = pytest.mark.integracion


async def _cliente_con_todo(conn) -> str:
    """Un cliente con dos lugares (uno origen), una empresa, un nombre del TMS y un viaje reciente."""
    nombre = await cliente_de_prueba(conn)
    sid = await conn.fetchval("SELECT id::text FROM public.shippers WHERE name = $1", nombre)
    for i, origen in enumerate((True, False)):
        await conn.execute(
            "INSERT INTO public.locations (entity_type, entity_id, name, is_origin) VALUES ('SHIPPER', $1::uuid, $2, $3)",
            sid, f"ZZ-LUGAR-{i}", origen)
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"ZZ-EMPRESA-{uuid.uuid4().hex[:6]}")
    await conn.execute("INSERT INTO public.carrier_shippers (carrier_id, shipper_id) VALUES ($1, $2::uuid)", carrier, sid)
    source = await conn.fetchval(
        "INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id) "
        "VALUES (gen_random_uuid(), 'qanalytics', 'zz-cliente', $1::uuid) RETURNING source_client_id", sid)
    hoy = await conn.fetchval("SELECT public.hoy_chile()")
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned, shipper_id, source_client_id) "
        "VALUES ($1, $2, $3, 'qanalytics', $4, 'RUTA', false, true, $5::uuid, $6)",
        uuid.uuid4(), hoy - timedelta(days=2), nombre, f"ZZSH-{uuid.uuid4().hex[:6]}", sid, source)
    return sid


async def test_los_conteos_del_cliente_salen_de_sus_datos(conexion_revertida):
    sid = await _cliente_con_todo(conexion_revertida)
    fila = await _detalle(conexion_revertida, sid)
    assert (fila["tms_names"], fila["locations"], fila["origins"], fila["carriers"], fila["trips_30d"]) == (1, 2, 1, 1, 1)


async def test_los_lugares_cuentan_tambien_los_inactivos_como_la_tabla(conexion_revertida):
    """La pestaña Lugares lista activos e inactivos: su cifra cuenta lo mismo."""
    sid = await _cliente_con_todo(conexion_revertida)
    await conexion_revertida.execute(
        "INSERT INTO public.locations (entity_type, entity_id, name, operational_status) VALUES ('SHIPPER', $1::uuid, 'ZZ-INACTIVO', 'INACTIVE')",
        sid)
    assert (await _detalle(conexion_revertida, sid))["locations"] == 3


async def test_desactivar_y_renombrar_audita_y_no_borra_nada(conexion_revertida):
    sid = await _cliente_con_todo(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    nuevo = f"TEST-{uuid.uuid4().hex[:8]}"
    fila = await patch_shipper(uuid.UUID(sid), ShipperPatchBody(name=nuevo, status="INACTIVE"),
                               pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert (fila["name"], fila["status"], fila["locations"], fila["tms_names"]) == (nuevo, "INACTIVE", 2, 1)
    campos = await conexion_revertida.fetch(
        "SELECT field FROM public.audit_log WHERE entity_type = 'SHIPPER' AND entity_id = $1::uuid ORDER BY field", sid)
    assert [c["field"] for c in campos] == ["name", "status"]


async def test_renombrar_con_otra_capitalizacion_de_un_nombre_existente_es_409(conexion_revertida):
    sid = await _cliente_con_todo(conexion_revertida)
    otro = await cliente_de_prueba(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    with pytest.raises(HTTPException) as e:
        await patch_shipper(uuid.UUID(sid), ShipperPatchBody(name=f" {otro.lower()} "),
                            pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert e.value.status_code == 409


async def test_las_empresas_de_un_cliente_son_las_de_vinculo_activo(conexion_revertida):
    from app.routers.carriers import list_carriers
    sid = await _cliente_con_todo(conexion_revertida)
    terminada = await conexion_revertida.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"ZZ-EX-{uuid.uuid4().hex[:6]}")
    await conexion_revertida.execute(
        "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) VALUES ($1, $2::uuid, 'INACTIVE')",
        terminada, sid)
    res = await list_carriers(q="", operational_status="", enablement="", shipper_id=uuid.UUID(sid), page=1, limit=50,
                              pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert [c["business_name"][:11] for c in res["data"]] == ["ZZ-EMPRESA-"]
    assert res["facets"]["total"] == 1


async def test_los_nombres_del_tms_se_filtran_por_cliente_y_sin_vincular(conexion_revertida):
    from app.routers.tms_clients import listar
    sid = await _cliente_con_todo(conexion_revertida)
    pool = PoolDeUnaConexion(conexion_revertida)
    del_cliente = await listar(shipper_id=uuid.UUID(sid), unlinked=False, pool=pool, _=None)
    assert [(f["source_client"], f["trips"]) for f in del_cliente] == [("zz-cliente", 1)]
    sin_vincular = await listar(shipper_id=None, unlinked=True, pool=pool, _=None)
    assert all(f["shipper_id"] is None for f in sin_vincular)
    todos = await listar(shipper_id=None, unlinked=False, pool=pool, _=None)
    assert len(todos) > len(sin_vincular)


async def test_renombrar_un_cliente_no_corta_el_alta_de_sus_lugares(conexion_revertida):
    """Revisión final de la Parte 3: el trigger que registra los lugares de las
    paradas buscaba al cliente por el NOMBRE que manda el TMS. Renombrar el
    cliente en la ficha cortaba el alta en silencio. Se resuelve por el id del
    viaje, como el resto del modelo (spec 2026-10-11)."""
    sid = await _cliente_con_todo(conexion_revertida)
    trip_id = await conexion_revertida.fetchval(
        "SELECT id FROM app.trips WHERE shipper_id = $1::uuid LIMIT 1", sid)
    await conexion_revertida.execute("UPDATE public.shippers SET name = $2 WHERE id = $1::uuid",
                                     sid, f"TEST-{uuid.uuid4().hex[:8]} renombrado")
    await conexion_revertida.execute(
        "INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, local) VALUES ($1, $2, 9, 'DESTINATION', 'ZZ-LOCAL-NUEVO')",
        f"ZZSTOP-{uuid.uuid4().hex[:6]}", trip_id)
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.locations WHERE entity_type = 'SHIPPER' AND entity_id = $1::uuid AND name = 'ZZ-LOCAL-NUEVO'",
        sid) == 1


# ── Tipos de operación del cliente (plan 2026-10-21) ────────────────────────────

async def test_operaciones_declara_los_tipos_del_cliente_y_queda_auditado(conexion_revertida):
    from tests.conftest import con_roles
    sid = await _cliente_con_todo(conexion_revertida)
    usuario = con_roles(await _usuario_real(conexion_revertida), "operations_supervisor")
    pool = PoolDeUnaConexion(conexion_revertida)

    fila = await patch_shipper(uuid.UUID(sid), ShipperPatchBody(operation_types=["EQUIPO_COMPLETO", "TRACTOREO"]),
                               pool=pool, user=usuario)
    assert fila["operation_types"] == ["TRACTOREO", "EQUIPO_COMPLETO"]   # orden canónico
    fila = await patch_shipper(uuid.UUID(sid), ShipperPatchBody(operation_types=None), pool=pool, user=usuario)
    assert fila["operation_types"] is None                              # null explícito = sin definir
    campos = await conexion_revertida.fetch(
        "SELECT field FROM public.audit_log WHERE entity_type = 'SHIPPER' AND entity_id = $1::uuid", sid)
    assert [c["field"] for c in campos] == ["operation_types", "operation_types"]


async def test_comercial_no_cambia_los_tipos_y_operaciones_no_renombra(conexion_revertida):
    """Los tipos deciden el alcance en el Cierre: son de Operaciones (operations.configure);
    el nombre y el estado siguen siendo de Comercial (commercial.edit)."""
    from tests.conftest import con_roles
    sid = await _cliente_con_todo(conexion_revertida)
    base = await _usuario_real(conexion_revertida)
    pool = PoolDeUnaConexion(conexion_revertida)
    with pytest.raises(HTTPException) as exc:
        await patch_shipper(uuid.UUID(sid), ShipperPatchBody(operation_types=["EQUIPO_COMPLETO"]),
                            pool=pool, user=con_roles(base, "commercial_supervisor"))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await patch_shipper(uuid.UUID(sid), ShipperPatchBody(name="Otro"),
                            pool=pool, user=con_roles(base, "operations_supervisor"))
    assert exc.value.status_code == 403
