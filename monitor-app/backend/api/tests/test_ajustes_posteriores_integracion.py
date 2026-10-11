"""Lo que cambió en un día firmado, viaje por viaje (spec 2026-10-10 anulación y firma versionada, §4).

Reemplaza la resta de totales (viajes de hoy − viajes firmados), que con un viaje
agregado y otro quitado daba 0."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services import cierre_lineas
from app.services.anular_viajes import anular_viajes, revertir_anulacion
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


async def _motivo(conn, code: str = "DUPLICADO") -> str:
    return str(await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' AND code = $1", code))


async def test_uno_que_entra_y_otro_que_sale_aparecen_los_dos(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    sale = await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    entra = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [sale], await _motivo(conn), None, admin)

    ajustes = {a["trip_id"]: a for a in await cierre_lineas.ajustes_posteriores(pool, D)}
    assert set(ajustes) == {entra, sale}
    assert ajustes[entra]["tipo"] == "agregado"
    assert (ajustes[sale]["tipo"], ajustes[sale]["void_reason_label"]) == ("quitado", "Duplicado")
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


async def test_deshacer_una_anulacion_posterior_vuelve_a_lo_firmado(conexion_revertida):
    """Firmado con el viaje, anulado después (quitado) y revertido: ya no hay ajuste."""
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    await anular_viajes(conn, [tid], await _motivo(conn), None, admin)
    assert [a["tipo"] for a in await cierre_lineas.ajustes_posteriores(pool, D)] == ["quitado"]

    await revertir_anulacion(conn, [tid], admin)

    assert await cierre_lineas.ajustes_posteriores(pool, D) == []


async def test_deshacer_una_anulacion_anterior_a_la_firma_es_un_agregado(conexion_revertida):
    """Anulado antes de firmar (no está en la firma) y revertido después: entra como agregado."""
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [tid], await _motivo(conn), None, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    await revertir_anulacion(conn, [tid], admin)

    assert [(a["trip_id"], a["tipo"]) for a in await cierre_lineas.ajustes_posteriores(pool, D)] == [(tid, "agregado")]

