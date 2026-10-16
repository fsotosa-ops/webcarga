"""El cliente del viaje por ID (spec 2026-10-11), contra Postgres de verdad. Lo
que se fija es el modelo: el directorio no admite dos nombres que solo difieran
en mayúsculas, la correspondencia existe para cada cliente del TMS con viajes, y
el viaje manual apunta al directorio."""
from uuid import UUID

import asyncpg
import pytest

pytestmark = pytest.mark.integracion


async def _cliente(conn) -> str:
    """El id de un cliente del directorio creado por el test (conftest.cliente_de_prueba)."""
    from tests.conftest import cliente_de_prueba
    nombre = await cliente_de_prueba(conn)
    return await conn.fetchval("SELECT id::text FROM public.shippers WHERE name = $1", nombre)


async def _correspondencia(conn, shipper_id: str, source_client: str = "zz-cliente-tms") -> str:
    """Un cliente del TMS (qanalytics) que corresponde a `shipper_id`, con un viaje; devuelve su source_client_id.
    Lo crea el test: elegirlo de la base hacía depender el resultado de qué clientes había."""
    import uuid
    from datetime import date
    source_client_id = await conn.fetchval(
        "INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id) "
        "VALUES (gen_random_uuid(), 'qanalytics', $1, $2::uuid) RETURNING source_client_id::text",
        source_client, shipper_id)
    # Un cliente del TMS existe porque tiene viajes (re-vincular sin viajes da 404).
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned, shipper_id, source_client_id) "
        "VALUES ($1, $2, $3, 'qanalytics', $4, 'RUTA', false, true, $5::uuid, $6::uuid)",
        uuid.uuid4(), date(2099, 3, 3), source_client, f"ZZTMS-{uuid.uuid4().hex[:6]}", shipper_id, source_client_id)
    return source_client_id


async def test_el_directorio_no_admite_el_mismo_nombre_con_otra_capitalizacion(conexion_revertida):
    nombre = await conexion_revertida.fetchval("SELECT name FROM public.shippers WHERE status = 'ACTIVE' LIMIT 1")
    with pytest.raises(asyncpg.UniqueViolationError):
        await conexion_revertida.execute(
            "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE')", f"  {nombre.upper()} ")


async def test_cada_cliente_del_tms_con_viajes_tiene_correspondencia(conexion_revertida):
    sin_correspondencia = await conexion_revertida.fetchval("""
        SELECT count(DISTINCT t.source_client_id) FROM app.trips t
        WHERE t.source_client_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM app.tms_client_shippers m WHERE m.source_client_id = t.source_client_id)
    """)
    assert sin_correspondencia == 0


async def test_la_correspondencia_apunta_al_directorio(conexion_revertida):
    with pytest.raises(asyncpg.ForeignKeyViolationError):
        await conexion_revertida.execute("""
            INSERT INTO app.tms_client_shippers (source_client_id, source_system, source_client, shipper_id)
            VALUES (gen_random_uuid(), 'qanalytics', 'zz-prueba', gen_random_uuid())
        """)


async def test_los_viajes_manuales_vigentes_con_cliente_del_directorio_tienen_su_id(conexion_revertida):
    sin_id = await conexion_revertida.fetchval("""
        SELECT count(*) FROM app.trips_manual m
        JOIN public.shippers sh ON lower(btrim(sh.name)) = lower(btrim(m.client_name))
        WHERE m.shipper_id IS NULL
    """)
    assert sin_id == 0


async def test_el_alta_manual_guarda_el_id_y_el_nombre_del_directorio(conexion_revertida):
    """El CSV trae "  IANSA "; queda el id de Iansa y el nombre del directorio,
    que es el que entra al id canónico del viaje."""
    from datetime import date

    from app.routers.trips import TripCreateBody, _insert_trip
    from tests.conftest import _usuario_real

    usuario = await _usuario_real(conexion_revertida)
    iansa = await conexion_revertida.fetchrow("SELECT id::text, name FROM public.shippers WHERE lower(name) = 'iansa'")
    body = TripCreateBody(planning_date=date(2099, 1, 2), client_name="  IANSA ", source_system_trip_id="ZZ-CLI-1")
    trip_id = await _insert_trip(conexion_revertida, body, usuario, valid_statuses=set())
    fila = await conexion_revertida.fetchrow(
        "SELECT shipper_id::text, client_name FROM app.trips_manual WHERE id = $1", trip_id)
    assert (fila["shipper_id"], fila["client_name"]) == (iansa["id"], iansa["name"])


