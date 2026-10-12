"""Activo y asignado del viaje: una sola definición en la base (spec 2026-10-11,
trip-assignment-in-the-database). La migración ya está aplicada: los tests leen
las funciones y los triggers vivos. No se re-ejecuta (revisión final D1, I2):
su DROP TRIGGER toma un ACCESS EXCLUSIVE sobre app.trip_fleet_links hasta el
ROLLBACK y la API viva de dev esperaba detrás."""
from __future__ import annotations

import asyncio
import json
import uuid
from datetime import date

import pytest

from app.routers import trips as trips_router
from app.routers.trips import (
    TripCreateBody, TripPatch, TripStopCreate, assign_fleet_link, create_trip, patch_trip, remove_fleet_link,
    reset_field,
)
from app.services.cierre_viajes import SQL_GRUPOS_CIERRE
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba, credenciales_integracion
from tests.d1_subjects import make_test_fleet

pytestmark = pytest.mark.integracion

TEST_DATE = date(2099, 1, 15)


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
    """Un conductor activo de una empresa activa y habilitada, creado por el
    test (D1 Task 8). Antes era el primer conductor activo de producción, y su
    empresa podía estar de baja: la guarda de asignación respondía 409."""
    return (await make_test_fleet(conn, enabled=True))["driver"]


async def link_driver(conn, trip_id: str) -> None:
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, link_source) VALUES ($1::uuid, $2::uuid, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, link_source = 'manual'",
        trip_id, await any_driver_id(conn))


