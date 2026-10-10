"""Anular viajes manuales con motivo (spec 2026-10-10 anulación y firma versionada, §2).

Reemplaza a test_eliminar_viajes_integracion.py: el viaje no se borra, queda con
quién, cuándo y por qué. Quién anula depende del día del viaje (planning_date):
abierto, el creador o trips.void_any; firmado, closures.sign. Todo corre en la
transacción revertida de `conexion_revertida`; cada test crea su viaje con el
endpoint real en un día que Operaciones nunca firma."""
from __future__ import annotations

import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip, get_trip, list_trips
from app.services.anular_viajes import anular_viajes, revertir_anulacion
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

DIA = date(2099, 1, 1)


async def _viaje_manual(conn, usuario) -> str:
    viaje = await create_trip(
        TripCreateBody(
            planning_date=DIA.isoformat(), client_name=f"TEST-{uuid.uuid4().hex[:8]}",
            driver_name="CONDUCTOR DE PRUEBA",
            stops=[TripStopCreate(local="SAN BERNARDO", stop_type="ORIGIN"), TripStopCreate(local="IANSA")],
        ),
        pool=PoolDeUnaConexion(conn), user=usuario,
    )
    return str(viaje["id"])


def _otro(*roles: str) -> dict:
    return con_roles({"sub": str(uuid.uuid4()), "email": "otro@webcarga.cl"}, *roles)


def _sin_firmar(usuario: dict) -> dict:
    """El creador como Supervisor de Operaciones, pero sin closures.sign."""
    sup = con_roles(usuario, "operations_supervisor")
    return {**sup, "permissions": sup["permissions"] - {"closures.sign"}}


async def _firmar_dia(conn, usuario) -> None:
    # closure_periods_cerrado_tiene_firma: un período CLOSED lleva quién y cuándo.
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) "
        "VALUES ($1, 'CLOSED', $2::uuid, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now()",
        DIA, usuario["sub"])


async def _anulado(conn, tid: str):
    return await conn.fetchrow(
        "SELECT t.voided_at, t.voided_by::text, t.void_reason, m.voided_at AS m_voided_at, m.void_reason AS m_reason "
        "FROM app.trips t JOIN app.trips_manual m ON m.id = t.id WHERE t.id = $1::uuid", tid)


async def _listados(conn, usuario) -> set[str]:
    ids: set[str] = set()
    for view in ("en_curso", "historial"):
        respuesta = await list_trips(
            view=view, fecha_desde=DIA.isoformat(), fecha_hasta=DIA.isoformat(), limit=500,
            pool=PoolDeUnaConexion(conn), user=usuario)
        ids |= {str(d["id"]) for d in respuesta["data"]}
    return ids


async def test_quien_lo_creo_lo_anula_con_motivo_y_queda_auditado(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert (await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario))["can_void"] is True

    assert await anular_viajes(conn, [tid], "Duplicado", usuario) == 1

    fila = await _anulado(conn, tid)
    assert fila["voided_at"] is not None and fila["m_voided_at"] is not None
    assert (fila["voided_by"], fila["void_reason"], fila["m_reason"]) == (usuario["sub"], "Duplicado", "Duplicado")
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void'",
        tid) == 1
    detalle = await get_trip(tid, pool=PoolDeUnaConexion(conn), user=usuario)
    assert (detalle["void_reason"], detalle["can_void"], detalle["can_revert_void"]) == ("Duplicado", False, True)
    assert detalle["voided_by_name"] is not None


async def test_el_monitor_no_lista_los_anulados(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    assert tid in await _listados(conn, usuario)

    await anular_viajes(conn, [tid], "Duplicado", usuario)

    assert tid not in await _listados(conn, usuario)


async def test_sin_motivo_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "   ", usuario)
    assert err.value.status_code == 422
    assert (await _anulado(conn, tid))["voided_at"] is None


async def test_otro_operador_no_puede_y_void_any_si(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Duplicado", _otro("operations_operator"))
    assert err.value.status_code == 403

    otro_perfil = str(await conn.fetchval("SELECT id FROM public.profiles WHERE id <> $1::uuid LIMIT 1", usuario["sub"]))
    admin = con_roles({"sub": otro_perfil, "email": "admin@webcarga.cl"}, *ADMIN_EQUIVALENTE)
    assert await anular_viajes(conn, [tid], "Duplicado", admin) == 1


async def test_un_viaje_del_tms_no_se_anula(conexion_revertida):
    conn = conexion_revertida
    tms = str(await conn.fetchval("SELECT id FROM app.trips WHERE source_system <> 'manual' LIMIT 1"))
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tms], "Duplicado", _otro("owner"))
    assert err.value.status_code == 409


async def test_en_dia_firmado_lo_anula_solo_quien_firma(conexion_revertida):
    """Sin reabrir: el día sigue firmado y la anulación es un ajuste posterior."""
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await _firmar_dia(conn, usuario)

    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Duplicado", _sin_firmar(usuario))
    assert err.value.status_code == 403
    assert "firmado" in str(err.value.detail)

    assert await anular_viajes(conn, [tid], "Duplicado", con_roles(usuario, "operations_operator")) == 1
    assert await conn.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1", DIA) == "CLOSED"


async def test_revertir_en_dia_firmado_exige_firmar_y_vuelve_a_la_firma(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], "Duplicado", usuario)
    await _firmar_dia(conn, usuario)

    with pytest.raises(HTTPException) as err:
        await revertir_anulacion(conn, [tid], _sin_firmar(usuario))
    assert err.value.status_code == 403

    assert await revertir_anulacion(conn, [tid], con_roles(usuario, "operations_operator")) == 1
    assert (await _anulado(conn, tid))["voided_at"] is None
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type='TRIP' AND entity_id=$1::uuid AND action='void_revert'",
        tid) == 1


async def test_lote_mezclado_no_anula_ninguno(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    propio = await _viaje_manual(conn, usuario)
    inexistente = str(uuid.uuid4())
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [propio, inexistente], "Duplicado", usuario)
    assert err.value.status_code == 404
    assert [e["trip_id"] for e in err.value.detail["errors"]] == [inexistente]
    assert (await _anulado(conn, propio))["voided_at"] is None


async def test_anular_dos_veces_es_conflicto(conexion_revertida):
    conn = conexion_revertida
    usuario = await _usuario_real(conn)
    tid = await _viaje_manual(conn, usuario)
    await anular_viajes(conn, [tid], "Duplicado", usuario)
    with pytest.raises(HTTPException) as err:
        await anular_viajes(conn, [tid], "Otra vez", usuario)
    assert err.value.status_code == 409
