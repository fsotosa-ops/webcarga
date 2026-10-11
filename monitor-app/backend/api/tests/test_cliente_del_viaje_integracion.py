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