async def is_assigned(conn, trip_id: str) -> bool:
    return await conn.fetchval("SELECT is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)


async def test_is_trip_open(conexion_revertida):
    conn = conexion_revertida
    assert await conn.fetchval("SELECT app.is_trip_open('CERRADO FINALIZADO')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('Declinada')") is False
    assert await conn.fetchval("SELECT app.is_trip_open('ORIGEN')") is True
    assert await conn.fetchval("SELECT app.is_trip_open(NULL)") is None


async def test_is_trip_assigned_reads_fleet_and_link(conexion_revertida):
    conn = conexion_revertida
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
    trip_id = await insert_tms_trip(conn, "Publicada", {"tractor_plate": "ZZZZ99"})
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is False


async def test_linking_a_driver_assigns_in_the_same_transaction(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    assert await is_assigned(conn, trip_id) is False
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is True


async def test_removing_link_unassigns(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_tms_trip(conn, await open_status(conn), {})
    await link_driver(conn, trip_id)
    assert await is_assigned(conn, trip_id) is True
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1::uuid", trip_id)
    assert await is_assigned(conn, trip_id) is False


async def test_manual_override_is_respected(conexion_revertida):
    conn = conexion_revertida
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
    trip_id = await create_manual_trip(conn, "CERRADO FINALIZADO", "ZZZZ99")
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (False, True)
    # Ya no aparece como no asignado ("Del día"/"Rezago"). Su patente y su
    # conductor no están en el directorio, así que puede figurar como asignación
    # incompleta (minuta 09/10 §2.4), que es lo correcto.
    group = {str(r["trip_id"]): r["grupo"] for r in await conn.fetch(SQL_GRUPOS_CIERRE, TEST_DATE)}.get(trip_id)
    assert group not in ("hoy", "rezago")


async def test_manual_trip_without_fleet_is_born_active_and_unassigned(conexion_revertida):
    conn = conexion_revertida
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    row = await conn.fetchrow("SELECT is_active, is_assigned FROM app.trips WHERE id = $1::uuid", trip_id)
    assert (row["is_active"], row["is_assigned"]) == (True, False)


async def test_linking_driver_via_endpoint_assigns_immediately(conexion_revertida):
    conn = conexion_revertida
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    pool = PoolDeUnaConexion(conn)
    user = await _usuario_real(conn)
    await assign_fleet_link(trip_id, {"driver_id": await any_driver_id(conn)}, pool=pool, user=user)
    assert await is_assigned(conn, trip_id) is True
    await remove_fleet_link(trip_id, pool=pool, user=user)
    assert await is_assigned(conn, trip_id) is False


async def test_patch_rolls_back_when_mirror_fails(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    trip_id = await create_manual_trip(conn, await open_status(conn), None)

    async def failing_mirror(_conn, _trip_id):
        raise RuntimeError("mirror failed")

    monkeypatch.setattr(trips_router, "_mirror_manual_trip", failing_mirror)
    with pytest.raises(RuntimeError, match="mirror failed"):
        await patch_trip(trip_id, TripPatch(comments="edición que no debe quedar"),
                         pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    assert await conn.fetchval("SELECT comments FROM app.trips WHERE id = $1::uuid", trip_id) is None


async def test_mirror_error_is_not_swallowed(conexion_revertida):
    """Sin el except: pass, un error de la copia llega a quien llama."""
    conn = conexion_revertida
    with pytest.raises(Exception):
        await trips_router._mirror_manual_trip(conn, "no-es-un-uuid")


async def test_resetting_the_override_recomputes_assignment(conexion_revertida):
    """Quitar el override de "Asignado" vuelve a la regla en el acto, no en la
    corrida siguiente de dbt (revisión final, spec 2026-10-11)."""
    conn = conexion_revertida
    trip_id = await insert_tms_trip(conn, await open_status(conn), {"tractor_plate": "ZZZZ99"})
    await conn.execute(
        "UPDATE app.trips SET is_assigned = false, manually_edited_fields = ARRAY['is_assigned'] "
        "WHERE id = $1::uuid", trip_id)
    await reset_field(trip_id, "is_assigned", pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    assert await is_assigned(conn, trip_id) is True


async def test_fleet_edit_locks_the_trip_before_the_link(conexion_revertida):
    """Mismo orden de bloqueo que la corrida de dbt (viaje y después vínculo):
    con el orden inverso, una edición y la ingesta sobre el mismo viaje se
    bloquean en cruz (deadlock; revisión final, spec 2026-10-11).

    Otra conexión retiene el viaje, como lo haría el MERGE de dbt. La edición
    debe quedar esperando el viaje SIN haber tomado el vínculo. Se usa un viaje
    viejo y cerrado, que la ingesta ya no toca, y nada se escribe: la otra
    conexión solo toma locks y la del test se revierte."""
    conn = conexion_revertida
    trip_id = str(await conn.fetchval(
        """
        SELECT t.id FROM app.trips t
        JOIN app.trip_fleet_links l ON l.trip_id = t.id
        WHERE t.planning_date < current_date - 60 AND t.voided_at IS NULL
          AND t.trip_status LIKE 'CERRADO%' AND t.source_system <> 'manual'
        ORDER BY t.planning_date LIMIT 1
        """))
    import asyncpg
    holder = await asyncpg.connect(**credenciales_integracion())
    try:
        holding = holder.transaction()
        await holding.start()
        await holder.execute("SELECT 1 FROM app.trips WHERE id = $1::uuid FOR UPDATE", trip_id)
        await conn.execute("SET LOCAL lock_timeout = '5s'")
        edit = asyncio.ensure_future(assign_fleet_link(
            trip_id, {"driver_id": await any_driver_id(conn)},
            pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn)))
        await asyncio.sleep(1.5)
        try:
            await holder.execute(
                "SELECT 1 FROM app.trip_fleet_links WHERE trip_id = $1::uuid FOR UPDATE NOWAIT", trip_id)
            link_was_free = True
        except asyncpg.exceptions.LockNotAvailableError:
            link_was_free = False
        await holding.rollback()
        await asyncio.wait_for(edit, timeout=10)
    finally:
        await holder.close()
    assert link_was_free, "la edición tomó el vínculo antes que el viaje (orden inverso al de dbt)"


async def test_editing_a_manual_trip_reaches_trips_manual(conexion_revertida):
    """La copia escribe de verdad: sin ella, la siguiente corrida de dbt
    reconstruye el viaje desde trips_manual y pisa la edición."""
    conn = conexion_revertida
    trip_id = await create_manual_trip(conn, await open_status(conn), None)
    await patch_trip(trip_id, TripPatch(comments="queda en trips_manual"),
                     pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    assert await conn.fetchval(
        "SELECT comments FROM app.trips_manual WHERE id = $1::uuid", trip_id) == "queda en trips_manual"
