"""D2 "Asignaciones con vigencia": el historial que escribe el trigger
(migración 20261017090000_fleet_assignment_periods.sql).

Criterios A1, A3 y A4 de docs/superpowers/plans/2026-10-14-entrega-a-d2-sin-clasificar.md.
El día se fija reemplazando public.hoy_chile() dentro de la transacción revertida."""
from __future__ import annotations

import uuid
from datetime import date

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

PREFIX = "ZZ-TEST-D2"


async def _day(conn, d: date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{d.isoformat()}' $$")


async def _carrier(conn) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Empresa {uuid.uuid4().hex[:6]}")


async def _driver(conn) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Conductor {uuid.uuid4().hex[:6]}")


async def _move(conn, driver, carrier) -> None:
    """Lo mismo que hace hoy carriers._transferir: apagar la vieja, upsert de la nueva."""
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' "
        "WHERE driver_id = $1 AND carrier_id <> $2 AND status = 'ACTIVE'", driver, carrier)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE') "
        "ON CONFLICT (driver_id, carrier_id) DO UPDATE SET status = 'ACTIVE'", driver, carrier)


async def _carrier_of(conn, driver, d: date):
    return await conn.fetchval("SELECT app.carrier_of('DRIVER', $1, $2)", driver, d)


async def test_a1_transfer_closes_the_old_period_on_the_effective_day(conexion_revertida):
    conn = conexion_revertida
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 1, 10))
    await _move(conn, driver, a)
    await _day(conn, date(2030, 1, 20))
    await _move(conn, driver, b)

    assert await _carrier_of(conn, driver, date(2030, 1, 19)) == a
    assert await _carrier_of(conn, driver, date(2030, 1, 20)) == b
    assert await conn.fetchval("SELECT app.carrier_of('DRIVER', $1)", driver) == b
    assert await _carrier_of(conn, driver, date(2030, 1, 9)) is None


async def test_a3_two_carriers_on_the_same_day_are_impossible(conexion_revertida):
    conn = conexion_revertida
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 1, 10))
    await _move(conn, driver, a)

    with pytest.raises(asyncpg.ExclusionViolationError):
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO app.fleet_assignment_periods (relation, subject_id, counterpart_id, valid_during) "
                "VALUES ('DRIVER_CARRIER', $1, $2, daterange('2030-01-15', NULL))", driver, b)


async def test_a4_rejoining_opens_a_new_period_and_keeps_the_old_one(conexion_revertida):
    conn = conexion_revertida
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    for day, carrier in ((date(2030, 1, 10), a), (date(2030, 1, 20), b), (date(2030, 1, 25), a)):
        await _day(conn, day)
        await _move(conn, driver, carrier)

    periods = await conn.fetch(
        "SELECT counterpart_id, lower(valid_during) AS desde, upper(valid_during) AS hasta "
        "FROM app.fleet_assignment_periods WHERE subject_id = $1 ORDER BY lower(valid_during)", driver)
    assert [(p["counterpart_id"], p["desde"], p["hasta"]) for p in periods] == [
        (a, date(2030, 1, 10), date(2030, 1, 20)),
        (b, date(2030, 1, 20), date(2030, 1, 25)),
        (a, date(2030, 1, 25), None),
    ]


async def test_a2_a_closed_day_rejects_the_change(conexion_revertida):
    """La base: una fecha efectiva en o antes de un día cerrado no cambia nada.
    El 409 de la API se prueba con el servicio."""
    conn = conexion_revertida
    a, driver = await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 1, 10))
    await _move(conn, driver, a)
    signer = await conn.fetchval("SELECT id FROM auth.users LIMIT 1")
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) "
        "VALUES ('2030-01-15', 'CLOSED', $1, now())", signer)
    await _day(conn, date(2030, 1, 16))

    with pytest.raises(asyncpg.RaiseError, match="15/01 ya está cerrado"):
        async with conn.transaction():
            await conn.execute(
                "UPDATE public.driver_assignments SET status = 'INACTIVE', end_date = '2030-01-15' "
                "WHERE driver_id = $1", driver)
    assert await _carrier_of(conn, driver, date(2030, 1, 16)) == a

    # Hoy (el día siguiente al cerrado) sí se puede.
    await conn.execute("UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", driver)
    assert await _carrier_of(conn, driver, date(2030, 1, 16)) is None
