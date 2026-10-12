"""Crear un viaje manual contra la base real (bug 23/09, "Error 500").

El 500 venia de dos dueños para una misma fila: el INSERT en app.trips dispara
`trg_trips_resolve_fleet_ins`, que ya escribe un vinculo `auto` en
app.trip_fleet_links, y despues `_insert_trip` insertaba el `manual` sin
ON CONFLICT -> UniqueViolation en `uq_trip_fleet_link`. Nunca funciono desde
el 17/08 (capa 3-4 del modelo de flota), y como el alta corria sin
transaccion cada reintento dejaba un viaje a medias: 7 copias del mismo viaje
el 23/09.

Un test mockeado no puede ver esto: el choque es entre el endpoint y un
trigger. Por eso todo aca corre contra Postgres, dentro de la transaccion
revertida de `conexion_revertida`.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, assign_fleet_link, create_trip
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba
from tests.d1_subjects import apply_fleet_facts, make_test_fleet

pytestmark = pytest.mark.integracion


@pytest.fixture(autouse=True)
async def _hechos_de_la_flota(conexion_revertida):
    """D1: la guarda de asignación (Task 8) y la lectura del viaje (Task 7) leen
    app.carrier_of, app.active_fleet y fleet_compliance; hasta la Task 10 la
    migración no está aplicada."""
    await apply_fleet_facts(conexion_revertida)


async def _conductor_con_empresa(conn):
    """Un conductor activo con su empresa activa y habilitada, creados por el
    test (D1 Task 8). Antes salía de producción con un LIMIT 1, y desde la
    guarda caía en una empresa de baja: un 409 ajeno a lo que se prueba."""
    flota = await make_test_fleet(conn, enabled=True)
    nombre = await conn.fetchval("SELECT full_name FROM public.drivers WHERE id = $1", flota["driver"])
    return flota["driver"], flota["carrier"], nombre


async def _un_estado(conn) -> str:
    return await conn.fetchval("SELECT id FROM app.trip_statuses WHERE active ORDER BY id LIMIT 1")


async def _filas_del_cliente(conn, cliente: str) -> dict:
    return {
        "trips": await conn.fetchval("SELECT count(*) FROM app.trips WHERE client_name = $1", cliente),
        "trips_manual": await conn.fetchval(
            "SELECT count(*) FROM app.trips_manual WHERE client_name = $1", cliente),
        "trip_stops": await conn.fetchval(
            "SELECT count(*) FROM app.trip_stops s JOIN app.trips_manual m ON m.id = s.trip_id "
            "WHERE m.client_name = $1", cliente),
    }


async def test_crear_viaje_con_conductor_y_empresa_deja_un_solo_vinculo_manual(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    driver_id, carrier_id, nombre = await _conductor_con_empresa(conn)
    cliente = await cliente_de_prueba(conn)

    viaje = await create_trip(
        TripCreateBody(
            planning_date="2026-09-23",
            client_name=cliente,
            current_status=await _un_estado(conn),
            driver_name=nombre,
            driver_id=driver_id,
            carrier_id=carrier_id,
            tractor_plate="ZZZZ99",
            stops=[
                TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"),
                TripStopCreate(local="IANSA", planning_date="2026-09-23 12:41"),
            ],
        ),
        pool=PoolDeUnaConexion(conn),
        user=usuario,
    )

    links = await conn.fetch(
        "SELECT id, link_source, carrier_id::text, driver_id::text FROM app.trip_fleet_links "
        "WHERE trip_id = $1", viaje["id"])
    assert len(links) == 1
    assert links[0]["link_source"] == "manual"
    assert links[0]["carrier_id"] == carrier_id
    assert links[0]["driver_id"] == driver_id
    enlazado = await conn.fetchrow(
        "SELECT t.fleet_link_id AS t, m.fleet_link_id AS m FROM app.trips t "
        "JOIN app.trips_manual m ON m.id = t.id WHERE t.id = $1", viaje["id"])
    assert enlazado["t"] == links[0]["id"] == enlazado["m"]


async def test_crear_viaje_solo_con_patente_no_choca_con_el_trigger(conexion_revertida):
    """La rama sin empresa (carga masiva CSV) tambien insertaba un `auto` a
    mano, y chocaba igual: la resolucion automatica es del trigger."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    patente = await conn.fetchval(
        "SELECT license_plate FROM public.assets WHERE license_plate IS NOT NULL ORDER BY id LIMIT 1")
    cliente = await cliente_de_prueba(conn)

    viaje = await create_trip(
        TripCreateBody(
            planning_date="2026-09-23",
            client_name=cliente,
            driver_name="CONDUCTOR DE PRUEBA SIN MATCH",
            tractor_plate=patente,
            stops=[TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn),
        user=usuario,
    )

    fuentes = [r["link_source"] for r in await conn.fetch(
        "SELECT link_source FROM app.trip_fleet_links WHERE trip_id = $1", viaje["id"])]
    assert fuentes == ["auto"]


async def test_un_alta_que_falla_no_deja_nada_escrito(conexion_revertida):
    """Atomicidad: la fecha invalida de un destino se detecta despues de
    escribir trips_manual y trips. Antes quedaban confirmados."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    cliente = await cliente_de_prueba(conn)

    with pytest.raises(HTTPException) as err:
        await create_trip(
            TripCreateBody(
                planning_date="2026-09-23",
                client_name=cliente,
                stops=[
                    TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"),
                    TripStopCreate(local="IANSA", planning_date="no es una fecha"),
                ],
            ),
            pool=PoolDeUnaConexion(conn),
            user=usuario,
        )

    assert err.value.status_code == 422
    assert await _filas_del_cliente(conn, cliente) == {"trips": 0, "trips_manual": 0, "trip_stops": 0}


async def test_vincular_a_mano_un_viaje_con_vinculo_auto_lo_reemplaza(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    driver_id, carrier_id, nombre = await _conductor_con_empresa(conn)
    viaje = await create_trip(
        TripCreateBody(planning_date="2026-09-23", client_name=await cliente_de_prueba(conn),
                       driver_name=nombre, stops=[TripStopCreate(local="IANSA")]),
        pool=PoolDeUnaConexion(conn),
        user=usuario,
    )
    assert await conn.fetchval(
        "SELECT link_source FROM app.trip_fleet_links WHERE trip_id = $1", viaje["id"]) == "auto"

    await assign_fleet_link(
        viaje["id"], {"driver_id": driver_id, "carrier_id": carrier_id, "driver_name": nombre},
        pool=PoolDeUnaConexion(conn), user=usuario,
    )

    links = await conn.fetch(
        "SELECT link_source, driver_match_rule FROM app.trip_fleet_links WHERE trip_id = $1", viaje["id"])
    assert [(r["link_source"], r["driver_match_rule"]) for r in links] == [("manual", None)]
