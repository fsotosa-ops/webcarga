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
    """Marcas por día."""
    filas = await conn.fetch(
        "SELECT business_date, count(*) AS n FROM app.closure_recompute_queue GROUP BY business_date")
    return {f["business_date"]: f["n"] for f in filas}


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


async def test_cada_marca_agrega_una_fila_y_la_primera_dice_desde_cuando(conexion_revertida):
    hoy = await conexion_revertida.fetchval("SELECT public.hoy_chile()")
    await _vaciar_cola(conexion_revertida)
    tocar = "UPDATE public.carriers SET business_name = business_name WHERE ctid = (SELECT ctid FROM public.carriers LIMIT 1)"
    await conexion_revertida.execute(tocar)
    primera = await conexion_revertida.fetchval(
        "SELECT min(requested_at) FROM app.closure_recompute_queue WHERE business_date = $1", hoy)
    await conexion_revertida.execute(tocar)
    assert (await _cola(conexion_revertida))[hoy] == 2
    assert await conexion_revertida.fetchval(
        "SELECT min(requested_at) FROM app.closure_recompute_queue WHERE business_date = $1", hoy) == primera


async def test_la_marca_usa_el_dia_de_chile(conexion_revertida):
    """Review Focus 1: entre las 21:00 y las 24:00 de Chile, CURRENT_DATE ya es mañana."""
    fuente = await conexion_revertida.fetchval(
        "SELECT prosrc FROM pg_proc WHERE proname = 'enqueue_closure_recompute'")
    assert "hoy_chile()" in fuente
    assert "current_date" not in fuente.lower()


async def test_dos_escrituras_que_marcan_no_se_esperan(conexion_revertida):
    """Dos ediciones de filas distintas no pueden bloquearse por la marca: con la
    cola actualizada en lugar (upsert por día), la segunda esperaba el bloqueo de
    fila de la primera hasta que terminara, y una corrida de dbt dejaba esperando
    a la app (y dos que tomaban las filas en distinto orden se bloqueaban entre
    sí). Se usa trip_fleet_links porque no tiene otros triggers: `carriers` tiene
    uno de Certificación que bloquea app.carrier_compliance_status por su cuenta
    y contamina la medición (diagnosticado el 10/10 con pg_blocking_pids)."""
    import asyncpg

    from tests.conftest import credenciales_integracion

    ids = [r["id"] for r in await conexion_revertida.fetch(
        "SELECT id FROM app.trip_fleet_links ORDER BY id LIMIT 2")]
    await conexion_revertida.execute("UPDATE app.trip_fleet_links SET id = id WHERE id = $1", ids[0])
    otra = await asyncpg.connect(**credenciales_integracion())
    tx = otra.transaction()
    await tx.start()
    try:
        await otra.execute("SET LOCAL lock_timeout = '2s'")
        await otra.execute("UPDATE app.trip_fleet_links SET id = id WHERE id = $1", ids[1])
    finally:
        await tx.rollback()
        await otra.close()


async def test_los_triggers_siguen_el_estandar_de_nombres_de_la_base(conexion_revertida):
    """Inglés, verbo + objeto, como trg_trips_resolve_fleet_* y protect_manual_overrides."""
    nombres = {r["tgname"] for r in await conexion_revertida.fetch(
        "SELECT DISTINCT tgname FROM pg_trigger WHERE tgname LIKE 'trg_%closure%' OR tgname LIKE 'trg_marcar%'")}
    assert nombres == {"trg_enqueue_closure_recompute_ins", "trg_enqueue_closure_recompute_upd",
                       "trg_enqueue_closure_recompute_del"}
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM pg_proc WHERE proname = 'marcar_cierre_pendiente'") == 0
