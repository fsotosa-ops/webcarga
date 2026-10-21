"""El tipo de operación de un viaje (plan 2026-10-21, levantamiento con Operaciones).

La regla vive en app.v_trip_fleet_resolution: lo declarado por Operaciones, después el
cliente si trabaja con un solo tipo, después el tracto. Los casos de abajo están
escritos a mano a propósito: un error en la vista no puede pasar el test."""
from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from app.services import pre_cierre, trip_operation_type

from .conftest import _usuario_real

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-12")
PREFIX = "ZZ-TEST-OPTYPE"


async def _type_id(conn, code: str) -> str:
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND code = $1", code))


async def _shipper(conn, types: list[str] | None) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.shippers (name, status, operation_types) VALUES ($1, 'ACTIVE', $2) RETURNING id",
        f"{PREFIX} Cliente {uuid.uuid4().hex[:6]}", types))


async def _tractor(conn, code: str | None) -> str:
    type_id = await _type_id(conn, code) if code else None
    return str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2::uuid) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", type_id))


async def _trip(conn, shipper_id: str | None, tractor_id: str | None = None) -> str:
    """Un viaje del día D. Sin tracto, como un Sodimac sin patente: sin vínculo."""
    trip_id = uuid.uuid4()
    await conn.execute(
        "INSERT INTO app.trips (id, planning_date, client_name, source_system, source_system_trip_id, "
        "trip_status, status_reported_at, is_active, is_assigned, shipper_id) "
        "VALUES ($1, $2, 'X', 'manual', $3, 'Asignado', $4, true, true, $5::uuid)",
        trip_id, D, f"{PREFIX}-{trip_id.hex[:6]}", datetime(D.year, D.month, D.day, 12), shipper_id)
    if tractor_id:
        await conn.execute(
            "INSERT INTO app.trip_fleet_links (trip_id, tractor_asset_id, link_source) VALUES ($1, $2::uuid, 'manual')",
            trip_id, tractor_id)
    return str(trip_id)


async def _resolved(conn, trip_id: str):
    return await conn.fetchrow(
        "SELECT t.code, vfr.operation_type_source AS source, vfr.operation_type_conflict AS conflict "
        "FROM app.v_trip_fleet_resolution vfr "
        "LEFT JOIN app.status_taxonomies t ON t.id = vfr.resolved_operation_type_id WHERE vfr.trip_id = $1::uuid",
        trip_id)


# (tipos del cliente, tipo del tracto o None = sin tracto, declarado) → (código, origen, conflicto)
CASES = [
    # Sodimac sin patente: el cliente trabaja solo con Equipo Completo.
    (["EQUIPO_COMPLETO"], "none", None, ("EQUIPO_COMPLETO", "client", False)),
    # Iansa con un tracto de Equipo Completo: coinciden, sin conflicto.
    (["EQUIPO_COMPLETO"], "EQUIPO_COMPLETO", None, ("EQUIPO_COMPLETO", "client", False)),
    # Iansa con un tracto registrado como Tractoreo: cuenta el cliente y se avisa.
    (["EQUIPO_COMPLETO"], "TRACTOREO", None, ("EQUIPO_COMPLETO", "client", True)),
    # Walmart (los dos tipos): manda el tracto.
    (["TRACTOREO", "EQUIPO_COMPLETO"], "TRACTOREO", None, ("TRACTOREO", "tractor", False)),
    (["TRACTOREO", "EQUIPO_COMPLETO"], "EQUIPO_COMPLETO", None, ("EQUIPO_COMPLETO", "tractor", False)),
    # Walmart sin tracto: no se sabe.
    (["TRACTOREO", "EQUIPO_COMPLETO"], "none", None, (None, None, False)),
    # Cliente sin definir (HBC) con tracto: manda el tracto; sin tracto, nada.
    (None, "EQUIPO_COMPLETO", None, ("EQUIPO_COMPLETO", "tractor", False)),
    (None, "none", None, (None, None, False)),
    # Tracto sin tipo y cliente sin definir: nada.
    (None, "untyped", None, (None, None, False)),
    # Lo declarado gana sobre el cliente y sobre el tracto, y no es conflicto.
    (["EQUIPO_COMPLETO"], "TRACTOREO", "TRACTOREO", ("TRACTOREO", "declared", False)),
    (None, "none", "TRACTOREO", ("TRACTOREO", "declared", False)),
]


@pytest.mark.parametrize("client_types,tractor,declared,expected", CASES)
async def test_la_regla_del_tipo_del_viaje(conexion_revertida, client_types, tractor, declared, expected):
    conn = conexion_revertida
    shipper = await _shipper(conn, client_types)
    tractor_id = None if tractor == "none" else await _tractor(conn, None if tractor == "untyped" else tractor)
    trip = await _trip(conn, shipper, tractor_id)
    if declared:
        actor = (await _usuario_real(conn))["sub"]
        await trip_operation_type.declare(conn, trip, await _type_id(conn, declared), note=None, actor=actor)

    row = await _resolved(conn, trip)
    assert (row["code"], row["source"], row["conflict"]) == expected


async def test_quitar_lo_declarado_vuelve_al_cliente(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    trip = await _trip(conn, await _shipper(conn, ["EQUIPO_COMPLETO"]))
    await trip_operation_type.declare(conn, trip, await _type_id(conn, "TRACTOREO"), note="Spot", actor=actor)
    assert await trip_operation_type.clear(conn, trip, actor=actor) is True
    row = await _resolved(conn, trip)
    assert (row["code"], row["source"]) == ("EQUIPO_COMPLETO", "client")
    acciones = [r["action"] for r in await conn.fetch(
        "SELECT action FROM public.audit_log WHERE entity_type = 'TRIP' AND entity_id = $1::uuid ORDER BY id", trip)]
    assert acciones == ["declare_operation_type", "clear_operation_type"]


async def test_declarar_un_tipo_que_no_es_de_operacion_es_422(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    trip = await _trip(conn, None)
    otro = str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain <> 'WEBCARGA_OPERATION_TYPE' LIMIT 1"))
    with pytest.raises(HTTPException) as exc:
        await trip_operation_type.declare(conn, trip, otro, note=None, actor=actor)
    assert exc.value.status_code == 422


async def test_el_conflicto_se_avisa_en_el_pre_cierre(conexion_revertida):
    """P5 de Operaciones: el viaje cuenta con el tipo del cliente y el pre-cierre avisa."""
    conn = conexion_revertida
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date LANGUAGE sql STABLE AS $$ SELECT DATE '2026-06-12' $$")
    tractor = await _tractor(conn, "TRACTOREO")
    trip = await _trip(conn, await _shipper(conn, ["EQUIPO_COMPLETO"]), tractor)

    avisos = (await pre_cierre.avisos_del_dia(conn, D))["escalations"]["OPERATION_TYPE_CONFLICT"]

    suyo = [a for a in avisos if any(t["id"] == trip for t in a["trips"])]
    assert len(suyo) == 1
    assert suyo[0]["scope"] == "equipo_completo"
    assert suyo[0]["tractor_type"] != suyo[0]["client_type"]


async def test_el_cliente_no_acepta_un_arreglo_vacio_ni_valores_fuera_del_catalogo(conexion_revertida):
    import asyncpg
    for malo in ([], ["Equipo Completo"], ["TRACTOREO", "TRACTOREO"]):
        with pytest.raises(asyncpg.CheckViolationError):
            async with conexion_revertida.transaction():
                await _shipper(conexion_revertida, malo)
