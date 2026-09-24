"""Eliminar viajes manuales contra la base real.

En producción no hay FK hacia app.trips: lo que "limpia" un borrado es sólo
lo que el servicio borra a mano. Por eso esto no se puede probar con mocks.
Todo corre dentro de la transacción revertida de `conexion_revertida`, y cada
test crea su propio viaje con el endpoint real.
"""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip, get_trip
from app.services.eliminar_viajes import eliminar_viajes_manuales
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

DIA_LEJANO = date(2099, 1, 1)


async def _viaje_manual(conn, usuario, fecha="2026-09-23") -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=fecha,
            client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"),
                   TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn),
        user=usuario,
    )
    tid = str(viaje["id"])
    await conn.execute(
        "INSERT INTO app.trip_notes (trip_id, author_id, body, note_type) VALUES ($1, $2::uuid, 'nota', 'observacion')",
        tid, usuario["sub"])
    return tid


async def _restos(conn, tid: str) -> dict:
    return {
        tabla: await conn.fetchval(f"SELECT count(*) FROM {tabla} WHERE {col} = $1::uuid", tid)
        for tabla, col in [
            ("app.trips", "id"), ("app.trips_manual", "id"), ("app.trip_stops", "trip_id"),
            ("app.trip_fleet_links", "trip_id"), ("app.trip_notes", "trip_id"),
            ("app.closure_lines", "subject_id"),
        ]
    }


def _otro(usuario: dict, rol: str) -> dict:
    return {"sub": str(uuid.uuid4()), "email": "otro@webcarga.cl", "role": rol}


async def test_quien_lo_creo_lo_elimina_sin_dejar_restos(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario))["can_delete"] is True

    await eliminar_viajes_manuales(conn, [tid], usuario)

    assert set((await _restos(conn, tid)).values()) == {0}
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='delete'",
        tid) == 1


async def test_otro_writer_no_puede_y_un_admin_si(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    writer = _otro(usuario, "writer")

    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=writer)
    assert detalle["can_delete"] is False
    with pytest.raises(HTTPException) as err:
        await eliminar_viajes_manuales(conn, [tid], writer)
    assert err.value.status_code == 403
    assert (await _restos(conn, tid))["app.trips"] == 1

    await eliminar_viajes_manuales(conn, [tid], {**_otro(usuario, "admin"), "sub": usuario["sub"]})
    assert (await _restos(conn, tid))["app.trips"] == 0


async def test_un_viaje_del_tms_no_se_elimina(conexion_revertida):
    conn = conexion_revertida
    tms = str(await conn.fetchval("SELECT id FROM app.trips WHERE source_system <> 'manual' LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await eliminar_viajes_manuales(conn, [tms], {"sub": str(uuid.uuid4()), "role": "owner"})
    assert err.value.status_code == 409
    assert await conn.fetchval("SELECT count(*) FROM app.trips WHERE id = $1::uuid", tms) == 1


async def test_un_viaje_de_un_dia_firmado_no_se_elimina(conexion_revertida):
    """"Ocupó un día firmado" es app.trips_del_dia(D) con D CLOSED: la misma
    definición con que el cierre cuenta los viajes. La primera versión miraba
    closure_lines TRIP, que en producción no existen, y este test pasaba
    porque fabricaba una. Ahora no se fabrica nada: se firma un día y basta."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario, fecha=DIA_LEJANO.isoformat())
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) "
        "VALUES ($1, 'CLOSED', $2::uuid, now())", DIA_LEJANO, usuario["sub"])

    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert detalle["can_delete"] is False
    assert "01/01" in detalle["delete_blocked_reason"]
    with pytest.raises(HTTPException) as err:
        await eliminar_viajes_manuales(conn, [tid], usuario)
    assert err.value.status_code == 409
    assert (await _restos(conn, tid))["app.trips"] == 1


async def test_el_mismo_viaje_con_el_dia_abierto_si_se_elimina(conexion_revertida):
    """El control del anterior: sin firmar el día, se puede."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario, fecha=DIA_LEJANO.isoformat())
    await conn.execute("INSERT INTO app.closure_periods (business_date) VALUES ($1)", DIA_LEJANO)

    await eliminar_viajes_manuales(conn, [tid], usuario)
    assert (await _restos(conn, tid))["app.trips"] == 0


async def test_un_lote_con_un_viaje_invalido_no_elimina_ninguno(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    bueno = await _viaje_manual(conn, usuario)
    inexistente = str(uuid.uuid4())

    with pytest.raises(HTTPException) as err:
        await eliminar_viajes_manuales(conn, [bueno, inexistente], usuario)

    assert err.value.status_code == 404
    assert [e["trip_id"] for e in err.value.detail["errors"]] == [inexistente]
    assert (await _restos(conn, bueno))["app.trips"] == 1
