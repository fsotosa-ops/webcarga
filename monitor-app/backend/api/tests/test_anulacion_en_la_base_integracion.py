"""La anulación en la base: columnas, su CHECK y trips_del_dia (spec 2026-10-10 anulación, §2)."""
from __future__ import annotations

import uuid
from datetime import date

import asyncpg
import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from tests.conftest import PoolDeUnaConexion, _usuario_real, cliente_de_prueba

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 3)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=DIA.isoformat(), client_name=await cliente_de_prueba(conn),
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


async def test_trips_del_dia_excluye_los_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    del_dia = "SELECT $2::uuid IN (SELECT trip_id FROM app.trips_del_dia($1))"
    assert await conn.fetchval(del_dia, DIA, tid) is True

    await conn.execute(
        "UPDATE app.trips SET voided_at = now(), voided_by = $2::uuid, void_reason_id = "
        "(SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' AND code = 'DUPLICADO') "
        "WHERE id = $1::uuid",
        tid, usuario["sub"])

    assert await conn.fetchval(del_dia, DIA, tid) is False


@pytest.mark.parametrize("tabla", ["app.trips", "app.trips_manual"])
async def test_la_anulacion_va_completa_o_no_va(conexion_revertida, tabla):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute(f"UPDATE {tabla} SET voided_at = now() WHERE id = $1::uuid", tid)
