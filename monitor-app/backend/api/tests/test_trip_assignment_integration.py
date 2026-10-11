"""Activo y asignado del viaje: una sola definición en la base (spec 2026-10-11,
trip-assignment-in-the-database). La migración se ejecuta dentro de la
transacción revertida de cada test, así que esto prueba el archivo antes de
aplicarlo en la base real."""
from __future__ import annotations

import json
import uuid
from datetime import date
from pathlib import Path

import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services.cierre_viajes import SQL_GRUPOS_CIERRE
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba

pytestmark = pytest.mark.integracion

MIGRATION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261012090000_trip_assignment_in_the_database.sql"
)
TEST_DATE = date(2099, 1, 15)


async def apply_migration(conn) -> None:
    await conn.execute(MIGRATION.read_text())


async def open_status(conn) -> str:
    return await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE active AND group_id = 'en_ruta' ORDER BY id LIMIT 1")


async def insert_tms_trip(conn, status: str, fleet: dict) -> str:
    trip_id = str(uuid.uuid4())
    client = await cliente_de_prueba(conn)
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, source_system_trip_id, client_name, planning_date,
                               trip_status, fleet, is_active, is_working, is_assigned, is_first_leg,
                               manually_edited_fields)
        VALUES ($1::uuid, 'qanalytics', $2, $3, $4, $5, $6::jsonb, true, false, false, false, '{}')
        """,
        trip_id, f"TEST-{trip_id[:8]}", client, TEST_DATE, status, json.dumps(fleet))
    return trip_id


async def any_driver_id(conn) -> str:
    return str(await conn.fetchval(
        "SELECT id FROM public.drivers WHERE operational_status = 'ACTIVE' ORDER BY id LIMIT 1"))


async def link_driver(conn, trip_id: str) -> None:
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))


async def is_assigned(conn, trip_id: str) -> bool:
    return await conn.fetchval("SELECT is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)


async def test_is_trip_open(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    assert await conn.fetchval("SELECT app.is_trip_open('CERRADO FINALIZADO')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('Declinada')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('ORIGEN')") is True
    assert await conn.fetchval("SELECT app.is_trip_open(NULL)") is None


async def test_is_trip_assigned_reads_fleet_and_link(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    status = await open_status(conn)
    with_plate = await insert_tms_trip(conn, status, {"tractor_plate": "ZZZZ99"})
    with_rut = await insert_tms_trip(conn, status, {"driver_rut_tms": "11111111-1"})
    empty = await insert_tms_trip(conn, status, {"tractor_plate": ""})
    q = "SELECT app.is_trip_assigned(trip_status, fleet, id) FROM app.trips WHERE id = $1::uuid"
    assert await conn.fetchval(q, with_plate) is True
    assert await conn.fetchval(q, with_rut) is True
    assert await conn.fetchval(q, empty) is False


async def test_published_offer_never_assigned_even_with_link(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, "Publicada", {"tractor_plate": "ZZZZ99"})
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is False


async def test_linking_a_driver_assigns_in_the_same_transaction(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    assert await is_assigned(conn, trip_id) is False
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is True


async def test_removing_link_unassigns(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is True
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1::uuid", trip_id)
    assert await is_assigned(conn, trip_id) is False


async def test_manual_override_is_respected(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    await conn.execute(
        "UPDATE app.trips SET is_assigned = false, manually_edited_fields = ARRAY['is_assigned'] "
        "WHERE id = $1::uuid", trip_id)
    before = await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id)
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is False
    # Ni siquiera se reescribe: protect_manual_overrides conservaría el valor,
    # pero el trigger no debe gastar la escritura.
    assert await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id) == before


async def test_link_change_without_effect_does_not_touch_trip(conexion_revertida):
    """Un cambio del vínculo que no altera "asignado" no reescribe el viaje: la
    ingesta reescribe miles de vínculos automáticos por corrida (Disk IO)."""
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await insert_tms_trip(conn, await open_status(conn), {"tractor_plate": "ZZZZ99"})
    await link_driver(conn, trip_id)
    before = await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id)
    await conn.execute(
        "UPDATE app.trip_fleet_links SET driver_phone = '+56900000000' WHERE trip_id = $1::uuid", trip_id)
    after = await conn.fetchval("SELECT ctid::text FROM app.trips WHERE id = $1::uuid", trip_id)
    assert after == before


async def create_manual_trip(conn, status: str | None, tractor_plate: str | None) -> str:
    trip = await create_trip(
        TripCreateBody(
            planning_date=TEST_DATE.isoformat(),
            client_name=await cliente_de_prueba(conn),
            current_status=status,
            driver_name="CONDUCTOR DE PRUEBA SIN MATCH" if tractor_plate else None,
            tractor_plate=tractor_plate,
            stops=[TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn),
        user=await _usuario_real(conn),
    )
    return str(trip["id"])


async def test_closed_manual_trip_with_fleet_is_born_inactive_and_assigned(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, "CERRADO FINALIZADO", "ZZZZ99")
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (False, True)
    in_closure = {str(r["trip_id"]) for r in await conn.fetch(SQL_GRUPOS_CIERRE, TEST_DATE)}
    assert trip_id not in in_closure


async def test_manual_trip_without_fleet_is_born_active_and_unassigned(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (True, False)
