"""D1 "Una sola respuesta", Task 7: el Monitor.

Cada viaje dice si su empresa puede operar y si hay un aviso crítico. Un
conductor con dos tractos ya no sale dos veces al asignar (F-07, Review Focus
2), y el conductor habitual no admite a quien está dado de baja (spec §7.1).
Contra Postgres de verdad, en una transacción revertida."""
from __future__ import annotations

import json
import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.routers.assets import assign_driver_to_asset
from app.routers.drivers import fuzzy_match_drivers, list_drivers
from app.routers.trips import available_drivers, driver_candidates, get_trip, list_trips
from tests import d1_subjects as s
from tests.conftest import USER, PoolDeUnaConexion, cliente_de_prueba

pytestmark = pytest.mark.integracion

# Un día que Operaciones nunca firma ni planifica.
DIA = date(2099, 1, 15)


async def _viaje(conn, *, carrier: str | None = None, driver: str | None = None) -> str:
    trip_id = str(uuid.uuid4())
    estado = await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE active AND group_id = 'en_ruta' ORDER BY id LIMIT 1")
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, source_system_trip_id, client_name, planning_date,
                               trip_status, fleet, is_active, is_working, is_assigned, is_first_leg,
                               manually_edited_fields)
        VALUES ($1::uuid, 'qanalytics', $2, $3, $4, $5, $6::jsonb, true, false, false, false, '{}')
        """,
        trip_id, f"{s.PREFIX}-{trip_id[:8]}", await cliente_de_prueba(conn), DIA, estado, json.dumps({}))
    if carrier or driver:
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, driver_id, link_source) "
            "VALUES ($1::uuid, $2::uuid, $3::uuid, 'manual')", trip_id, carrier, driver)
    return trip_id


async def test_el_monitor_dice_si_la_empresa_puede_operar_y_si_hay_aviso_critico(conexion_revertida):
    conn = conexion_revertida
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    d = await s.driver(conn, c)
    await s.without_seeding(conn, c, d)
    req = await s.requirement(conn, entity="DRIVER")
    # Vence hoy: crítico (0 días ≤ error_days 0), todavía no vencido, y por
    # vencer no quita la habilitación (E-c).
    await s.record(conn, req, "DRIVER", d, status="APPROVED_MANUAL", expires=hoy)
    tid = await _viaje(conn, carrier=c, driver=d)

    viaje = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=USER)

    assert viaje["carrier_can_operate"] is True
    assert viaje["driver_has_critical_alert"] is True
    # La empresa está resuelta y no tiene nada crítico: false. El tracto no
    # está resuelto: None, igual que tractor_pending_docs.
    assert viaje["carrier_has_critical_alert"] is False
    assert viaje["tractor_has_critical_alert"] is None
    assert "has_critical_alert" not in viaje and "can_operate" not in viaje
    assert viaje["driver_pending_docs"] == 1   # lo de hoy sigue al lado (Task 16)


async def test_una_empresa_con_un_obligatorio_faltante_no_puede_operar(conexion_revertida):
    conn = conexion_revertida
    await s.thresholds(conn, warning=30, critical=0)
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    d = await s.driver(conn, c)
    await s.without_seeding(conn, c, d)
    await s.record(conn, await s.requirement(conn, entity="CARRIER"), "CARRIER", c)
    # Por vencer en 20 días: aviso, no crítico.
    await s.record(conn, await s.requirement(conn, entity="DRIVER"), "DRIVER", d,
                   status="APPROVED_MANUAL", expires=hoy + timedelta(days=20))
    con_empresa = await _viaje(conn, carrier=c, driver=d)
    sin_nada = await _viaje(conn)

    res = await list_trips(q=s.PREFIX, view="historial", fecha_desde=DIA.isoformat(),
                           fecha_hasta=DIA.isoformat(), pool=PoolDeUnaConexion(conn), user=USER)
    por_id = {str(v["id"]): v for v in res["data"]}

    campos = ("carrier_can_operate", "driver_has_critical_alert", "carrier_has_critical_alert")
    # Un obligatorio que falta no es un aviso crítico: quita la habilitación.
    assert tuple(por_id[con_empresa][k] for k in campos) == (False, False, False)
    # Sin nada resuelto no hay a quién preguntar: None, no "habilitada" ni "sin aviso".
    assert tuple(por_id[sin_nada][k] for k in campos) == (None, None, None)


async def test_el_viaje_trae_el_ciclo_de_vida_de_su_empresa(conexion_revertida):
    """Revisión final D1, M2: una empresa dada de baja no puede operar, pero no
    está "No habilitada" en rojo ni se le puede asignar el viaje (la guarda
    responde 409). El panel necesita su ciclo de vida para decirlo en gris."""
    conn = conexion_revertida
    activa = await s.carrier(conn)
    de_baja = await s.carrier(conn, status="INACTIVE")
    await s.without_seeding(conn, activa, de_baja)
    con_activa = await _viaje(conn, carrier=activa)
    con_baja = await _viaje(conn, carrier=de_baja)
    sin_empresa = await _viaje(conn)
    pool = PoolDeUnaConexion(conn)

    viaje = await get_trip(con_baja, pool=pool, user=USER)
    assert (viaje["carrier_can_operate"], viaje["carrier_operational_status"]) == (False, "INACTIVE")
    res = await list_trips(q=s.PREFIX, view="historial", fecha_desde=DIA.isoformat(),
                           fecha_hasta=DIA.isoformat(), pool=pool, user=USER)
    por_id = {str(v["id"]): v for v in res["data"]}
    campos = ("carrier_can_operate", "carrier_operational_status")
    assert tuple(por_id[con_activa][k] for k in campos) == (True, "ACTIVE")
    assert tuple(por_id[con_baja][k] for k in campos) == (False, "INACTIVE")
    assert tuple(por_id[sin_empresa][k] for k in campos) == (None, None)


async def test_drivers_no_duplica_conductor_con_dos_tractos(conexion_revertida):
    """Review Focus 2. vehicle_driver_assignments permite un conductor por
    tracto, no un tracto por conductor: el LEFT JOIN plano lo devolvía dos
    veces al asignar un viaje."""
    conn = conexion_revertida
    hoy = await s.today(conn)
    c = await s.carrier(conn)
    nombre = f"{s.PREFIX} Dostractos {s.suffix()}"
    d = await s.driver(conn, c, name=nombre)
    viejo, nuevo = await s.asset(conn, c), await s.asset(conn, c)
    await s.usual_driver(conn, viejo, d, hoy - timedelta(days=90))
    await s.usual_driver(conn, nuevo, d, hoy - timedelta(days=3))
    pool = PoolDeUnaConexion(conn)

    busqueda = await list_drivers(q=nombre, limit=10, pool=pool, _=None)
    assert [(str(f["driver_id"]), str(f["tractor_asset_id"])) for f in busqueda] == [(d, nuevo)]

    parecidos = await fuzzy_match_drivers(name=nombre, limit=20, pool=pool, _=None)
    assert [str(f["tractor_asset_id"]) for f in parecidos if str(f["driver_id"]) == d] == [nuevo]

    disponibles = await available_drivers(fecha=DIA.isoformat(), pool=pool, _=None)
    assert [str(f["tractor_asset_id"]) for f in disponibles if str(f["driver_id"]) == d] == [nuevo]


async def test_los_candidatos_traen_el_estado_de_su_empresa_y_nunca_a_un_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    marca = s.suffix()
    de_baja = await s.driver(conn, None, status="INACTIVE", name=f"Zzdeuno{marca} Zzpersona{marca}")
    empresa_de_baja = await s.carrier(conn, status="INACTIVE")
    activo = await s.driver(conn, empresa_de_baja, name=f"Zzdeuno{marca} Zzpersona{marca} Segundo")

    resp = await driver_candidates(nombre=f"Zzdeuno{marca} Zzpersona{marca}", limit=25,
                                   pool=PoolDeUnaConexion(conn), _=None)
    por_id = {f["driver_id"]: f for f in resp["candidatos"]}

    # Guarda (ya es cierto hoy): un conductor dado de baja nunca se ofrece.
    assert de_baja not in por_id
    # R-B6: el de una empresa dada de baja se ofrece, marcado; la guarda de la
    # Task 8 rechaza la asignación con un mensaje claro.
    assert por_id[activo]["carrier_operational_status"] == "INACTIVE"


async def test_el_conductor_habitual_no_admite_a_un_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    c = await s.carrier(conn)
    tracto = await s.asset(conn, c)
    de_baja = await s.driver(conn, c, status="INACTIVE")

    with pytest.raises(HTTPException) as e:
        await assign_driver_to_asset(tracto, {"driver_id": de_baja}, pool=PoolDeUnaConexion(conn), user=USER)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id = $1", tracto) == 0
