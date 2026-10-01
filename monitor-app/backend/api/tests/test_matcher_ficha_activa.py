"""El matcher por nombre prefiere la ficha activa (Brian Celis, 01/10).

Dos fichas con el mismo nombre — una activa y otra dada de baja — dejaban
todos sus viajes sin resolver: by_name exigia UN solo candidato. 27 vinculos a
mano en un mes.

La funcion se carga desde la migracion dentro de la transaccion revertida, asi
el test prueba el SQL que se va a desplegar y no la version viva.
Los nombres y RUT de este archivo son SINTETICOS.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

pytestmark = pytest.mark.integracion

MIGRACION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261001110000_el_matcher_por_nombre_prefiere_la_ficha_activa.sql"
)
NOMBRE = "Zzqx Brianx Prueba Celisx"


async def _cargar_funcion(conn) -> None:
    sql = MIGRACION.read_text()
    funcion = re.search(r"CREATE OR REPLACE FUNCTION.*?\$function\$;", sql, re.S).group(0)
    await conn.execute(funcion)


async def _viaje_con_nombre_tms(conn, nombre: str) -> str:
    trip_id = await conn.fetchval("SELECT id FROM app.trips WHERE source_system <> 'manual' LIMIT 1")
    await conn.execute("DELETE FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)
    await conn.execute(
        "UPDATE app.trips SET fleet = jsonb_build_object('driver_name_tms', $2::text) WHERE id = $1",
        trip_id, nombre,
    )
    return str(trip_id)


async def _conductor(conn, nombre: str, rut: str, estado: str) -> str:
    # El viaje no trae RUT, asi que la regla `tms_rut` no entra en juego.
    return str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, tax_id, operational_status) VALUES ($1, $2, $3) RETURNING id",
        nombre, rut, estado,
    ))


async def _vinculo(conn, trip_id: str):
    await conn.fetchrow("SELECT * FROM app.resolve_trip_fleet(ARRAY[$1::uuid])", trip_id)
    return await conn.fetchrow(
        "SELECT driver_id::text, driver_match_rule FROM app.trip_fleet_links WHERE trip_id = $1", trip_id)


async def test_con_un_duplicado_inactivo_elige_la_ficha_activa(conexion_revertida):
    conn = conexion_revertida
    await _cargar_funcion(conn)
    activo = await _conductor(conn, NOMBRE, "97531864-8", "ACTIVE")
    # Mismo nombre en otro orden: el TMS y el roster no coinciden en el orden.
    await _conductor(conn, "Celisx Prueba Zzqx Brianx", "97531865-6", "INACTIVE")
    trip_id = await _viaje_con_nombre_tms(conn, NOMBRE.upper())

    vinculo = await _vinculo(conn, trip_id)

    assert vinculo["driver_id"] == activo
    assert vinculo["driver_match_rule"] == "nombre"


async def test_dos_fichas_activas_siguen_siendo_ambiguas(conexion_revertida):
    conn = conexion_revertida
    await _cargar_funcion(conn)
    await _conductor(conn, NOMBRE, "97531864-8", "ACTIVE")
    await _conductor(conn, NOMBRE, "97531865-6", "ACTIVE")
    trip_id = await _viaje_con_nombre_tms(conn, NOMBRE)

    vinculo = await _vinculo(conn, trip_id)

    assert vinculo["driver_id"] is None


async def test_el_nombre_parcial_tambien_prefiere_la_activa(conexion_revertida):
    conn = conexion_revertida
    await _cargar_funcion(conn)
    activo = await _conductor(conn, NOMBRE, "97531864-8", "ACTIVE")
    await _conductor(conn, NOMBRE, "97531865-6", "INACTIVE")
    # Al TMS le falta un nombre: 3 de 4 palabras.
    trip_id = await _viaje_con_nombre_tms(conn, "Zzqx Brianx Celisx")

    vinculo = await _vinculo(conn, trip_id)

    assert vinculo["driver_id"] == activo
    assert vinculo["driver_match_rule"] == "nombre_parcial"


async def test_el_tracto_habitual_pasa_de_la_ficha_inactiva_a_la_activa(conexion_revertida):
    """FCCP42 colgaba de la ficha dada de baja de Brian: la herencia del motivo
    del cierre seguía a una persona que no está en el roster."""
    conn = conexion_revertida
    activo = await _conductor(conn, NOMBRE, "97531864-8", "ACTIVE")
    inactivo = await _conductor(conn, NOMBRE, "97531865-6", "INACTIVE")
    tracto = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ('ZZQX01', 'TRACTOCAMION') RETURNING id")
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source) "
        "VALUES ($1, $2, 'ACTIVE', 'padron_legacy')",
        tracto, inactivo)

    await conn.execute(MIGRACION.read_text())

    habitual = await conn.fetchval(
        "SELECT driver_id::text FROM public.vehicle_driver_assignments WHERE asset_id = $1 AND status = 'ACTIVE'",
        tracto)
    assert habitual == activo


async def test_sin_una_unica_ficha_activa_el_tracto_habitual_no_se_toca(conexion_revertida):
    conn = conexion_revertida
    inactivo = await _conductor(conn, NOMBRE, "97531865-6", "INACTIVE")
    tracto = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ('ZZQX01', 'TRACTOCAMION') RETURNING id")
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source) "
        "VALUES ($1, $2, 'ACTIVE', 'padron_legacy')",
        tracto, inactivo)

    await conn.execute(MIGRACION.read_text())

    habitual = await conn.fetchval(
        "SELECT driver_id::text FROM public.vehicle_driver_assignments WHERE asset_id = $1 AND status = 'ACTIVE'",
        tracto)
    assert habitual == inactivo
