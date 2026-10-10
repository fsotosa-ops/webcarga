"""La marca del Cierre contra Postgres de verdad (spec 2026-10-10, §3.1).

Los triggers encolan días abiertos cuando cambia un dato de entrada de las
líneas. No calculan nada: el recálculo lo hace el ejecutor."""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

pytestmark = pytest.mark.integracion

TABLAS_DE_LA_MIGRACION = [
    "app.trip_fleet_links", "public.assets", "public.asset_assignments", "public.drivers",
    "public.driver_assignments", "public.vehicle_driver_assignments", "public.carriers", "app.trip_statuses",
]


async def _cola(conn) -> dict:
    filas = await conn.fetch("SELECT business_date, version FROM app.closure_recompute_queue")
    return {f["business_date"]: f["version"] for f in filas}


async def _vaciar_cola(conn) -> None:
    await conn.execute("DELETE FROM app.closure_recompute_queue")


async def test_escribir_en_cada_tabla_de_entrada_encola_hoy(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    for tabla in TABLAS_DE_LA_MIGRACION:
        await _vaciar_cola(conexion_revertida)
        # Un UPDATE que sí toca una fila, sin cambiar su valor: la marca no mira
        # el contenido, solo si la sentencia cambió alguna fila.
        # Las 8 tablas tienen `id` (verificado el 10/10 en information_schema).
        tocadas = await conexion_revertida.execute(
            f"UPDATE {tabla} SET id = id WHERE id = (SELECT id FROM {tabla} LIMIT 1)")
        assert tocadas == "UPDATE 1", f"{tabla}: el escenario necesita una fila"
        assert hoy in await _cola(conexion_revertida), f"{tabla} no encoló el día"


async def test_un_update_que_no_toca_filas_no_encola(conexion_revertida):
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE id = $1", uuid.uuid4())
    assert await _cola(conexion_revertida) == {}


async def test_lo_que_escribe_el_recalculo_no_encola(conexion_revertida):
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute("SET LOCAL app.origen_escritura = 'recalculo_cierre'")
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)")
    assert await _cola(conexion_revertida) == {}


async def test_un_dia_firmado_nunca_entra_y_uno_abierto_si(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    abierto, firmado = hoy - timedelta(days=3), hoy - timedelta(days=2)
    actor = await conexion_revertida.fetchval("SELECT id FROM auth.users LIMIT 1")
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status) VALUES ($1, 'OPEN') "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'OPEN', closed_by = NULL, closed_at = NULL", abierto)
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) VALUES ($1, 'CLOSED', $2, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2, closed_at = now()",
        firmado, actor)
    await _vaciar_cola(conexion_revertida)
    await conexion_revertida.execute(
        "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)")
    cola = await _cola(conexion_revertida)
    assert abierto in cola and hoy in cola
    assert firmado not in cola


async def test_cada_marca_sube_la_version_y_conserva_desde_cuando(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    await _vaciar_cola(conexion_revertida)
    tocar = "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)"
    await conexion_revertida.execute(tocar)
    primera = await conexion_revertida.fetchrow(
        "SELECT version, requested_at FROM app.closure_recompute_queue WHERE business_date = $1", hoy)
    await conexion_revertida.execute(tocar)
    segunda = await conexion_revertida.fetchrow(
        "SELECT version, requested_at FROM app.closure_recompute_queue WHERE business_date = $1", hoy)
    assert segunda["version"] == primera["version"] + 1
    assert segunda["requested_at"] == primera["requested_at"]


async def test_la_marca_usa_el_dia_de_chile(conexion_revertida):
    """Review Focus 1: entre las 21:00 y las 24:00 de Chile, CURRENT_DATE ya es mañana."""
    fuente = await conexion_revertida.fetchval(
        "SELECT prosrc FROM pg_proc WHERE proname = 'marcar_cierre_pendiente'")
    assert "hoy_chile()" in fuente
    assert "current_date" not in fuente.lower()
