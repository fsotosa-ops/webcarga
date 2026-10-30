"""Cierre: los viajes "por regularizar" (reunión del 30/10).

Todo viaje con datos incompletos —sin asignar, asignado con tracto, conductor o
empresa faltante, o con la empresa distinta a la del conductor—, del día o pendiente
de los 45 días anteriores, cae en "Por regularizar" y bloquea la firma hasta que el
coordinador complete la asignación o declare que no se tomará. Antes eran tres grupos
de la pestaña Viajes ("hoy", "rezago", "asignación incompleta") que no bloqueaban, y
la empresa faltante ("asignado a WebCarga") no se veía.

Contra Postgres, dentro de la transacción revertida de `conexion_revertida`, en un día
lejano (2099) para que ningún viaje real entre en la ventana.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.routers.trips import bulk_close_trips, cierre_viajes
from app.schemas.trip import TripBulkCloseBody
from app.services import cierre_lineas
from app.services.cierre_viajes import HORIZONTE_DIAS, SQL_GRUPOS_CIERRE
from tests import d1_subjects as s
from tests.conftest import ADMIN_EQUIVALENTE, PoolDeUnaConexion, _usuario_real, con_roles

pytestmark = pytest.mark.integracion

DAY = date(2099, 1, 20)
OPEN_STATUS = "RUTA"
CLOSED_STATUS = "CERRADO FINALIZADO"


async def insert_trip(conn, *, planning_date: date, status: str = OPEN_STATUS, is_active: bool = True,
                      is_assigned: bool = True, source_system: str = "qanalytics", fleet: str = "{}") -> uuid.UUID:
    trip_id = uuid.uuid4()
    await conn.execute(
        """
        INSERT INTO app.trips (id, source_system, planning_date, client_name, source_system_trip_id,
                               trip_status, fleet, status_reported_at, is_active, is_assigned)
        VALUES ($1, $2, $3, 'TEST-POR-REGULARIZAR', $4, $5, $6::jsonb, now(), $7, $8)
        """,
        trip_id, source_system, planning_date, str(trip_id), status, fleet, is_active, is_assigned)
    return trip_id


async def link(conn, trip_id: uuid.UUID, *, tractor: str | None, driver: str | None,
               carrier: str | None = None) -> None:
    """El vínculo como lo deja la resolución: la empresa del viaje es la del tracto
    (o la del conductor, si no hay tracto). `carrier` la fuerza."""
    if carrier is None:
        carrier = await conn.fetchval(
            "SELECT COALESCE(app.carrier_of('ASSET', $1::uuid, $3::date), app.carrier_of('DRIVER', $2::uuid, $3::date))",
            tractor, driver, DAY)
    await conn.execute(
        """
        INSERT INTO app.trip_fleet_links (trip_id, tractor_asset_id, driver_id, carrier_id, link_source)
        VALUES ($1, $2, $3, $4, 'manual')
        ON CONFLICT (trip_id) DO UPDATE
            SET tractor_asset_id = EXCLUDED.tractor_asset_id, driver_id = EXCLUDED.driver_id,
                carrier_id = EXCLUDED.carrier_id, link_source = 'manual'
        """,
        trip_id, tractor, driver, carrier)


async def coherent_fleet(conn) -> tuple[str, str, str]:
    """Una empresa con un tracto y un conductor suyos: un viaje con los dos está completo."""
    carrier = await s.carrier(conn, status="ACTIVE")
    return carrier, await s.asset(conn, carrier), await s.driver(conn, carrier)


async def groups(conn, day: date = DAY) -> dict:
    return {r["trip_id"]: r for r in await conn.fetch(SQL_GRUPOS_CIERRE, day)}


async def to_regularize(conn, day: date = DAY) -> dict:
    response = await cierre_viajes(fecha=day.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    return {v["trip_id"]: v for v in response["grupos"]["por_regularizar"]} | {"_bloquean": response["bloquean"]}


# ── Qué entra ─────────────────────────────────────────────────────────────────


async def test_a_day_trip_with_a_tractor_and_no_driver_is_to_regularize(conexion_revertida):
    conn = conexion_revertida
    _, tractor, _ = await coherent_fleet(conn)
    trip_id = await insert_trip(conn, planning_date=DAY, fleet='{"driver_name_tms": "ZZ PEREZ SOTO JUAN"}')
    await link(conn, trip_id, tractor=tractor, driver=None)

    rows = await to_regularize(conn)
    entry = rows[str(trip_id)]
    assert entry["missing_fleet"] == ["driver"]
    # El nombre que informó el TMS viaja aparte: con él se busca a la persona.
    assert entry["driver_name_tms"] == "ZZ PEREZ SOTO JUAN"
    assert rows["_bloquean"] >= 1


async def test_completing_the_fleet_takes_it_out(conexion_revertida):
    conn = conexion_revertida
    _, tractor, driver = await coherent_fleet(conn)
    trip_id = await insert_trip(conn, planning_date=DAY)
    await link(conn, trip_id, tractor=tractor, driver=None)
    assert (await groups(conn))[trip_id]["grupo"] == "por_regularizar"

    await link(conn, trip_id, tractor=tractor, driver=driver)
    assert trip_id not in await groups(conn)


async def test_a_tms_placeholder_is_not_a_driver_name(conexion_revertida):
    """"POR CONFIRMAR /" es la forma del TMS de decir "todavía no hay": no se ofrece
    emparejarlo ni darlo de alta (catálogo TMS_PLACEHOLDER_DRIVER_NAME, app.tms_driver_name)."""
    conn = conexion_revertida
    _, tractor, _ = await coherent_fleet(conn)
    trip_id = await insert_trip(conn, planning_date=DAY, fleet='{"driver_name_tms": "POR CONFIRMAR /"}')
    await link(conn, trip_id, tractor=tractor, driver=None)

    entry = (await to_regularize(conn))[str(trip_id)]
    assert entry["missing_fleet"] == ["driver"]
    assert entry["driver_name_tms"] is None
    assert entry["driver_name"] is None


async def test_assigned_to_webcarga_without_a_third_party_is_missing_the_carrier(conexion_revertida):
    """El TMS dice asignado, pero a WebCarga: no hay tracto, conductor ni empresa del Directorio."""
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, source_system="sodimac",
                                fleet='{"transporter_name_tms": "WebCarga SpA"}')
    row = (await groups(conn))[trip_id]
    assert row["grupo"] == "por_regularizar"
    assert sorted(row["missing_fleet"]) == ["carrier", "driver", "tractor"]


async def test_unassigned_active_trips_of_the_day_and_from_before_are_to_regularize(conexion_revertida):
    conn = conexion_revertida
    of_the_day = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    from_before = await insert_trip(conn, planning_date=DAY - timedelta(days=3), is_assigned=False)
    found = await groups(conn)
    assert found[of_the_day]["grupo"] == "por_regularizar"
    assert found[from_before]["grupo"] == "por_regularizar"


async def test_a_finished_trip_from_before_within_the_horizon_is_to_regularize(conexion_revertida):
    """Decisión del 30/10: el día y los pendientes anteriores. Antes un viaje cerrado de
    otro día con la flota incompleta no aparecía en ninguna parte (Sodimac del 28/10)."""
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=2), status=CLOSED_STATUS, is_active=False)
    assert (await groups(conn))[trip_id]["grupo"] == "por_regularizar"
    assert str(trip_id) in await to_regularize(conn)


async def test_beyond_the_horizon_does_not_appear(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=HORIZONTE_DIAS + 1),
                                status=CLOSED_STATUS, is_active=False)
    assert trip_id not in await groups(conn)


async def test_a_driver_from_another_carrier_is_to_regularize(conexion_revertida):
    """El MISMATCH de Tractoreo, dicho por el viaje: el tracto es de una empresa y el
    conductor de otra."""
    conn = conexion_revertida
    _, tractor, _ = await coherent_fleet(conn)
    _, _, other_driver = await coherent_fleet(conn)
    trip_id = await insert_trip(conn, planning_date=DAY)
    await link(conn, trip_id, tractor=tractor, driver=other_driver)

    row = (await groups(conn))[trip_id]
    assert row["grupo"] == "por_regularizar"
    assert row["carrier_mismatch"] is True
    assert list(row["missing_fleet"]) == []


async def test_the_row_says_its_scope(conexion_revertida):
    """La tarjeta se filtra por alcance: un viaje declarado de Equipo Completo lo dice."""
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    equipo_completo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND code = 'EQUIPO_COMPLETO'")
    await conn.execute("INSERT INTO app.trip_operation_types (trip_id, operation_type_id) VALUES ($1, $2)",
                       trip_id, equipo_completo)
    assert (await to_regularize(conn))[str(trip_id)]["scope"] == "equipo_completo"


# ── Qué no entra ──────────────────────────────────────────────────────────────


async def test_not_a_load_voided_declared_or_removed_does_not_appear(conexion_revertida):
    conn = conexion_revertida
    not_a_load = await conn.fetchval("SELECT id FROM app.trip_statuses WHERE counts_as_load = false LIMIT 1")
    cancelled = await insert_trip(conn, planning_date=DAY, status=not_a_load, is_active=False) if not_a_load else None
    voided = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    await conn.execute(
        "UPDATE app.trips SET voided_at = now(), voided_by = $2, "
        "void_reason_id = (SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' LIMIT 1) "
        "WHERE id = $1", voided, (await _usuario_real(conn))["sub"])
    removed = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    await conn.execute(
        "UPDATE app.trips SET tms_missing_since = now(), tms_absence_kind = 'eliminado' WHERE id = $1", removed)

    found = await groups(conn)
    for trip_id in filter(None, (cancelled, voided, removed)):
        assert trip_id not in found or found[trip_id]["grupo"] != "por_regularizar"


async def test_no_se_tomara_el_viaje_takes_it_out(conexion_revertida):
    """"No se tomará el viaje" es el bulk-close que ya existe: motivo y fuera de la lista."""
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    reason = await conn.fetchval(
        "SELECT id::text FROM app.status_taxonomies WHERE domain = 'TRIP_UNASSIGNED_REASON' LIMIT 1")
    user = await _usuario_real(conn)
    await bulk_close_trips(TripBulkCloseBody(trip_ids=[str(trip_id)], unassigned_reason_id=reason),
                           pool=PoolDeUnaConexion(conn), user=user)
    assert str(trip_id) not in await to_regularize(conn)


# ── La firma ──────────────────────────────────────────────────────────────────


async def test_signing_is_blocked_and_the_409_names_the_trips(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    with pytest.raises(HTTPException) as exc:
        await cierre_lineas.cerrar(PoolDeUnaConexion(conn), DAY, override=False, override_note=None,
                                   user=await _usuario_real(conn))
    assert exc.value.status_code == 409
    assert str(trip_id) in {v["trip_id"] for v in exc.value.detail["por_regularizar"]}
    assert "por regularizar" in exc.value.detail["message"]


async def test_the_override_signs_and_leaves_a_trace_per_trip(conexion_revertida):
    conn = conexion_revertida
    trip_id = await insert_trip(conn, planning_date=DAY, is_assigned=False)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    result = await cierre_lineas.cerrar(PoolDeUnaConexion(conn), DAY, override=True,
                                        override_note="se fuerza", user=admin)
    assert result["overridden"] > 0
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'TRIP' AND entity_id = $1 "
        "AND action = 'cierre_override'", trip_id) == 1


# ── Lo que ya valía ───────────────────────────────────────────────────────────


async def test_waiting_for_tms_closure_is_completed_first(conexion_revertida):
    """Un Sodimac en Control de salida con solo la rampla primero se completa
    (minuta 09/10 §2.3); recién completo pasa a "Espera cierre del TMS"."""
    conn = conexion_revertida
    waiting = await conn.fetchval(
        "SELECT id FROM app.trip_statuses WHERE group_id = 'pendiente_cierre_tms' ORDER BY id LIMIT 1")
    if waiting is None:
        pytest.skip("ningún estado del catálogo está en el grupo pendiente_cierre_tms")
    _, tractor, driver = await coherent_fleet(conn)
    trip_id = await insert_trip(conn, planning_date=DAY - timedelta(days=1), status=waiting, source_system="sodimac",
                                fleet='{"trailer_plate": "ZZZZ98"}')
    assert (await groups(conn))[trip_id]["grupo"] == "por_regularizar"

    await link(conn, trip_id, tractor=tractor, driver=driver)
    assert (await groups(conn))[trip_id]["grupo"] == "pendiente_cierre_tms"


async def test_rows_carry_the_resolved_entity_ids(conexion_revertida):
    """La vista rápida (HU 20261011/01) abre la entidad por su id: la fila los trae
    resueltos contra el directorio, o null si no hay."""
    conn = conexion_revertida
    _, tractor, _ = await coherent_fleet(conn)
    linked = await insert_trip(conn, planning_date=DAY)
    await link(conn, linked, tractor=tractor, driver=None)
    bare = await insert_trip(conn, planning_date=DAY)

    response = await cierre_viajes(fecha=DAY.isoformat(), pool=PoolDeUnaConexion(conn), _=None)
    rows = {v["trip_id"]: v for group in response["grupos"].values() for v in group}

    assert rows[str(linked)]["tractor_asset_id"] == tractor
    assert rows[str(linked)]["driver_id"] is None
    assert (rows[str(bare)]["carrier_id"], rows[str(bare)]["driver_id"], rows[str(bare)]["tractor_asset_id"]) == (
        None, None, None)
