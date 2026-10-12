"""D1 "Una sola respuesta", hechos de la flota en la base (spec §4): app.active_fleet,
app.carrier_of, public.carrier_management_types y los CHECK de operational_status.

La migración se ejecuta dentro de la transacción revertida de cada test (patrón
de test_trip_assignment_integration.py): se prueba el archivo antes de
aplicarlo. Los sujetos los crea el test, con prefijo ZZ-TEST-D1."""
from __future__ import annotations

import uuid
from pathlib import Path

import asyncpg
import pytest

from tests.d1_subjects import CHECKS_MARKER, apply_fleet_facts, fleet_facts_sql

pytestmark = pytest.mark.integracion

MIGRATION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261013090000_directory_one_answer.sql")
PREFIJO = "ZZ-TEST-D1"


async def apply_migration(conn) -> None:
    # Los CHECK toman un lock exclusivo sobre carriers, drivers y assets hasta el
    # ROLLBACK. Si alguien los tiene tomados, el test falla en 3 s en vez de
    # quedarse esperando (y de hacer esperar a la app detrás suyo).
    await conn.execute("SET LOCAL lock_timeout = '3s'")
    await conn.execute(MIGRATION.read_text())


def _suf() -> str:
    return uuid.uuid4().hex[:6].upper()


async def _tipo(conn, code: str) -> uuid.UUID:
    return await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND code = $1", code)


async def _empresa(conn, estado: str = "ACTIVE", declarado: list[str] | None = None) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status, management_types) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} Empresa {_suf()}", estado, declarado)


async def _conductor(conn, empresa, *, estado: str = "ACTIVE", asignacion: str = "ACTIVE") -> uuid.UUID:
    d = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, $3)",
        d, empresa, asignacion)
    return d


async def _equipo(conn, empresa, *, estado: str = "ACTIVE", asignacion: str = "ACTIVE",
                  tipo: str = "TRACTOCAMION", operacion: str | None = None) -> uuid.UUID:
    a = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status, webcarga_operation_type_id) "
        "VALUES ($1, $2, $3, $4) RETURNING id",
        f"ZZ{_suf()[:4]}", tipo, estado, await _tipo(conn, operacion) if operacion else None)
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, $3)",
        a, empresa, asignacion)
    return a


async def _flota(conn, empresa) -> set[tuple[str, uuid.UUID]]:
    return {(f["entity_type"], f["entity_id"]) for f in await conn.fetch(
        "SELECT entity_type, entity_id FROM app.active_fleet WHERE carrier_id = $1", empresa)}


# ── app.active_fleet ─────────────────────────────────────────────────────────

async def test_la_flota_activa_deja_fuera_lo_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    activo = await _conductor(conn, empresa)
    await _conductor(conn, empresa, estado="INACTIVE")          # de baja, con asignación ACTIVE
    await _conductor(conn, empresa, asignacion="INACTIVE")      # activo, ya no asignado
    tracto = await _equipo(conn, empresa)
    await _equipo(conn, empresa, estado="INACTIVE")             # de baja, con asignación ACTIVE

    assert await _flota(conn, empresa) == {("DRIVER", activo), ("ASSET", tracto)}


async def test_la_flota_activa_no_mira_el_estado_de_la_empresa(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    conductor = await _conductor(conn, de_baja)

    assert await _flota(conn, de_baja) == {("DRIVER", conductor)}


async def test_un_conductor_con_dos_tractos_esta_una_vez_en_la_flota(conexion_revertida):
    """Review Focus 2: vehicle_driver_assignments permite un conductor por tracto,
    no un tracto por conductor."""
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    for _ in range(2):
        tracto = await _equipo(conn, empresa)
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
            "VALUES ($1, $2, 'ACTIVE', 'manual', true)", tracto, conductor)

    filas = await conn.fetchval(
        "SELECT count(*) FROM app.active_fleet WHERE entity_type = 'DRIVER' AND entity_id = $1", conductor)
    assert filas == 1


