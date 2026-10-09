"""En un viaje del TMS, Activo y Trabajando los define el TMS (09/10).

El 2065805 llegó CERRADO FINALIZADO por SAP y alguien encendió Activo y
Trabajando desde el detalle del Monitor. El trigger protect_manual_overrides
retira la marca de un viaje cerrado pero conservaba el valor, y dbt no lo
volvió a procesar: el Cierre lo mostraba "En curso". Decisión del usuario:
"todo depende de la tms, uno no hace esos cambios cuando viene de una tms".

Corre contra Postgres dentro de la transacción revertida: el viaje lo crea el
test y lo vuelve "del TMS" en la misma transacción.
"""
from __future__ import annotations

import uuid

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripPatch, TripStopCreate, create_trip, patch_trip
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


async def _viaje(conn, usuario, source_system: str) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date="2026-09-23",
            client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            current_status="CERRADO FINALIZADO",
            stops=[TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn),
        user=usuario,
    )
    await conn.execute(
        "UPDATE app.trips SET source_system = $2, is_active = false, is_working = false WHERE id = $1",
        viaje["id"], source_system)
    return viaje["id"]


async def _flags(conn, trip_id) -> dict:
    return dict(await conn.fetchrow(
        "SELECT is_active, is_working, manually_edited_fields FROM app.trips WHERE id = $1", trip_id))


@pytest.mark.parametrize("campo", ["is_active", "is_working"])
async def test_no_se_reactiva_a_mano_un_viaje_del_tms(conexion_revertida, campo):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    trip_id = await _viaje(conn, usuario, "qanalytics")

    with pytest.raises(HTTPException) as err:
        await patch_trip(trip_id, TripPatch(**{campo: True}), pool=PoolDeUnaConexion(conn), user=usuario)

    assert err.value.status_code == 422
    assert await _flags(conn, trip_id) == {
        "is_active": False, "is_working": False, "manually_edited_fields": []}


async def test_en_un_viaje_manual_la_persona_si_manda(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    trip_id = await _viaje(conn, usuario, "manual")

    await patch_trip(trip_id, TripPatch(is_active=True), pool=PoolDeUnaConexion(conn), user=usuario)

    assert (await _flags(conn, trip_id))["is_active"] is True
