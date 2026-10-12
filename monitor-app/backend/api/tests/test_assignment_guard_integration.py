"""Guarda de asignación (D1 §7.1): una sola validación para las rutas que
vinculan flota a un viaje. Rechaza (409) lo que no puede operar por su ciclo de
vida y avisa, sin bloquear, a la empresa No habilitada (P14 abierta).

Los sujetos los crea el test (make_test_fleet, prefijo ZZ-TEST-D1). Antes de la
guarda, todas estas asignaciones se guardaban sin decir nada."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.assets import assign_driver_to_asset
from app.routers.trips import (
    TripCreateBody, TripStopCreate, assign_driver_bulk, assign_fleet_link, bulk_create_trips, create_trip,
    patch_trip,
)
from app.schemas.trip import AsignarConductorBody, TripPatch
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba
from tests.d1_subjects import apply_fleet_facts, make_test_fleet

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 5)


@pytest.fixture(autouse=True)
async def _hechos_de_la_flota(conexion_revertida):
    """app.carrier_of, app.active_fleet y la base de fleet_compliance, dentro de
    la transacción revertida: la migración se aplica recién en la Task 10."""
    await apply_fleet_facts(conexion_revertida)


STOPS = [TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")]


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(planning_date=DIA.isoformat(), client_name=await cliente_de_prueba(conn), stops=STOPS),
        pool=PoolDeUnaConexion(conn), user=usuario)
    return str(viaje["id"])


async def _vinculo_manual(conn, trip_id: str):
    return await conn.fetchrow(
        "SELECT carrier_id::text, driver_id::text, tractor_asset_id::text FROM app.trip_fleet_links "
        "WHERE trip_id = $1::uuid AND link_source = 'manual'", trip_id)


# ── POST /trips/{id}/fleet-link ──────────────────────────────────────────────

@pytest.mark.parametrize("estado", ["INACTIVE", "LEGACY_INACTIVE", "ONBOARDING"])
async def test_empresa_no_activa_es_409_y_no_escribe(conexion_revertida, estado):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, carrier_status=estado, enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"]}, PoolDeUnaConexion(conn), usuario)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "CARRIER_NOT_ACTIVE"
    assert f"Empresa {flota['suffix']}" in e.value.detail["message"]
    if estado == "ONBOARDING":   # C-R8: dice qué hacer
        assert "onboarding" in e.value.detail["message"] and "Directorio" in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_conductor_de_baja_es_409_y_no_escribe(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"]},
                                PoolDeUnaConexion(conn), usuario)

    assert (e.value.status_code, e.value.detail["code"]) == (409, "DRIVER_INACTIVE")
    assert f"Conductor {flota['suffix']}" in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_tracto_de_baja_por_su_patente_es_409(conexion_revertida):
    """La patente escrita manda sobre el id (16/09): la guarda mira el equipo
    que sale de la patente, el mismo que se escribiría."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, asset_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "tractor_plate": flota["plate"]},
                                PoolDeUnaConexion(conn), usuario)

    assert (e.value.status_code, e.value.detail["code"]) == (409, "ASSET_INACTIVE")
    assert flota["plate"] in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_sin_empresa_elegida_se_evalua_la_del_conductor(conexion_revertida):
    """C-R6: el resolvedor le pondría al vínculo la empresa de baja del
    conductor; la guarda la evalúa antes."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, carrier_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await assign_fleet_link(trip_id, {"driver_id": flota["driver"]}, PoolDeUnaConexion(conn), usuario)

    assert e.value.detail["code"] == "CARRIER_NOT_ACTIVE"


async def test_empresa_no_habilitada_asigna_con_aviso(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=False)
    trip_id = await _viaje_manual(conn, usuario)

    viaje = await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"]},
                                    PoolDeUnaConexion(conn), usuario)

    assert [w["code"] for w in viaje["warnings"]] == ["CARRIER_NOT_ENABLED"]
    assert f"Empresa {flota['suffix']}" in viaje["warnings"][0]["message"]
    assert (await _vinculo_manual(conn, trip_id))["driver_id"] == flota["driver"]


async def test_empresa_habilitada_asigna_sin_aviso(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    viaje = await assign_fleet_link(trip_id, {"carrier_id": flota["carrier"], "driver_id": flota["driver"],
                                              "tractor_plate": flota["plate"]},
                                    PoolDeUnaConexion(conn), usuario)

    assert viaje["warnings"] == []
    assert (await _vinculo_manual(conn, trip_id))["tractor_asset_id"] == flota["asset"]


# ── POST /trips ──────────────────────────────────────────────────────────────

async def test_alta_con_conductor_de_baja_es_409_y_no_crea_el_viaje(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    cliente = await cliente_de_prueba(conn)

    with pytest.raises(HTTPException) as e:
        await create_trip(
            TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                           carrier_id=flota["carrier"], driver_id=flota["driver"]),
            pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval("SELECT count(*) FROM app.trips_manual WHERE client_name = $1", cliente) == 0


# ── POST /trips/assign-driver ────────────────────────────────────────────────

async def test_asignar_un_conductor_de_baja_a_varios_viajes_es_409_y_no_escribe(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    viajes = [await _viaje_manual(conn, usuario) for _ in range(2)]

    with pytest.raises(HTTPException) as e:
        await assign_driver_bulk(AsignarConductorBody(driver_id=flota["driver"], trip_ids=viajes),
                                 PoolDeUnaConexion(conn), usuario)

    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert await conn.fetchval(
        "SELECT count(*) FROM app.trip_fleet_links WHERE trip_id = ANY($1::uuid[]) AND driver_id = $2::uuid",
        viajes, flota["driver"]) == 0


# ── POST /trips/bulk (Review Focus 4) ────────────────────────────────────────

async def test_bulk_con_un_conductor_de_baja_no_escribe_nada(conexion_revertida):
    """Un solo viaje del lote toca a un conductor dado de baja: 409 para el
    lote entero, con la fila y el nombre de quien bloquea, y ninguna escritura.
    La persona no puede creer que guardó la mitad."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    buena = await make_test_fleet(conn, enabled=True)
    mala = await make_test_fleet(conn, driver_status="INACTIVE", enabled=True)
    cliente = await cliente_de_prueba(conn)

    def fila(f):
        return TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                              carrier_id=f["carrier"], driver_id=f["driver"])

    with pytest.raises(HTTPException) as e:
        await bulk_create_trips([fila(buena), fila(mala), fila(buena)], pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.status_code == 409
    assert e.value.detail["code"] == "DRIVER_INACTIVE"
    assert [(x["row"], x["code"]) for x in e.value.detail["errors"]] == [(2, "DRIVER_INACTIVE")]
    assert f"Conductor {mala['suffix']}" in e.value.detail["errors"][0]["error"]
    assert await conn.fetchval("SELECT count(*) FROM app.trips_manual WHERE client_name = $1", cliente) == 0
    assert await conn.fetchval("SELECT count(*) FROM app.trips WHERE client_name = $1", cliente) == 0


async def test_bulk_con_empresa_no_habilitada_importa_con_aviso_por_fila(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    habilitada = await make_test_fleet(conn, enabled=True)
    no_habilitada = await make_test_fleet(conn, enabled=False)
    cliente = await cliente_de_prueba(conn)
    filas = [TripCreateBody(planning_date=DIA.isoformat(), client_name=cliente, stops=STOPS,
                            carrier_id=f["carrier"], driver_id=f["driver"]) for f in (habilitada, no_habilitada)]

    res = await bulk_create_trips(filas, pool=PoolDeUnaConexion(conn), user=usuario)

    assert res["created"] == 2
    assert [(w["row"], w["code"]) for w in res["warnings"]] == [(2, "CARRIER_NOT_ENABLED")]


# ── Conductor habitual (C-R16) ──────────────────────────────────────────────

@pytest.mark.parametrize("de_baja, codigo", [("driver", "DRIVER_INACTIVE"), ("asset", "ASSET_INACTIVE")])
async def test_conductor_habitual_de_baja_es_409(conexion_revertida, de_baja, codigo):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, **{f"{de_baja}_status": "INACTIVE"})

    with pytest.raises(HTTPException) as e:
        await assign_driver_to_asset(flota["asset"], {"driver_id": flota["driver"]},
                                     pool=PoolDeUnaConexion(conn), user=usuario)

    assert e.value.detail["code"] == codigo
    assert await conn.fetchval(
        "SELECT count(*) FROM public.vehicle_driver_assignments WHERE asset_id = $1::uuid AND status = 'ACTIVE'",
        flota["asset"]) == 0


async def test_conductor_habitual_responde_con_avisos_vacios(conexion_revertida):
    """Ruling F21: la misma forma que las otras rutas de asignación. No es un
    viaje: la empresa no se evalúa, así que nunca trae avisos."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=False)

    res = await assign_driver_to_asset(flota["asset"], {"driver_id": flota["driver"]},
                                       pool=PoolDeUnaConexion(conn), user=usuario)

    assert res == {"ok": True, "warnings": []}


# ── PATCH /trips/{id} con patente (Ruling F4) ────────────────────────────────

async def test_editar_la_patente_hacia_un_tracto_de_baja_es_409_y_no_escribe(conexion_revertida):
    """El detalle del viaje también escribe el vínculo manual al cambiar la
    patente: un tracto dado de baja no entra por esa puerta."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, asset_status="INACTIVE", enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    with pytest.raises(HTTPException) as e:
        await patch_trip(trip_id, TripPatch(tractor_plate=flota["plate"]), PoolDeUnaConexion(conn), usuario)

    assert (e.value.status_code, e.value.detail["code"]) == (409, "ASSET_INACTIVE")
    assert flota["plate"] in e.value.detail["message"]
    assert await _vinculo_manual(conn, trip_id) is None


async def test_editar_la_patente_hacia_un_tracto_activo_guarda_con_avisos_vacios(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    flota = await make_test_fleet(conn, enabled=True)
    trip_id = await _viaje_manual(conn, usuario)

    viaje = await patch_trip(trip_id, TripPatch(tractor_plate=flota["plate"]), PoolDeUnaConexion(conn), usuario)

    assert viaje["warnings"] == []
    assert await conn.fetchval(
        "SELECT tractor_plate FROM app.trip_fleet_links WHERE trip_id = $1::uuid", trip_id) == flota["plate"]
