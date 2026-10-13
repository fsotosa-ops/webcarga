"""La "Divergencia TMS" es una nota automática del sistema, sin autor (encargo
2026-10-12-tms-divergence-system-note).

Se detecta cuando llega el dato del TMS (app.resolve_trip_fleet, que corre el
trigger de app.trips que recrea dbt) y no cuando alguien abre el viaje. La
migración ya está aplicada: estos tests leen la función y el CHECK vivos y no
re-ejecutan el DDL (revisión final D1, I2: un ALTER TABLE toma ACCESS EXCLUSIVE
sobre app.trip_notes hasta el ROLLBACK y la API viva de dev esperaría detrás).
Solo se re-ejecuta la parte de datos de la migración, que toma bloqueos de fila.

Los sujetos los crea el test, con prefijo ZZ-TEST-DIV.

app.trg_resolve_trip_fleet se apaga para el resto de la transacción con
set_config('app.resolving_fleet', 'on', true). En producción cada carga del TMS
es su propia transacción; aquí todo vive en la transacción revertida del test,
así que `_nueva_carga_del_tms` apaga esa marca antes de cada UPDATE para que el
trigger vuelva a correr, como lo haría la siguiente carga."""
from __future__ import annotations

import json
import uuid
from pathlib import Path

import asyncpg
import pytest

from app.routers.trips import get_trip
from tests.conftest import PoolDeUnaConexion, _usuario_real
from tests.test_trip_assignment_integration import insert_tms_trip, open_status

pytestmark = pytest.mark.integracion

PREFIX = "ZZ-TEST-DIV"
MIGRATION = (Path(__file__).resolve().parents[2]
             / "supabase/migrations/20261016090000_tms_divergence_system_note.sql")
DATA_MARKER = "-- tms-divergence:data"


def _suf() -> str:
    return uuid.uuid4().hex[:6].upper()


async def _viaje_con_vinculo_manual(conn, *, tractor_plate: str | None = None,
                                    driver_name: str | None = None) -> tuple[str, str]:
    """Un viaje del TMS con un conductor vinculado a mano. Devuelve (trip_id,
    nombre del conductor del TMS al crear el viaje). Con `driver_name`, el
    conductor vinculado se llama así y el TMS lo reporta con ese mismo texto."""
    nombre_tms = driver_name or f"{PREFIX} Tms {_suf()}"
    trip_id = await insert_tms_trip(conn, await open_status(conn), {"driver_name_tms": nombre_tms})
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        driver_name or f"{PREFIX} Manual {_suf()}")
    await conn.execute(
        "INSERT INTO app.trip_fleet_links (trip_id, driver_id, tractor_plate, link_source) "
        "VALUES ($1::uuid, $2, $3, 'manual') "
        "ON CONFLICT (trip_id) DO UPDATE SET driver_id = EXCLUDED.driver_id, "
        "tractor_plate = EXCLUDED.tractor_plate, link_source = 'manual'",
        trip_id, driver, tractor_plate)
    return trip_id, nombre_tms


async def _nueva_carga_del_tms(conn, trip_id: str, fleet: dict) -> None:
    await conn.execute("SELECT set_config('app.resolving_fleet', 'off', true)")
    await conn.execute(
        "UPDATE app.trips SET fleet = fleet || $2::jsonb WHERE id = $1::uuid", trip_id, json.dumps(fleet))


async def _divergencias(conn, trip_id: str) -> list[asyncpg.Record]:
    return await conn.fetch(
        "SELECT author_id, body FROM app.trip_notes "
        "WHERE trip_id = $1::uuid AND note_type = 'sistema' AND body LIKE 'Divergencia TMS:%' "
        "ORDER BY created_at", trip_id)


async def _notas(conn, trip_id: str) -> int:
    return await conn.fetchval("SELECT count(*) FROM app.trip_notes WHERE trip_id = $1::uuid", trip_id)


# ── Se detecta cuando llega el dato del TMS ──────────────────────────────────

