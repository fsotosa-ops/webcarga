"""La ventana de "En curso" del Monitor (decisión del usuario 11/10).

Un viaje activo sale de "En curso" cuando lleva más de `in_progress_idle_days`
días sin movimiento (Configuración › Alertas del Monitor, 3 por defecto). El
movimiento es la llegada o salida más reciente en sus paradas; si nunca tuvo
(Sodimac y los manuales no registran horas), cuenta su fecha de planificación.
Así un viaje largo no se oculta mientras avanza, y los que el TMS dejó abiertos
salen solos. Siguen activos: se ven en el Historial y en el Cierre."""
import uuid
from datetime import timedelta

import pytest

from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

PREFIJO = "ZZVENTANA"


async def _viaje(conn, nombre: str, *, dias_desde_planificacion: int | None, dias_desde_movimiento: int | None = None) -> str:
    hoy = await conn.fetchval("SELECT public.hoy_chile()")
    fecha = None if dias_desde_planificacion is None else hoy - timedelta(days=dias_desde_planificacion)
    trip_id, codigo = uuid.uuid4(), f"{PREFIJO}-{nombre}-{uuid.uuid4().hex[:6]}"
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system_trip_id, trip_status, "
        "is_active, is_assigned) VALUES ($1, $2, 'x', $3, 'RUTA', true, true)",
        trip_id, fecha, codigo)
    if dias_desde_movimiento is not None:
        await conn.execute(
            "INSERT INTO app.trip_stops (stop_id, trip_id, stop_type, stop_order, local, gps_arrival_date) "
            "VALUES ($1, $2, 'DESTINATION', 1, 'Destino', now() - make_interval(days => $3))",
            f"{codigo}-d", trip_id, dias_desde_movimiento)
    return codigo


async def _en_curso(conn, **filtros):
    from app.routers.trips import list_trips
    return await list_trips(view="en_curso", is_active="true", q=PREFIJO,
                            pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn), **filtros)


async def test_sin_movimiento_cuenta_la_fecha_de_planificacion(conexion_revertida):
    conn = conexion_revertida
    await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 3 WHERE id = 1")
    hoy = await _viaje(conn, "hoy", dias_desde_planificacion=0)
    hace_3 = await _viaje(conn, "hace_3", dias_desde_planificacion=3)
    await _viaje(conn, "hace_4", dias_desde_planificacion=4)
    await _viaje(conn, "sin_fecha", dias_desde_planificacion=None)

    res = await _en_curso(conn)
    assert {d["source_system_trip_id"] for d in res["data"]} == {hoy, hace_3}
    # Lo que queda fuera se cuenta, para decirlo al pie. Sin fecha ni
    # movimiento no se puede ubicar: cuenta como fuera.
    assert res["outside_window_count"] == 2


async def test_un_viaje_largo_que_sigue_moviendose_no_sale(conexion_revertida):
    """Un viaje a regiones planificado hace 6 días con una llegada de ayer sigue
    en curso; uno planificado ayer que se movió por última vez hace 5 días, no."""
    conn = conexion_revertida
    await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 3 WHERE id = 1")
    largo = await _viaje(conn, "largo", dias_desde_planificacion=6, dias_desde_movimiento=1)
    await _viaje(conn, "detenido", dias_desde_planificacion=1, dias_desde_movimiento=5)

    res = await _en_curso(conn)
    assert {d["source_system_trip_id"] for d in res["data"]} == {largo}
    assert res["outside_window_count"] == 1


async def test_los_dias_son_configurables(conexion_revertida):
    conn = conexion_revertida
    await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 5 WHERE id = 1")
    hace_4 = await _viaje(conn, "hace_4", dias_desde_planificacion=4)
    await _viaje(conn, "hace_6", dias_desde_planificacion=6)

    res = await _en_curso(conn)
    assert {d["source_system_trip_id"] for d in res["data"]} == {hace_4}
    assert res["outside_window_count"] == 1


async def test_el_aviso_respeta_los_demas_filtros(conexion_revertida):
    """El pie dice cuántos quedan fuera DE LO QUE SE ESTÁ MIRANDO: con un cliente
    elegido, solo los de ese cliente."""
    from tests.conftest import cliente_de_prueba

    conn = conexion_revertida
    await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 3 WHERE id = 1")
    viejo = await _viaje(conn, "viejo", dias_desde_planificacion=9)
    otro = await _viaje(conn, "otro", dias_desde_planificacion=9)
    nombre = await cliente_de_prueba(conn)
    shipper = await conn.fetchval("SELECT id::text FROM public.shippers WHERE name = $1", nombre)
    await conn.execute("UPDATE app.trips SET shipper_id = $1::uuid WHERE source_system_trip_id = $2", shipper, viejo)
    assert otro

    res = await _en_curso(conn, shipper_id=shipper)
    assert res["count"] == 0
    assert res["outside_window_count"] == 1


async def test_el_historial_no_tiene_ventana(conexion_revertida):
    from app.routers.trips import list_trips

    conn = conexion_revertida
    await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 3 WHERE id = 1")
    codigos = {await _viaje(conn, "hoy", dias_desde_planificacion=0),
               await _viaje(conn, "hace_9", dias_desde_planificacion=9)}

    res = await list_trips(view="historial", is_active="true", q=PREFIJO,
                           pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    assert {d["source_system_trip_id"] for d in res["data"]} == codigos
    assert "outside_window_count" not in res


async def test_la_columna_tiene_3_por_defecto_y_no_acepta_cero(conexion_revertida):
    import asyncpg

    conn = conexion_revertida
    default = await conn.fetchval(
        "SELECT column_default FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name = 'monitor_alert_rules' AND column_name = 'in_progress_idle_days'")
    assert default == "3"
    with pytest.raises(asyncpg.CheckViolationError):
        await conn.execute("UPDATE app.monitor_alert_rules SET in_progress_idle_days = 0 WHERE id = 1")
