"""La firma del Cierre es inmutable y cada día firmado tiene su versión 1 (spec 2026-10-10 anulación y firma versionada, §3)."""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

TABLAS = ("app.closure_signatures", "app.closure_signature_lines", "app.closure_signature_trips")


async def _una_firma(conn, tabla: str) -> int:
    """Una firma con al menos una fila en `tabla`: si no la hay (la copia local tiene
    una firma sin líneas), el test la agrega. Insertar en una firma está permitido;
    lo que se prueba es que después no se modifica ni se borra. Sin fila, el UPDATE
    no toca nada y el trigger nunca corre: el test pasaría o fallaría por el dato."""
    firma = await conn.fetchval("SELECT id FROM app.closure_signatures ORDER BY id LIMIT 1")
    assert firma is not None, "precondición: hay al menos un día firmado"
    if tabla == "app.closure_signature_lines":
        await conn.execute(
            "INSERT INTO app.closure_signature_lines (signature_id, subject_type, subject_id, status, requires_reason, computed_at) "
            "SELECT $1, 'DRIVER', gen_random_uuid(), 'OK', false, now() "
            "WHERE NOT EXISTS (SELECT 1 FROM app.closure_signature_lines WHERE signature_id = $1)", firma)
    elif tabla == "app.closure_signature_trips":
        await conn.execute(
            "INSERT INTO app.closure_signature_trips (signature_id, trip_id) SELECT $1, gen_random_uuid() "
            "WHERE NOT EXISTS (SELECT 1 FROM app.closure_signature_trips WHERE signature_id = $1)", firma)
    return firma


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_modifica(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn, tabla)
    col = "id" if tabla == "app.closure_signatures" else "signature_id"
    # `id` es GENERATED ALWAYS: Postgres rechaza actualizarlo antes del trigger.
    campo = "version" if tabla == "app.closure_signatures" else "signature_id"
    with pytest.raises(asyncpg.RaiseError, match="inmutable"):
        async with conn.transaction():
            await conn.execute(f"UPDATE {tabla} SET {campo} = {campo} WHERE {col} = $1", firma)


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_borra(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn, tabla)
    col = "id" if tabla == "app.closure_signatures" else "signature_id"
    with pytest.raises(asyncpg.RaiseError, match="inmutable"):
        async with conn.transaction():
            await conn.execute(f"DELETE FROM {tabla} WHERE {col} = $1", firma)


async def test_cada_dia_firmado_tiene_su_version_1_con_sus_lineas(conexion_revertida):
    conn = conexion_revertida
    faltan = await conn.fetch(
        """
        SELECT p.business_date
        FROM app.closure_periods p
        LEFT JOIN app.closure_signatures s ON s.business_date = p.business_date AND s.version = 1
        WHERE p.status = 'CLOSED'
          AND (s.id IS NULL
               OR (SELECT count(*) FROM app.closure_signature_lines l WHERE l.signature_id = s.id)
                  <> (SELECT count(*) FROM app.closure_lines c WHERE c.business_date = p.business_date)
               OR (SELECT count(*) FROM app.closure_signature_trips v WHERE v.signature_id = s.id)
                  <> (s.totals->>'viajes')::int)
        """)
    assert faltan == []
