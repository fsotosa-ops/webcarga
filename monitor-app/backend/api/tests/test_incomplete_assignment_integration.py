"""Cierre › Viajes: el grupo "Asignación incompleta" (minuta 09/10 §2.4; decisiones
del usuario del 11/10). Un viaje asignado al que le falta el tracto o el conductor
resueltos contra el directorio pasa al Cierre para completarlo: los del día (activos
o cerrados) y los activos de días anteriores. Solo los del día bloquean la firma."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from app.routers.trips import cierre_viajes
from app.services.cierre_viajes import SQL_GRUPOS_CIERRE
from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

DAY = date(2099, 1, 20)
OPEN_STATUS = "RUTA"
CLOSED_STATUS = "CERRADO FINALIZADO"


async def insert_trip(conn, *, planning_date: date, status: str = OPEN_STATUS, is_active: bool = True,
                      source_system: str = "qanalytics") -> uuid.UUID:
    trip_id = uuid.uuid4()
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, planning_date, client_name, source_system_trip_id,
                               trip_status, fleet, status_reported_at, is_active, is_assigned)
        VALUES ($1, $2, $3, 'TEST-INCOMPLETA', $4, $5, '{}'::jsonb, now(), $6, true)
        """,
        trip_id, source_system, planning_date, str(trip_id), status, is_active)
    return trip_id


async def any_tractor_id(conn) -> uuid.UUID:
    return await conn.fetchval("SELECT id FROM public.assets WHERE license_plate IS NOT NULL ORDER BY id LIMIT 1")


async def any_driver_id(conn) -> uuid.UUID:
    return await conn.fetchval(
        "SELECT id FROM public.drivers WHERE operational_status = 'ACTIVE' ORDER BY id LIMIT 1")


async def link(conn, trip_id: uuid.UUID, *, tractor: uuid.UUID | None, driver: uuid.UUID | None) -> None:
    await conn.execute(
        """
        INSERT INTO app.trip_fleet_links (trip_id, tractor_asset_id, driver_id, link_source)
        VALUES ($1, $2, $3, 'manual')
        ON CONFLICT (trip_id) DO UPDATE
            SET tractor_asset_id = EXCLUDED.tractor_asset_id, driver_id = EXCLUDED.driver_id, link_source = 'manual'
        """,
        trip_id, tractor, driver)


async def groups(conn, day: date = DAY) -> dict:
    return {r["trip_id"]: r for r in await conn.fetch(SQL_GRUPOS_CIERRE, day)}


async def test_day_trip_with_only_a_tractor_is_incomplete_and_blocks(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY)
    await link(conn, trip_id, tractor=await any_tractor_id(conn), driver=None)

    row = (await groups(conn))[trip_id]
    assert row["grupo"] == "incomplete_assignment"
    assert list(row["missing_fleet"]) == ["driver"]

    response = await cierre_viajes(fecha=DAY.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    assert str(trip_id) in {v["trip_id"] for v in response["grupos"]["incomplete_assignment"]}
    assert response["bloquean"] >= 1
    entry = next(v for v in response["grupos"]["incomplete_assignment"] if v["trip_id"] == str(trip_id))
    assert entry["missing_fleet"] == ["driver"]


async def test_completing_the_fleet_takes_it_out_of_the_group(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY)
    await link(conn, trip_id, tractor=await any_tractor_id(conn), driver=None)
    assert (await groups(conn))[trip_id]["grupo"] == "incomplete_assignment"

    await link(conn, trip_id, tractor=await any_tractor_id(conn), driver=await any_driver_id(conn))
    assert trip_id not in await groups(conn)


async def test_closed_day_trip_missing_both_is_incomplete(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, status=CLOSED_STATUS, is_active=False)
    await conn.execute("UPDATE app.trips SET fleet = '{\"tractor_plate\": \"ZZZZ99\"}'::jsonb WHERE id = $1", trip_id)

    row = (await groups(conn))[trip_id]
    assert row["grupo"] == "incomplete_assignment"
    assert sorted(row["missing_fleet"]) == ["driver", "tractor"]


async def test_active_trip_from_before_appears_but_does_not_block(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=2))
    await link(conn, trip_id, tractor=None, driver=await any_driver_id(conn))

    assert (await groups(conn))[trip_id]["grupo"] == "incomplete_assignment"
    before = await cierre_viajes(fecha=DAY.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    await conn.execute("UPDATE app.trips SET planning_date = $2 WHERE id = $1", trip_id, DAY)
    same_day = await cierre_viajes(fecha=DAY.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    assert same_day["bloquean"] == before["bloquean"] + 1


async def test_closed_trip_from_before_does_not_appear(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=2), status=CLOSED_STATUS, is_active=False)
    await link(conn, trip_id, tractor=await any_tractor_id(conn), driver=None)
    assert trip_id not in await groups(conn)


async def test_waiting_for_tms_closure_is_completed_first(conexion_revertida):
    """Un Sodimac en Control de salida con solo la rampla primero se completa
    (minuta 09/10 §2.3); recién completo pasa a "Espera cierre del TMS"."""
    conn = conexion_revertida
    waiting = await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE group_id = 'pendiente_cierre_tms' ORDER BY id LIMIT 1")
    if waiting is None:
        pytest.skip("ningún estado del catálogo está en el grupo pendiente_cierre_tms")
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=1), status=waiting, source_system="sodimac")
    await conn.execute(
        "UPDATE app.trips SET fleet = '{\"trailer_plate\": \"ZZZZ98\"}'::jsonb WHERE id = $1", trip_id)
    assert (await groups(conn))[trip_id]["grupo"] == "incomplete_assignment"

    await link(conn, trip_id, tractor=await any_tractor_id(conn), driver=await any_driver_id(conn))
    assert (await groups(conn))[trip_id]["grupo"] == "pendiente_cierre_tms"


async def test_rows_carry_the_resolved_entity_ids(conexion_revertida):
    """La vista rápida (HU 20261011/01) abre la entidad por su id: la fila los trae
    resueltos contra el directorio, o null si no hay."""
    conn = conexion_revertida
    linked = await insert_trip(conn, planning_date=DAY)
    tractor, driver = await any_tractor_id(conn), await any_driver_id(conn)
    await link(conn, linked, tractor=tractor, driver=None)
    bare = await insert_trip(conn, planning_date=DAY)

    response = await cierre_viajes(fecha=DAY.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    rows = {v["trip_id"]: v for group in response["grupos"].values() for v in group}

    assert rows[str(linked)]["tractor_asset_id"] == str(tractor)
    assert rows[str(linked)]["driver_id"] is None
    assert (rows[str(bare)]["carrier_id"], rows[str(bare)]["driver_id"], rows[str(bare)]["tractor_asset_id"]) == (
        None, None, None)