async def test_otro_conductor_del_tms_escribe_una_nota_del_sistema_sin_autor(conexion_revertida):
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn)
    assert await _divergencias(conn, trip_id) == []

    otro = f"{PREFIX} Otro {_suf()}"
    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": otro})

    notas = await _divergencias(conn, trip_id)
    assert [(n["author_id"], n["body"]) for n in notas] == [
        (None, f"Divergencia TMS: conductor reportado por TMS: {otro}")]


async def test_el_mismo_valor_no_repite_la_nota_y_otro_valor_si(conexion_revertida):
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn)
    primero = f"{PREFIX} Uno {_suf()}"
    segundo = f"{PREFIX} Dos {_suf()}"

    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": primero})
    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": primero})
    assert len(await _divergencias(conn, trip_id)) == 1

    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": segundo})
    notas = await _divergencias(conn, trip_id)
    assert [n["body"] for n in notas] == [
        f"Divergencia TMS: conductor reportado por TMS: {primero}",
        f"Divergencia TMS: conductor reportado por TMS: {segundo}",
    ]
    assert all(n["author_id"] is None for n in notas)


async def test_conductor_y_patente_van_en_una_sola_nota_con_el_texto_de_siempre(conexion_revertida):
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn, tractor_plate="ZZDV01")
    otro = f"{PREFIX} Otro {_suf()}"

    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": otro, "tractor_plate": "ZZDV02"})

    assert [n["body"] for n in await _divergencias(conn, trip_id)] == [
        f"Divergencia TMS: conductor reportado por TMS: {otro}, patente reportado por TMS: ZZDV02"]


async def test_el_mismo_nombre_en_otro_orden_mayusculas_y_tildes_no_es_divergencia(conexion_revertida):
    """Se compara con public.name_tokens, la misma normalización del matcher
    (migración 20261016100000)."""
    conn = conexion_revertida
    suf = _suf()
    trip_id, _ = await _viaje_con_vinculo_manual(conn, driver_name=f"{PREFIX} Ñandú Pérez {suf}")

    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": f"PEREZ  nandu {PREFIX.lower()}   {suf.lower()}"})

    assert await _divergencias(conn, trip_id) == []


async def test_la_misma_patente_con_guion_y_minusculas_no_es_divergencia(conexion_revertida):
    """Se compara con public.canonical_plate (migración 20261016100000)."""
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn, tractor_plate="ZZDV12",
                                                 driver_name=f"{PREFIX} Mismo {_suf()}")

    await _nueva_carga_del_tms(conn, trip_id, {"tractor_plate": "zz-dv12"})

    assert await _divergencias(conn, trip_id) == []


async def test_otra_patente_sin_formato_de_patente_se_compara_como_texto(conexion_revertida):
    """Si canonical_plate no reconoce alguno de los dos lados, se compara
    upper(btrim()): ' zzdv-123 ' no es 'ZZDV-124'."""
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn, tractor_plate="ZZDV-124",
                                                 driver_name=f"{PREFIX} Mismo {_suf()}")

    await _nueva_carga_del_tms(conn, trip_id, {"tractor_plate": " zzdv-124 "})
    assert await _divergencias(conn, trip_id) == []

    await _nueva_carga_del_tms(conn, trip_id, {"tractor_plate": "ZZDV-123"})
    assert [n["body"] for n in await _divergencias(conn, trip_id)] == [
        "Divergencia TMS: patente reportado por TMS: ZZDV-123"]


async def test_sin_vinculo_manual_no_hay_divergencia(conexion_revertida):
    """Guarda (no se vio fallar): sin vínculo manual, el vínculo lo arma la
    resolución automática desde el propio TMS y no hay nada que contradecir."""
    conn = conexion_revertida
    trip_id = await insert_tms_trip(conn, await open_status(conn), {"driver_name_tms": f"{PREFIX} A {_suf()}"})

    await _nueva_carga_del_tms(conn, trip_id, {"driver_name_tms": f"{PREFIX} B {_suf()}"})

    assert await _divergencias(conn, trip_id) == []


# ── Abrir el viaje no escribe nada ───────────────────────────────────────────

