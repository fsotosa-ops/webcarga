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