async def test_los_hechos_de_la_flota_se_cargan_sin_los_check(conexion_revertida):
    """El helper de las Tasks 4-9 (A-R9) corta en la marca: crea la vista y las
    funciones, y deja afuera los ALTER TABLE que toman locks exclusivos."""
    conn = conexion_revertida
    assert "ADD CONSTRAINT" not in fleet_facts_sql()
    assert "ADD CONSTRAINT" in MIGRATION.read_text().split(CHECKS_MARKER, 1)[1]
    for linea in MIGRATION.read_text().splitlines():
        assert linea.strip().upper() not in ("BEGIN;", "COMMIT;"), "la migración no maneja su transacción"
    await apply_fleet_facts(conn)
    assert await conn.fetchval("SELECT to_regclass('app.active_fleet')") is not None
    assert await conn.fetchval("SELECT to_regprocedure('app.carrier_of(text, uuid)')") is not None


# ── app.carrier_of ───────────────────────────────────────────────────────────

async def test_carrier_of(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    activa = await _empresa(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    conductor_de_baja = await _conductor(conn, de_baja, estado="INACTIVE")
    sin_empresa = await _conductor(conn, activa, asignacion="INACTIVE")
    tracto = await _equipo(conn, activa, estado="INACTIVE")

    async def de(tipo, entidad):
        return await conn.fetchval("SELECT app.carrier_of($1, $2)", tipo, entidad)

    assert await de("CARRIER", activa) == activa
    # Cualquier estado: la entidad de baja y la empresa de baja siguen diciendo de quién es.
    assert await de("DRIVER", conductor_de_baja) == de_baja
    assert await de("ASSET", tracto) == activa
    assert await de("DRIVER", sin_empresa) is None
    assert await de("SHIPPER", activa) is None


# ── public.carrier_management_types ──────────────────────────────────────────

async def test_el_tipo_de_operacion_ignora_el_tracto_dado_de_baja(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    await _equipo(conn, empresa, operacion="TRACTOREO")
    await _equipo(conn, empresa, estado="INACTIVE", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_el_tipo_de_operacion_sale_del_tracto_no_de_la_rampla(conexion_revertida):
    """E-g de la spec y ruling A-R1 (cambia 1 empresa INACTIVE)."""
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn)
    await _equipo(conn, empresa, operacion="TRACTOREO")
    await _equipo(conn, empresa, tipo="RAMPLA", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_sin_tractos_activos_cae_a_lo_declarado(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    empresa = await _empresa(conn, declarado=["TRACTOREO"])
    await _equipo(conn, empresa, estado="INACTIVE", operacion="EQUIPO_COMPLETO")

    assert await conn.fetchval("SELECT public.carrier_management_types($1)", empresa) == ["TRACTOREO"]


async def test_el_comentario_sigue_nombrando_a_quienes_la_llaman(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    comentario = await conn.fetchval(
        "SELECT obj_description('public.carrier_management_types(uuid)'::regprocedure, 'pg_proc')")
    for llamador in ("reconcile_new_carrier", "reconcile_carrier_shipper_link", "SQL_ENTIDADES_QUE_APLICAN",
                     "app/routers/compliance.py", "app.active_fleet"):
        assert llamador in comentario


# ── CHECK de operational_status ──────────────────────────────────────────────

async def _sujeto(conn, tabla: str) -> uuid.UUID:
    empresa = await _empresa(conn)
    if tabla == "carriers":
        return empresa
    return await (_conductor(conn, empresa) if tabla == "drivers" else _equipo(conn, empresa))


@pytest.mark.parametrize("tabla, valor", [
    ("drivers", "LEGACY_INACTIVE"), ("assets", "LEGACY_INACTIVE"), ("carriers", "PAUSED"),
])
async def test_el_ciclo_de_vida_fuera_del_glosario_se_rechaza(conexion_revertida, tabla, valor):
    conn = conexion_revertida
    await apply_migration(conn)
    fila = await _sujeto(conn, tabla)
    # Un SAVEPOINT: el error no aborta la transacción del fixture.
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await conn.execute(f"UPDATE public.{tabla} SET operational_status = $1 WHERE id = $2", valor, fila)


async def test_la_migracion_se_puede_correr_dos_veces(conexion_revertida):
    conn = conexion_revertida
    await apply_migration(conn)
    await apply_migration(conn)
    nombres = {f["conname"] for f in await conn.fetch(
        "SELECT conname FROM pg_constraint WHERE conname = ANY($1::text[])",
        ["carriers_operational_status_check", "drivers_operational_status_check",
         "assets_operational_status_check"])}
    assert len(nombres) == 3
