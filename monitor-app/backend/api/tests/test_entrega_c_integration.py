"""Entrega C (docs/superpowers/plans/2026-10-14-entrega-c-fichas-y-limpieza.md): las listas del
Directorio, la ficha propia (historial y actividad) y el alcance de Configuración. C1-C4 y C8."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest

from app.services import fleet_assignments as fa
from app.services.directory_lists import directory_list
from app.services.entity_profile import activity, assignment_history
from tests import d1_subjects as s
from tests.conftest import _usuario_real

pytestmark = pytest.mark.integracion


async def test_c1_the_driver_list_filters_and_pages(conexion_revertida):
    conn = conexion_revertida
    carrier = await s.carrier(conn)
    name = f"{s.PREFIX} Lista {s.suffix()}"
    with_carrier = await s.driver(conn, carrier, name=f"{name} A")
    without_carrier = await s.driver(conn, None, name=f"{name} B")
    inactive = await s.driver(conn, carrier, status="INACTIVE", name=f"{name} C")

    every = await directory_list(conn, "DRIVER", q=name)
    assert {str(r["id"]) for r in every["rows"]} == {with_carrier, without_carrier, inactive}
    assert every["facets"]["without_carrier"] == 1 and every["facets"]["inactive"] == 1

    alone = await directory_list(conn, "DRIVER", q=name, flag="without_carrier")
    assert [str(r["id"]) for r in alone["rows"]] == [without_carrier] and alone["rows"][0]["carrier"] is None

    page = await directory_list(conn, "DRIVER", q=name, limit=2, offset=0)
    assert page["total"] == 3 and len(page["rows"]) == 2
    # Los activos primero.
    assert page["rows"][0]["operational_status"] == "ACTIVE"


async def test_c2_the_asset_list_filters_tractors_without_type(conexion_revertida):
    conn = conexion_revertida
    carrier = await s.carrier(conn)
    tractor = await s.asset(conn, carrier)
    await conn.execute("UPDATE public.assets SET webcarga_operation_type_id = NULL WHERE id = $1", tractor)
    plate = await conn.fetchval("SELECT license_plate FROM public.assets WHERE id = $1", tractor)

    result = await directory_list(conn, "ASSET", q=plate, flag="without_type")

    assert [str(r["id"]) for r in result["rows"]] == [tractor]
    assert result["rows"][0]["carrier"]["id"] == carrier


async def test_c2b_the_catalog_decides_what_a_tractor_is(conexion_revertida):
    """Sin valores fijos en el código: un tipo nuevo de unidad motriz cuenta como tracto."""
    from asyncpg.exceptions import ForeignKeyViolationError

    conn = conexion_revertida
    await conn.execute(
        "INSERT INTO public.asset_types (code, label, is_power_unit, sort_order) VALUES ('ZZ_MOTRIZ', 'ZZ', true, 99)")
    unit = await s.asset(conn, None, asset_type="ZZ_MOTRIZ")
    plate = await conn.fetchval("SELECT license_plate FROM public.assets WHERE id = $1", unit)

    result = await directory_list(conn, "ASSET", q=plate, flag="without_type")

    assert [str(r["id"]) for r in result["rows"]] == [unit]
    with pytest.raises(ForeignKeyViolationError):
        await s.asset(conn, None, asset_type="ZZ_NO_EXISTE")


async def test_c3_assignment_history_lists_periods_current_first(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    a, b, driver = await s.carrier(conn), await s.carrier(conn), await s.driver(conn, None)
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2030-07-01' $$")
    await fa.assign(conn, fa.DRIVER, driver, a, actor=actor)
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2030-07-20' $$")
    await fa.assign(conn, fa.DRIVER, driver, b, actor=actor)

    history = await assignment_history(conn, "DRIVER", driver)

    assert [(h["carrier_id"], h["current"]) for h in history] == [(b, True), (a, False)]
    assert history[1]["valid_from"] == date(2030, 7, 1) and history[1]["valid_until"] == date(2030, 7, 19)


async def test_c4_activity_counts_resolved_trips_and_skips_voided(conexion_revertida):
    conn = conexion_revertida
    carrier = await s.carrier(conn)
    driver = await s.driver(conn, carrier)
    today = await s.today(conn)

    async def trip(day: date, voided: bool = False):
        t = await conn.fetchval(
            "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
            "is_active, is_assigned, fleet, voided_at) VALUES (gen_random_uuid(), $1, 'ZZ Cliente', 'manual', $2, 'RUTA', "
            "true, true, '{}'::jsonb, $3) RETURNING id",
            day, f"ZZ-C-{uuid.uuid4().hex[:8]}", None)
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, driver_id, carrier_id, link_source) VALUES ($1, $2, $3, 'manual')",
            t, driver, carrier)
        if voided:
            # Una anulación completa: quién, cuándo y con qué motivo (ck_trips_void_complete).
            await conn.execute(
                "UPDATE app.trips SET voided_at = now(), voided_by = (SELECT id FROM auth.users LIMIT 1), "
                "void_reason_id = (SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' LIMIT 1) "
                "WHERE id = $1", t)

    await trip(today - timedelta(days=2))
    await trip(today - timedelta(days=10))
    await trip(today - timedelta(days=40))
    await trip(today - timedelta(days=1), voided=True)

    result = await activity(conn, "DRIVER", driver)

    assert result["trips_30d"] == 2
    assert result["last_trip_date"] == today - timedelta(days=2)
    assert result["last_trip_client"].startswith("ZZ Cliente")


async def test_c11_the_monitor_finds_the_trips_of_the_resolved_driver_by_rut(conexion_revertida):
    """"Ver viajes en el Monitor" busca por RUT: tiene que encontrar el viaje del conductor
    resuelto aunque el TMS haya escrito otro nombre y ningún RUT."""
    from app.routers.trips import list_trips
    from tests.conftest import PoolDeUnaConexion

    conn = conexion_revertida
    carrier = await s.carrier(conn)
    driver = await s.driver(conn, carrier)
    from app.utils.identity import rut_check_digit
    n = str(41_000_000 + uuid.uuid4().int % 1_000_000)
    rut = f"{n}-{rut_check_digit(n)}"
    await conn.execute("UPDATE public.drivers SET tax_id = $2 WHERE id = $1", driver, rut)
    trip = await conn.fetchval(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, trip_status, "
        "is_active, is_assigned, fleet) VALUES (gen_random_uuid(), public.hoy_chile(), 'ZZ Cliente', 'manual', $1, "
        "'RUTA', true, true, '{\"driver_name_tms\": \"OTRO NOMBRE\"}'::jsonb) RETURNING id",
        f"ZZ-C11-{uuid.uuid4().hex[:8]}")
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, carrier_id, link_source) VALUES ($1, $2, $3, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, carrier_id = EXCLUDED.carrier_id",
        trip, driver, carrier)

    res = await list_trips(pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn), q=rut.replace("-", ""),
                           view="historial", limit=50)

    assert str(trip) in {str(d["id"]) for d in res["data"]}


async def test_c8_the_reach_counts_only_active_fleet(conexion_revertida):
    from app.routers.requirements import SQL_CATALOGO

    conn = conexion_revertida
    requirement = await s.requirement(conn, entity="DRIVER")
    active_universe = await conn.fetchval(
        "SELECT count(*) FROM app.active_fleet af JOIN public.carriers c ON c.id = af.carrier_id "
        "AND c.operational_status = 'ACTIVE' WHERE af.entity_type = 'DRIVER'")
    every_driver = await conn.fetchval("SELECT count(*) FROM public.drivers")

    rows = {r["id"]: r for r in await conn.fetch(SQL_CATALOGO, "DRIVER", None)}

    assert rows[requirement]["universo"] == active_universe
    assert active_universe < every_driver
