"""El CD en la línea del cierre, contra Postgres de verdad (HU-28, ola 3).

Lo que se fija acá es la propiedad que justifica toda la decisión de
arquitectura: **cambiar el CD base de un conductor no puede mover un día ya
firmado**. Si la asistencia por CD se resolviera con un join en tiempo de
lectura, esa propiedad no existiría — y es exactamente el defecto que
status_report.py tiene hoy, reescribiendo el pasado en cada viaje nuevo.
"""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.daily_closures import _DETAIL_SQL
from app.routers.equipment_closures import _DETAIL_SQL as _DETAIL_TRACTOS_SQL
from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-11")
TRACTOREO_ID = "89822208-0189-463a-93a0-605fb570c71b"
PREFIJO = "ZZ-TEST-CIERRE-CD"


async def _cd(conn, nombre="CD EL PEÑON"):
    shipper = await conn.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} {uuid.uuid4().hex[:8]}")
    return await conn.fetchval(
        "INSERT INTO public.locations (entity_type, entity_id, name, operational_status, is_origin_cd) "
        "VALUES ('SHIPPER', $1, $2, 'ACTIVE', true) RETURNING id",
        shipper, f"{PREFIJO} {nombre}")


async def _escenario(conn, *, cd_id=None):
    """Empresa ACTIVE + tracto Tractoreo + conductor con asignación activa y ese
    tracto como habitual — el mínimo para que entre al roster del cierre."""
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) "
        "VALUES ($1, 'ACTIVE') RETURNING id", f"{PREFIJO} Empresa")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", uuid.UUID(TRACTOREO_ID))
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        tractor, carrier)
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status, home_location_id) "
        "VALUES ($1, 'ACTIVE', $2) RETURNING id", f"{PREFIJO} Conductor", cd_id)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        conductor, carrier)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
        "VALUES ($1, $2, 'ACTIVE', 'manual', true)", tractor, conductor)
    return {"carrier": carrier, "tractor": tractor, "conductor": conductor}


async def _linea(conn, sujeto, tipo="DRIVER", dia=D):
    return await conn.fetchrow(
        "SELECT status, home_location_id FROM app.closure_lines "
        "WHERE business_date = $1 AND subject_type = $2 AND subject_id = $3",
        dia, tipo, sujeto)


async def test_la_linea_del_conductor_guarda_su_cd_base(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    cd = await _cd(conexion_revertida)
    esc = await _escenario(conexion_revertida, cd_id=cd)

    await cierre_lineas.recalcular(pool, D)

    fila = await _linea(conexion_revertida, esc["conductor"])
    assert fila is not None, "el conductor tiene que entrar al roster del cierre"
    assert fila["home_location_id"] == cd


async def test_el_tracto_hereda_el_cd_de_su_conductor_habitual(conexion_revertida):
    """Operaciones lo dijo así: el CD se le asigna a la persona, que puede
    cambiar de patente cuando queda en panne."""
    pool = PoolDeUnaConexion(conexion_revertida)
    cd = await _cd(conexion_revertida, "CD LO AGUIRRE")
    esc = await _escenario(conexion_revertida, cd_id=cd)

    await cierre_lineas.recalcular(pool, D)

    fila = await _linea(conexion_revertida, esc["tractor"], tipo="ASSET")
    assert fila is not None
    assert fila["home_location_id"] == cd


async def test_sin_cd_base_la_linea_queda_en_null_y_no_se_inventa_nada(conexion_revertida):
    pool = PoolDeUnaConexion(conexion_revertida)
    esc = await _escenario(conexion_revertida, cd_id=None)

    await cierre_lineas.recalcular(pool, D)

    fila = await _linea(conexion_revertida, esc["conductor"])
    assert fila is not None
    assert fila["home_location_id"] is None


async def test_un_dia_firmado_no_cambia_de_cd(conexion_revertida):
    """LA propiedad de la HU. Con la dimensión resuelta por join al leer, este
    test sería imposible de escribir."""
    pool = PoolDeUnaConexion(conexion_revertida)
    actor = await _usuario_real(conexion_revertida)
    cd_viejo = await _cd(conexion_revertida, "CD QUILICURA")
    cd_nuevo = await _cd(conexion_revertida, "CD PUERTO SANTIAGO 1")
    esc = await _escenario(conexion_revertida, cd_id=cd_viejo)

    await cierre_lineas.recalcular(pool, D)
    # Se le pone motivo para que el día pueda firmarse sin pendientes.
    await cierre_lineas.poner_motivo(
        pool, D, "DRIVER", [str(esc["conductor"])],
        campos={"unassigned_reason_id"},
        reason_id=await conexion_revertida.fetchval(
            "SELECT id FROM app.status_taxonomies WHERE domain = 'DRIVER_REASON' AND active LIMIT 1"),
        valid_until=None, comentario=None, user=actor,
    )
    # Forzar el cierre exige admin (ADMIN_ROLES); el perfil real viene como editor.
    admin = {**actor, "role": "admin"}
    await cierre_lineas.cerrar(pool, D, override=True, override_note="test", user=admin)

    # Ahora se le cambia el CD base al conductor.
    await conexion_revertida.execute(
        "UPDATE public.drivers SET home_location_id = $1 WHERE id = $2", cd_nuevo, esc["conductor"])
    await cierre_lineas.recalcular(pool, D)   # no-op: el día está CLOSED

    fila = await _linea(conexion_revertida, esc["conductor"])
    assert fila["home_location_id"] == cd_viejo, "un día firmado no se recalcula"


async def test_el_detalle_devuelve_el_cd_y_las_operaciones_habilitadas(conexion_revertida):
    """Ejercita el SQL de lectura completo. Un AsyncMock no habría contradicho
    ni una columna inexistente ni un LATERAL mal escrito."""
    pool = PoolDeUnaConexion(conexion_revertida)
    cd = await _cd(conexion_revertida)
    esc = await _escenario(conexion_revertida, cd_id=cd)
    shipper = await conexion_revertida.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Generador {uuid.uuid4().hex[:8]}")
    await conexion_revertida.execute(
        "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) VALUES ($1, $2, 'ACTIVE')",
        esc["carrier"], shipper)

    await cierre_lineas.recalcular(pool, D)

    conductores = await conexion_revertida.fetch(_DETAIL_SQL, D)
    mio = next(f for f in conductores if f["driver_id"] == esc["conductor"])
    assert mio["home_cd_id"] == str(cd)
    assert mio["home_cd_name"].endswith("CD EL PEÑON")
    # La fila NO tiene viaje ese día, y aun así dice bajo qué operación cuenta.
    # Eso es lo que pidió la línea 9 del documento de Operaciones.
    assert mio["today_trip_origin"] is None
    nombre_real = await conexion_revertida.fetchval(
        "SELECT name FROM public.shippers WHERE id = $1", shipper)
    assert list(mio["carrier_shipper_names"]) == [nombre_real]

    tractos = await conexion_revertida.fetch(_DETAIL_TRACTOS_SQL, D)
    suyo = next(f for f in tractos if f["asset_id"] == esc["tractor"])
    assert suyo["home_cd_id"] == str(cd)
    assert list(suyo["carrier_shipper_names"]) == [nombre_real]
