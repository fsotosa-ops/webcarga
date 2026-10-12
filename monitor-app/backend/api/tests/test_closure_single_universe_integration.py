"""Bloque 0 del Directorio, 0.4: la tabla del Cierre y la firma cuentan el mismo
universo (spec 2026-10-12-directory-block-0-design.md §3).

La línea de un conductor que salió del roster después de calcularse su día
sigue bloqueando la firma (cierre_lineas.cerrar cuenta todas las líneas). La
tabla tiene que mostrarla, marcada. Contra Postgres de verdad, en una
transacción revertida."""
from __future__ import annotations

import uuid
from datetime import date

import pytest

from app.routers.daily_closures import _DETAIL_SQL, _REPORT_SQL

pytestmark = pytest.mark.integracion

# Días sin líneas: el universo del día es solo lo que crea el test, así que los
# conteos no dependen de producción. D es posterior a la primera firma de
# app.closure_signatures (el go-live); ANTES es anterior a ella.
D = date.fromisoformat("2099-01-05")      # después del go-live del Cierre
ANTES = date.fromisoformat("2020-01-06")  # antes de la primera firma
TRACTOREO_ID = "89822208-0189-463a-93a0-605fb570c71b"
PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _conductor_en_roster(conn) -> dict:
    """Empresa ACTIVE + tracto Tractoreo + conductor asignado: el mínimo para
    entrar a TRACTOREO_ROSTER_CTE (mismo armado que test_cierre_por_origen)."""
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    tractor = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE', $2) RETURNING id",
        f"ZZ{uuid.uuid4().hex[:4].upper()}", uuid.UUID(TRACTOREO_ID))
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        tractor, carrier)
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {uuid.uuid4().hex[:6]}")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        driver, carrier)
    return {"carrier": carrier, "driver": driver}


async def _linea_sin_motivo(conn, driver, dia=D) -> None:
    # closure_lines.business_date tiene FK a closure_periods: primero el período.
    await conn.execute(
        "INSERT INTO app.closure_periods (business_date) VALUES ($1) ON CONFLICT DO NOTHING", dia)
    await conn.execute(
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status, requires_reason) "
        "VALUES ($1, 'DRIVER', $2, 'UNASSIGNED', true)", dia, driver)


async def test_antes_del_go_live_la_linea_de_quien_salio_sigue_oculta(conexion_revertida):
    conn = conexion_revertida
    primera_firma = await conn.fetchval("SELECT min(business_date) FROM app.closure_signatures")
    assert primera_firma is not None and ANTES < primera_firma < D
    queda = await _conductor_en_roster(conn)
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, queda["driver"], ANTES)
    await _linea_sin_motivo(conn, sale["driver"], ANTES)
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", sale["driver"])

    detalle = {f["driver_id"] for f in await conn.fetch(_DETAIL_SQL, ANTES)}
    reporte = {f["driver_id"] for f in await conn.fetch(_REPORT_SQL, ANTES, ANTES)}

    assert detalle == reporte == {queda["driver"]}


async def test_la_linea_de_quien_salio_del_roster_se_ve_marcada(conexion_revertida):
    conn = conexion_revertida
    queda = await _conductor_en_roster(conn)
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, queda["driver"])
    await _linea_sin_motivo(conn, sale["driver"])
    # Sale del roster DESPUÉS de calcularse el día: es lo que dejó ocultas las líneas del 11/10.
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", sale["driver"])

    filas = {f["driver_id"]: f for f in await conn.fetch(_DETAIL_SQL, D)}

    assert sale["driver"] in filas, "la línea de quien salió del roster tiene que verse"
    assert filas[sale["driver"]]["in_roster"] is False
    assert filas[sale["driver"]]["category"] == "SIN_RESOLVER"
    assert filas[queda["driver"]]["in_roster"] is True


async def test_la_tabla_cuenta_lo_mismo_que_la_firma(conexion_revertida):
    """Review Focus 3: un día cuya única línea que bloquea es de alguien que ya
    no está en el roster (aquí, por una baja del conductor)."""
    conn = conexion_revertida
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, sale["driver"])
    await conn.execute("UPDATE public.drivers SET operational_status = 'INACTIVE' WHERE id = $1", sale["driver"])

    filas = await conn.fetch(_DETAIL_SQL, D)
    # Lo que lee la firma: cierre_lineas.cerrar cuenta todas las líneas DRIVER del
    # día (conteos) y bloquea con MISMATCH o UNASSIGNED sin motivo (pendientes).
    universo_de_la_firma = await conn.fetchval(
        "SELECT count(*) FROM app.closure_lines WHERE business_date = $1 AND subject_type = 'DRIVER'", D)
    bloquean = await conn.fetchval(
        "SELECT count(*) FROM app.closure_lines WHERE business_date = $1 AND subject_type = 'DRIVER' "
        "AND (status = 'MISMATCH' OR (status = 'UNASSIGNED' AND reason_id IS NULL))", D)

    assert len(filas) == universo_de_la_firma == 1
    assert bloquean == 1
    assert filas[0]["category"] == "SIN_RESOLVER" and filas[0]["in_roster"] is False


async def test_el_reporte_tambien_trae_a_quien_salio(conexion_revertida):
    conn = conexion_revertida
    sale = await _conductor_en_roster(conn)
    await _linea_sin_motivo(conn, sale["driver"])
    await conn.execute(
        "UPDATE public.driver_assignments SET status = 'INACTIVE' WHERE driver_id = $1", sale["driver"])

    filas = await conn.fetch(_REPORT_SQL, D, D)

    assert [f["in_roster"] for f in filas if f["driver_id"] == sale["driver"]] == [False]