async def test_renombrar_un_cliente_no_saca_sus_viajes_del_monitor(conexion_revertida):
    """El caso que motivó todo: con el cruce por texto, renombrar "Colun" dejaba
    sus viajes sin cliente."""
    import uuid
    from datetime import date

    from app.routers.trips import list_trips
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    conn = conexion_revertida
    cliente = await _cliente(conn)
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system_trip_id, trip_status, "
        "is_active, is_assigned, shipper_id) VALUES ($1, $2, 'x', $3, 'RUTA', false, true, $4::uuid)",
        uuid.uuid4(), date(2099, 3, 2), f"ZZREN-{uuid.uuid4().hex[:6]}", cliente)
    await conn.execute("UPDATE public.shippers SET name = 'Cliente Renombrado' WHERE id = $1::uuid", cliente)
    usuario = await _usuario_real(conn)
    res = await list_trips(pool=PoolDeUnaConexion(conn), user=usuario, shipper_id=cliente, view="historial", limit=5)
    assert res["count"] > 0
    assert {d["client_name"] for d in res["data"]} == {"Cliente Renombrado"}


async def test_vincular_un_cliente_del_tms_escribe_la_correspondencia(conexion_revertida):
    from app.routers.tms_clients import VinculoBody, vincular
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    origen = await _correspondencia(conexion_revertida, await _cliente(conexion_revertida))
    otro = await _cliente(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    res = await vincular(UUID(origen), VinculoBody(shipper_id=otro), pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert res["shipper_id"] == otro


async def test_renombrar_el_cliente_no_cambia_el_id_canonico_del_viaje_manual(conexion_revertida):
    """Revisión final, Importante 1: el id de un viaje manual de un TMS integrado
    debe calzar con el que ese TMS va a reportar (md5(tms|texto del TMS|nº)). El
    texto del TMS sale de la correspondencia, no del nombre del directorio: si
    se usara el nombre, renombrar "Walmart" duplicaría los viajes."""
    import hashlib
    from datetime import date
    from uuid import UUID

    from app.routers.trips import TripCreateBody, _insert_trip
    from tests.conftest import _usuario_real

    cliente = await _cliente(conexion_revertida)
    await _correspondencia(conexion_revertida, cliente, "zz-cliente-tms")
    await conexion_revertida.execute("UPDATE public.shippers SET name = 'Cliente Renombrado' WHERE id = $1::uuid", cliente)
    usuario = await _usuario_real(conexion_revertida)
    body = TripCreateBody(planning_date=date(2099, 1, 5), origin_tms="qanalytics", shipper_id=cliente,
                          source_system_trip_id="ZZ-REN-1")
    trip_id = await _insert_trip(conexion_revertida, body, usuario, valid_statuses=set())
    esperado = str(UUID(hashlib.md5(b"qanalytics|zz-cliente-tms|ZZ-REN-1").hexdigest()))
    assert trip_id == esperado
    fila = await conexion_revertida.fetchrow(
        "SELECT client_name, shipper_id::text FROM app.trips_manual WHERE id = $1", trip_id)
    assert (fila["client_name"], fila["shipper_id"]) == ("zz-cliente-tms", cliente)


async def test_el_csv_marca_todas_las_filas_con_cliente_fuera_del_directorio(conexion_revertida):
    """Revisión final, Importante 2: el CSV se valida entero antes de escribir, y
    cada fila con un cliente que no está en el directorio queda marcada (no solo
    la primera que falla al guardar)."""
    from datetime import date

    from fastapi import HTTPException

    from app.routers.trips import TripCreateBody, bulk_create_trips
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    usuario = await _usuario_real(conexion_revertida)
    filas = [
        TripCreateBody(planning_date=date(2099, 1, 6), client_name="WALMART", source_system_trip_id="ZZ-CSV-1"),
        TripCreateBody(planning_date=date(2099, 1, 6), client_name="No Existe SpA", source_system_trip_id="ZZ-CSV-2"),
        TripCreateBody(planning_date=date(2099, 1, 6), client_name="Tampoco Existe", source_system_trip_id="ZZ-CSV-3"),
    ]
    with pytest.raises(HTTPException) as e:
        await bulk_create_trips(filas, pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert e.value.status_code == 422
    assert e.value.detail["errors"] == [
        {"row": 2, "error": "El cliente «No Existe SpA» no está en el directorio"},
        {"row": 3, "error": "El cliente «Tampoco Existe» no está en el directorio"},
    ]


def test_la_plantilla_csv_exige_el_cliente():
    from app.routers.trips import _CSV_COLUMNS
    assert next(c for c in _CSV_COLUMNS if c["field"] == "client_name")["required"] is True


async def test_cambiar_un_vinculo_queda_registrado_con_quien_y_desde_que_cliente(conexion_revertida):
    """Revisión final, Importante 5: re-vincular mueve miles de viajes; queda
    quién lo hizo, desde qué cliente y a cuál."""
    from app.routers.tms_clients import VinculoBody, vincular
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    antes = await _cliente(conexion_revertida)
    fila = {"id": await _correspondencia(conexion_revertida, antes), "antes": antes}
    otro = await _cliente(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    await vincular(UUID(fila["id"]), VinculoBody(shipper_id=otro), pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    registro = await conexion_revertida.fetchrow(
        "SELECT actor::text, action, field, old_value, new_value FROM public.audit_log "
        "WHERE entity_type = 'TMS_CLIENT' AND entity_id = $1::uuid ORDER BY occurred_at DESC LIMIT 1", fila["id"])
    assert registro is not None
    assert (registro["actor"], registro["action"], registro["field"]) == (usuario["sub"], "link_tms_client", "shipper_id")
    assert fila["antes"] in str(registro["old_value"]) and otro in str(registro["new_value"])


async def test_los_clientes_del_filtro_son_los_de_la_vista_con_su_cuenta(conexion_revertida):
    """El Monitor mostraba HBC y "Sin cliente vinculado" porque las opciones
    salían de todo el histórico. Ahora salen de los viajes de la vista (en curso
    o el rango del historial), con su cuenta, y sin aplicar el propio filtro de
    cliente: elegir Walmart no hace desaparecer a los demás."""
    import uuid
    from datetime import date

    from app.routers.trips import list_trips
    from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba

    conn = conexion_revertida
    activo, cerrado = await cliente_de_prueba(conn), await cliente_de_prueba(conn)
    ids = {n: await conn.fetchval("SELECT id::text FROM public.shippers WHERE name = $1", n) for n in (activo, cerrado)}

    async def viaje(shipper_id, is_active):
        await conn.execute(
            "INSERT INTO app.trips (id, planning_date, client_name, source_system_trip_id, trip_status, "
            "is_active, is_assigned, shipper_id) VALUES ($1, $2, 'x', $3, 'RUTA', $4, true, $5::uuid)",
            uuid.uuid4(), date(2099, 3, 1), f"ZZFACET-{uuid.uuid4().hex[:6]}", is_active, shipper_id)

    await viaje(ids[activo], True)
    await viaje(ids[activo], True)
    await viaje(ids[cerrado], False)
    await viaje(None, True)

    usuario = await _usuario_real(conn)
    pool = PoolDeUnaConexion(conn)
    en_curso = await list_trips(q="ZZFACET", is_active="true", pool=pool, user=usuario)
    assert en_curso["clients"] == [
        {"id": ids[activo], "name": activo, "count": 2},
        {"id": "unlinked", "name": "Sin cliente vinculado", "count": 1},
    ]

    # Con un cliente elegido, las opciones no cambian: el filtro no se filtra a sí mismo.
    elegido = await list_trips(q="ZZFACET", is_active="true", shipper_id=ids[activo], pool=pool, user=usuario)
    assert elegido["count"] == 2
    assert elegido["clients"] == en_curso["clients"]

    historial = await list_trips(q="ZZFACET", view="historial", fecha_desde="2099-03-01", fecha_hasta="2099-03-01",
                                 pool=pool, user=usuario)
    assert {c["id"]: c["count"] for c in historial["clients"]} == {ids[activo]: 2, ids[cerrado]: 1, "unlinked": 1}
