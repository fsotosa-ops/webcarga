"""Firmar escribe una copia inmutable y versionada; reabrir no la toca (spec 2026-10-10 anulación y firma versionada, §3)."""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest
from fastapi import HTTPException

from app.routers.trips import TripCreateBody, TripStopCreate, create_trip
from app.services import cierre_lineas
from tests.conftest import PoolDeUnaConexion, _usuario_real, con_roles, ADMIN_EQUIVALENTE

pytestmark = pytest.mark.integracion

D = date(2099, 1, 2)


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


async def _firmas(conn):
    return await conn.fetch(
        "SELECT id, version, captured_from, totals FROM app.closure_signatures WHERE business_date = $1 ORDER BY version", D)


async def test_firmar_crea_la_version_1_con_lineas_y_viajes(conexion_revertida):
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)

    resultado = await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=True, override_note="prueba", user=admin)

    firmas = await _firmas(conn)
    assert [(f["version"], f["captured_from"]) for f in firmas] == [(1, "signing")]
    assert resultado["version"] == 1
    firma = firmas[0]["id"]
    assert await conn.fetchval("SELECT count(*) FROM app.closure_signature_lines WHERE signature_id = $1", firma) == \
        await conn.fetchval("SELECT count(*) FROM app.closure_lines WHERE business_date = $1", D)
    assert await conn.fetchval(
        "SELECT $2::uuid IN (SELECT trip_id FROM app.closure_signature_trips WHERE signature_id = $1)", firma, tid)


async def test_reabrir_y_volver_a_firmar_crea_la_version_2_y_la_1_sigue_igual(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await _viaje_manual(conn, admin)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    v1 = (await _firmas(conn))[0]
    lineas_v1 = await conn.fetch(
        "SELECT * FROM app.closure_signature_lines WHERE signature_id = $1 ORDER BY subject_type, subject_id", v1["id"])

    await cierre_lineas.reabrir(pool, D, nota="faltaba un viaje", user=admin)
    await _viaje_manual(conn, admin)
    await cierre_lineas.recalcular(pool, D)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    firmas = await _firmas(conn)
    assert [f["version"] for f in firmas] == [1, 2]
    assert await conn.fetch(
        "SELECT * FROM app.closure_signature_lines WHERE signature_id = $1 ORDER BY subject_type, subject_id",
        v1["id"]) == lineas_v1
    assert (await conn.fetchval(
        "SELECT count(*) FROM app.closure_signature_trips WHERE signature_id = $1", firmas[1]["id"])) == \
        (await conn.fetchval("SELECT count(*) FROM app.closure_signature_trips WHERE signature_id = $1", v1["id"])) + 1


async def test_firmar_dos_veces_no_crea_otra_version(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    with pytest.raises(HTTPException) as err:
        await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)
    assert err.value.status_code == 409
    assert [f["version"] for f in await _firmas(conn)] == [1]


async def test_el_periodo_y_el_historial_leen_la_firma(conexion_revertida):
    conn = conexion_revertida
    pool = PoolDeUnaConexion(conn)
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    await cierre_lineas.cerrar(pool, D, override=True, override_note="prueba", user=admin)

    info = await cierre_lineas.periodo(pool, D)
    firma = (await conn.fetch(
        "SELECT signed_by::text, signed_at, totals FROM app.closure_signatures WHERE business_date = $1", D))[0]
    assert (str(info["closed_by"]), info["closed_at"]) == (firma["signed_by"], firma["signed_at"])
    assert info["frozen_totals"]["viajes"] == json.loads(firma["totals"])["viajes"]

    historial = await cierre_lineas.firmas_del_dia(pool, D)
    assert [h["version"] for h in historial] == [1]
    assert historial[0]["captured_from"] == "signing"


async def test_la_firma_no_cuenta_los_anulados(conexion_revertida):
    from app.services.anular_viajes import anular_viajes
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    await anular_viajes(conn, [tid], "Duplicado", admin)

    await cierre_lineas.cerrar(PoolDeUnaConexion(conn), D, override=True, override_note="prueba", user=admin)

    firma = (await _firmas(conn))[0]["id"]
    assert not await conn.fetchval(
        "SELECT $2::uuid IN (SELECT trip_id FROM app.closure_signature_trips WHERE signature_id = $1)", firma, tid)


async def test_la_pestana_viajes_del_cierre_no_lista_los_anulados(conexion_revertida):
    from app.services.anular_viajes import anular_viajes
    from app.services.cierre_viajes import SQL_CON_MOTIVO, SQL_GRUPOS_CIERRE
    conn = conexion_revertida
    admin = con_roles(await _usuario_real(conn), *ADMIN_EQUIVALENTE)
    tid = await _viaje_manual(conn, admin)
    consulta = f"SELECT g.trip_id::text AS trip_id FROM (({SQL_GRUPOS_CIERRE}) UNION ALL ({SQL_CON_MOTIVO})) g"
    assert tid in {r["trip_id"] for r in await conn.fetch(consulta, D)}

    await anular_viajes(conn, [tid], "Duplicado", admin)

    assert tid not in {r["trip_id"] for r in await conn.fetch(consulta, D)}
