"""Lo que cambió en un día firmado, viaje por viaje (spec 2026-10-10 anulación y firma versionada, §4).

Reemplaza la resta de totales (viajes de hoy − viajes firmados), que con un viaje
agregado y otro quitado daba 0."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services import cierre_lineas
from app.services.anular_viajes import anular_viajes
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

D = date(2099, 1, 4)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=D.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


async def test_uno_que_entra_y_otro_que_sale_aparecen_los_dos(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    sale = await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    entra = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [sale], "Duplicado", admin)

    ajustes = {a["trip_id"]: a for a in await cierre_lineas.ajustes_posteriores(pool, D)}
    assert set(ajustes) == {entra, sale}
    assert ajustes[entra]["tipo"] == "agregado"
    assert (ajustes[sale]["tipo"], ajustes[sale]["void_reason"]) == ("quitado", "Duplicado")
    assert ajustes[sale]["voided_by_name"] is not None


async def test_un_dia_firmado_sin_cambios_no_tiene_ajustes(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    assert await cierre_lineas.ajustes_posteriores(pool, D) == []


async def test_dia_reabierto_no_tiene_ajustes(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    await cierre_lineas.reabrir(pool, D, nota="corrección", user=admin)
    await _viaje_manual(conn, admin)

    assert await cierre_lineas.ajustes_posteriores(pool, D) == []
    assert [f["version"] for f in await cierre_lineas.firmas_del_dia(pool, D)] == [1]


async def test_get_daily_closures_devuelve_la_lista(conexion_revertida):
    from app.routers.daily_closures import get_daily_closure_status
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    entra = await _viaje_manual(conn, admin)

    respuesta = await get_daily_closure_status(fecha=D.isoformat(), pool=pool, _=admin)
    assert "posteriores_al_cierre" not in respuesta["cierre"]
    assert [a["trip_id"] for a in respuesta["cierre"]["ajustes"]] == [entra]
