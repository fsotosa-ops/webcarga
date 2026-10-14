"""Bloque 0 del Directorio, 0.1: una asignación nueva toma el día de Chile.

La migración ya está aplicada: los tests leen el esquema vivo. No se re-ejecuta
(revisión final D1, I2): su ALTER TABLE … SET DEFAULT toma un ACCESS EXCLUSIVE
sobre cuatro tablas de asignaciones hasta el ROLLBACK, y la API viva de dev
esperaba detrás."""
from __future__ import annotations

import uuid

import pytest

pytestmark = pytest.mark.integracion

TABLAS = ("driver_assignments", "asset_assignments", "vehicle_driver_assignments", "carrier_shippers")
PREFIJO = "ZZ-TEST-DIRECTORIO"


async def _hoy_chile_fijo(conn, dia) -> None:
    """Igual que test_exigibilidad_integracion._hoy: la función se reemplaza
    dentro de la transacción revertida."""
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$")


async def test_el_default_de_start_date_es_hoy_chile_en_las_cuatro_tablas(conexion_revertida):
    defaults = {r["table_name"]: r["column_default"] for r in await conexion_revertida.fetch(
        "SELECT table_name, column_default FROM information_schema.columns "
        "WHERE table_schema = 'public' AND column_name = 'start_date' AND table_name = ANY($1::text[])",
        list(TABLAS))}
    assert set(defaults) == set(TABLAS)
    for tabla, default in defaults.items():
        assert "hoy_chile()" in (default or ""), f"{tabla}: {default}"


async def test_a_las_2230_de_chile_la_asignacion_toma_el_dia_de_chile(conexion_revertida):
    """Review Focus 4. A las 22:30 de Chile el día UTC ya es el siguiente: se
    simula dejando hoy_chile() en la víspera de CURRENT_DATE."""
    conn = conexion_revertida
    vispera = await conn.fetchval("SELECT CURRENT_DATE - 1")
    await _hoy_chile_fijo(conn, vispera)
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {uuid.uuid4().hex[:6]}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {uuid.uuid4().hex[:6]}")

    # Sin start_date. INACTIVE a propósito (D2, 14/10): la víspera puede ser un día ya
    # cerrado del Cierre, y una ACTIVE abriría un período que la guarda rechaza. El
    # default de la columna es el mismo para los dos estados.
    inicio = await conn.fetchval(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) "
        "VALUES ($1, $2, 'INACTIVE') RETURNING start_date", driver, carrier)

    assert inicio == vispera
