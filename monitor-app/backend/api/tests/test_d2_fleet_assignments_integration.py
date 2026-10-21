"""D2: el servicio de relaciones con vigencia (services/fleet_assignments.py) y el
Cierre juzgando con la empresa del día. Criterios A2, A5, A7, A8 y A9 de
docs/superpowers/plans/2026-10-14-entrega-a-d2-sin-clasificar.md."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.services import fleet_assignments as fa
from app.services.driver_roster import tractoreo_roster_cte

from .conftest import _usuario_real

pytestmark = pytest.mark.integracion

PREFIX = "ZZ-TEST-D2"


async def _day(conn, d: date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{d.isoformat()}' $$")


async def _carrier(conn, status: str = "ACTIVE") -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status, tax_id) VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIX} Empresa {uuid.uuid4().hex[:6]}", status, f"7{uuid.uuid4().int % 10**7:07d}-K"))


async def _driver(conn) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Conductor {uuid.uuid4().hex[:6]}"))


async def _tractor(conn, *, tractoreo: bool = True) -> str:
    type_id = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE code = 'TRACTOREO' LIMIT 1") if tractoreo else None
    return str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", type_id))


async def _actor(conn) -> str:
    return (await _usuario_real(conn))["sub"]


async def _close(conn, d: date) -> None:
    signer = await conn.fetchval("SELECT id FROM auth.users LIMIT 1")
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) VALUES ($1, 'CLOSED', $2, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2, closed_at = now()", d, signer)


async def test_a2_a_closed_day_is_a_409_and_changes_nothing(conexion_revertida):
    conn = conexion_revertida
    actor = await _actor(conn)
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 2, 10))
    await fa.assign(conn, fa.DRIVER, driver, a, actor=actor)
    await _close(conn, date(2030, 2, 12))
    await _day(conn, date(2030, 2, 13))

    with pytest.raises(HTTPException) as exc:
        async with conn.transaction():
            await fa.assign(conn, fa.DRIVER, driver, b, actor=actor, effective=date(2030, 2, 12))
    assert exc.value.status_code == 409
    assert "12/02 ya está cerrado" in exc.value.detail
    assert str(await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid)", driver)) == a

    # El día siguiente al cerrado sí se puede.
    await fa.assign(conn, fa.DRIVER, driver, b, actor=actor)
    assert str(await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid)", driver)) == b


async def test_a5_the_closure_roster_of_a_past_day_uses_that_days_carrier(conexion_revertida):
    """Transferido el 20: el roster del 19 lo tiene en A y el del 20 en B. Antes las dos
    respuestas eran B (la empresa de hoy), y el 19 salía MISMATCH contra sus viajes de A."""
    conn = conexion_revertida
    actor = await _actor(conn)
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 3, 1))
    await fa.assign(conn, fa.ASSET, await _tractor(conn), a, actor=actor)
    await fa.assign(conn, fa.ASSET, await _tractor(conn), b, actor=actor)
    await fa.assign(conn, fa.DRIVER, driver, a, actor=actor)
    await _day(conn, date(2030, 3, 20))
    await fa.assign(conn, fa.DRIVER, driver, b, actor=actor)

    async def home(d: date):
        return await conn.fetchval(
            f"WITH {tractoreo_roster_cte('$2::date')} "
            "SELECT home_carrier_id::text FROM active_roster WHERE driver_id = $1::uuid", driver, d)

    assert await home(date(2030, 3, 19)) == a
    assert await home(date(2030, 3, 20)) == b


async def test_a7_add_and_end_a_client_with_dates(conexion_revertida):
    conn = conexion_revertida
    actor = await _actor(conn)
    carrier = await _carrier(conn)
    shipper = str(await conn.fetchval(
        "INSERT INTO public.shippers (name, status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Cliente {uuid.uuid4().hex[:6]}"))
    await _day(conn, date(2030, 4, 1))
    await fa.assign(conn, fa.SHIPPER, shipper, carrier, actor=actor)
    await _day(conn, date(2030, 4, 15))
    await fa.end(conn, fa.SHIPPER, shipper, carrier, actor=actor)

    row = await conn.fetchrow(
        "SELECT status, start_date, end_date FROM public.carrier_shippers WHERE carrier_id = $1 AND shipper_id = $2",
        carrier, shipper)
    assert (row["status"], row["start_date"], row["end_date"]) == ("INACTIVE", date(2030, 4, 1), date(2030, 4, 15))
    period = await conn.fetchval(
        "SELECT valid_during::text FROM app.fleet_assignment_periods "
        "WHERE relation = 'CARRIER_SHIPPER' AND subject_id = $1 AND counterpart_id = $2", carrier, shipper)
    assert period == "[2030-04-01,2030-04-15)"
    listed = await fa.list_shippers(conn, carrier)
    assert [(str(r["id"]), r["status"]) for r in listed] == [(shipper, "INACTIVE")]


async def test_a8_deactivation_impact_counts_the_fleet(conexion_revertida):
    conn = conexion_revertida
    actor = await _actor(conn)
    carrier = await _carrier(conn)
    for _ in range(2):
        await fa.assign(conn, fa.DRIVER, await _driver(conn), carrier, actor=actor)
    await fa.assign(conn, fa.ASSET, await _tractor(conn), carrier, actor=actor)

    impact = await fa.deactivation_impact(conn, carrier)

    assert (impact["drivers"], impact["assets"], impact["trips_today"]) == (2, 1, 0)
    assert impact["open_closure_days"] >= 0


# A9 (reactivar eligiendo la flota que vuelve) se mudó con la acción a
# services/lifecycle.py: test_lifecycle_integration.py, la heredada del padrón viejo.


async def test_a10_the_monitor_mismatch_uses_the_carrier_of_the_trip_day(conexion_revertida):
    """El conductor manejó para A el 10 y fue transferido a B el 20: su viaje del 10 con
    empresa A no es MISMATCH (antes sí, porque se comparaba con la empresa de hoy). Un
    viaje del 21 con empresa A sí lo es."""
    from app.routers.trips import _FLEET_MATCH_CASE

    conn = conexion_revertida
    actor = await _actor(conn)
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 5, 1))
    await fa.assign(conn, fa.DRIVER, driver, a, actor=actor)
    await _day(conn, date(2030, 5, 20))
    await fa.assign(conn, fa.DRIVER, driver, b, actor=actor)

    async def status_of_trip_on(d: date) -> str:
        trip = await conn.fetchval(
            "INSERT INTO app.trips (id, planning_date, source_system, source_system_trip_id, trip_status, "
            "is_active, is_assigned, fleet) VALUES (gen_random_uuid(), $1, 'qanalytics', $2, 'RUTA', true, true, "
            "'{}'::jsonb) RETURNING id", d, f"{PREFIX}-{uuid.uuid4().hex[:8]}")
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, carrier_id, driver_id, link_source) "
            "VALUES ($1, $2, $3::uuid, 'manual')", trip, a, driver)
        return await conn.fetchval(
            f"SELECT {_FLEET_MATCH_CASE} FROM app.trips t "
            "LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id "
            "JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id WHERE t.id = $1", trip)

    assert await status_of_trip_on(date(2030, 5, 10)) == "MATCHED"
    assert await status_of_trip_on(date(2030, 5, 21)) == "MISMATCH"


async def test_a2b_with_today_closed_a_change_without_date_starts_tomorrow(conexion_revertida):
    """Firmar hoy no deja a la flota sin poder moverse: el cambio empieza mañana."""
    conn = conexion_revertida
    actor = await _actor(conn)
    a, b, driver = await _carrier(conn), await _carrier(conn), await _driver(conn)
    await _day(conn, date(2030, 6, 10))
    await fa.assign(conn, fa.DRIVER, driver, a, actor=actor)
    await _close(conn, date(2030, 6, 10))

    await fa.assign(conn, fa.DRIVER, driver, b, actor=actor)

    assert str(await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid, '2030-06-10')", driver)) == a
    assert str(await conn.fetchval("SELECT app.carrier_of('DRIVER', $1::uuid, '2030-06-11')", driver)) == b