async def test_abrir_el_viaje_no_escribe_notas(conexion_revertida):
    """La divergencia se arma con la marca del trigger encendida (sin
    `_nueva_carga_del_tms`), así que el trigger no escribe nada: si GET la
    detectara, insertaría."""
    conn = conexion_revertida
    trip_id, _ = await _viaje_con_vinculo_manual(conn)
    await conn.execute(
        "UPDATE app.trips SET fleet = fleet || $2::jsonb WHERE id = $1::uuid",
        trip_id, json.dumps({"driver_name_tms": f"{PREFIX} Otro {_suf()}"}))
    antes = await _notas(conn, trip_id)

    await get_trip(trip_id, pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))

    assert await _notas(conn, trip_id) == antes


# ── Solo una nota del sistema puede no tener autor ───────────────────────────

async def test_una_nota_de_persona_sin_autor_es_rechazada(conexion_revertida):
    conn = conexion_revertida
    with pytest.raises(asyncpg.CheckViolationError) as exc:
        async with conn.transaction():
            await conn.execute(
                "INSERT INTO app.trip_notes (trip_id, author_id, body, note_type) "
                "VALUES ($1, NULL, $2, 'observacion')", uuid.uuid4(), f"{PREFIX} nota")
    assert exc.value.constraint_name == "trip_notes_author_required_unless_system"


async def test_una_nota_del_sistema_sin_autor_es_aceptada(conexion_revertida):
    conn = conexion_revertida
    nota = await conn.fetchval(
        "INSERT INTO app.trip_notes (trip_id, author_id, body, note_type) "
        "VALUES ($1, NULL, $2, 'sistema') RETURNING id", uuid.uuid4(), f"{PREFIX} evento")
    assert nota is not None


# ── La migración de datos ────────────────────────────────────────────────────

def _data_sql() -> str:
    texto = MIGRATION.read_text()
    corte = texto.find("\n" + DATA_MARKER + "\n")
    assert corte != -1, f"no encontré la línea {DATA_MARKER!r} en {MIGRATION.name}"
    return texto[corte:]


def test_la_migracion_no_maneja_su_transaccion():
    for linea in MIGRATION.read_text().splitlines():
        assert linea.strip().upper() not in ("BEGIN;", "COMMIT;")


async def test_la_migracion_quita_el_autor_y_guarda_la_copia(conexion_revertida):
    conn = conexion_revertida
    autor = uuid.UUID((await _usuario_real(conn))["sub"])
    trip_id = uuid.uuid4()
    divergencia = await conn.fetchval(
        "INSERT INTO app.trip_notes (trip_id, author_id, body, note_type) "
        "VALUES ($1, $2, $3, 'sistema') RETURNING id",
        trip_id, autor, f"Divergencia TMS: conductor reportado por TMS: {PREFIX} X")
    otra = await conn.fetchval(
        "INSERT INTO app.trip_notes (trip_id, author_id, body, note_type) "
        "VALUES ($1, $2, $3, 'sistema') RETURNING id",
        trip_id, autor, f"Cambió el estado operativo {PREFIX}")

    await conn.execute("SET LOCAL lock_timeout = '3s'")
    await conn.execute(_data_sql())
    await conn.execute(_data_sql())  # re-ejecutable: la segunda corrida no copia nada

    autores = dict(await conn.fetch("SELECT id, author_id FROM app.trip_notes WHERE trip_id = $1", trip_id))
    assert autores == {divergencia: None, otra: autor}
    copias = await conn.fetch(
        "SELECT action, source, old_value FROM public.audit_log "
        "WHERE entity_type = 'TRIP_NOTE' AND entity_id = $1", divergencia)
    assert len(copias) == 1
    assert copias[0]["action"] == "update" and copias[0]["source"] == "migration"
    assert json.loads(copias[0]["old_value"])["author_id"] == str(autor)
    assert await conn.fetchval(
        "SELECT count(*) FROM public.audit_log WHERE entity_type = 'TRIP_NOTE' AND entity_id = $1", otra) == 0
