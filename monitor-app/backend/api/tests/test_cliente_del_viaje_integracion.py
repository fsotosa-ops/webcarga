"""El cliente del viaje por ID (spec 2026-10-11), contra Postgres de verdad. Lo
que se fija es el modelo: el directorio no admite dos nombres que solo difieran
en mayúsculas, la correspondencia existe para cada cliente del TMS con viajes, y
el viaje manual apunta al directorio."""
import asyncpg
import pytest

pytestmark = pytest.mark.integracion


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
    from app.routers.trips import list_trips
    from tests.conftest import PoolDeUnaConexion, _usuario_real

    colun = await conexion_revertida.fetchval("SELECT id::text FROM public.shippers WHERE lower(name) = 'colun'")
    await conexion_revertida.execute("UPDATE public.shippers SET name = 'Colun Renombrada' WHERE id = $1::uuid", colun)
    usuario = await _usuario_real(conexion_revertida)
    res = await list_trips(pool=PoolDeUnaConexion(conexion_revertida), user=usuario, shipper_id=colun, view="historial", limit=5)
    assert res["count"] > 0
    assert {d["client_name"] for d in res["data"]} == {"Colun Renombrada"}
