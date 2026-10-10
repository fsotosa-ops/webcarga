"""El ejecutor de la cola del Cierre (spec 2026-10-10, §3.3)."""
from __future__ import annotations

from datetime import date

import asyncpg
import pytest

from app.services import cierre_lineas, cola_del_cierre
from tests.conftest import PoolDeUnaConexion, _usuario_real, credenciales_integracion

pytestmark = pytest.mark.integracion
D = date.fromisoformat("2026-06-11")


async def _solo_d_en_la_cola(conn):
    await conn.execute("DELETE FROM app.closure_recompute_queue")
    await conn.execute(cierre_lineas.SQL_ENCOLAR, D)


async def test_recalcula_y_vacia_la_cola(conexion_revertida):
    await _solo_d_en_la_cola(conexion_revertida)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert D.isoformat() in r["recalculados"]
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 0


async def test_un_dia_firmado_sale_sin_calcular(conexion_revertida):
    actor = (await _usuario_real(conexion_revertida))["sub"]
    await conexion_revertida.execute(
        "INSERT INTO app.closure_periods (business_date, status, closed_by, closed_at) VALUES ($1, 'CLOSED', $2::uuid, now()) "
        "ON CONFLICT (business_date) DO UPDATE SET status = 'CLOSED', closed_by = $2::uuid, closed_at = now()", D, actor)
    await _solo_d_en_la_cola(conexion_revertida)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert D.isoformat() in r["cerrados"]


async def test_un_dia_que_falla_queda_en_la_cola_y_los_demas_siguen(conexion_revertida, monkeypatch):
    otro = date.fromisoformat("2026-06-12")
    await _solo_d_en_la_cola(conexion_revertida)
    await conexion_revertida.execute(cierre_lineas.SQL_ENCOLAR, otro)
    real = cierre_lineas.recalcular

    async def falla_en_d(pool, fecha, **kw):
        if fecha == D:
            raise RuntimeError("boom")
        return await real(pool, fecha, **kw)

    monkeypatch.setattr(cierre_lineas, "recalcular", falla_en_d)
    r = await cola_del_cierre.procesar_cola(PoolDeUnaConexion(conexion_revertida))
    assert r["fallidos"] == [{"fecha": D.isoformat(), "error": "boom"}]
    assert otro.isoformat() in r["recalculados"]
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.closure_recompute_queue WHERE business_date = $1", D) == 1


async def test_un_dia_tomado_por_otra_conexion_se_salta(conexion_revertida):
    """Review Focus 2 y 3: otra corrida o una firma tienen el período.

    Usa un período que YA existe en firme: si lo creara la transacción revertida,
    la otra conexión quedaría esperando su INSERT sin confirmar."""
    fecha = await conexion_revertida.fetchval(
        "SELECT business_date FROM app.closure_periods WHERE status = 'OPEN' ORDER BY 1 LIMIT 1")
    if fecha is None:
        pytest.skip("no hay un período abierto en firme")
    otra = await asyncpg.connect(**credenciales_integracion())
    tx = otra.transaction()
    await tx.start()
    try:
        await otra.fetchval("SELECT status FROM app.closure_periods WHERE business_date = $1 FOR UPDATE", fecha)
        r = await cierre_lineas.recalcular(PoolDeUnaConexion(conexion_revertida), fecha, saltar_si_ocupado=True)
        assert r is cierre_lineas.Resultado.OCUPADO
    finally:
        await tx.rollback()
        await otra.close()
