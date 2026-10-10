"""La firma del Cierre es inmutable y cada día firmado tiene su versión 1 (spec 2026-10-10 anulación y firma versionada, §3)."""
from __future__ import annotations

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

TABLAS = ("app.closure_signatures", "app.closure_signature_lines", "app.closure_signature_trips")


async def _una_firma(conn) -> int:
    return await conn.fetchval("SELECT id FROM app.closure_signatures ORDER BY id LIMIT 1")


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_modifica(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn)
    col = "id" if tabla == "app.closure_signatures" else "signature_id"
    # `id` es GENERATED ALWAYS: Postgres rechaza actualizarlo antes del trigger.
    campo = "version" if tabla == "app.closure_signatures" else "signature_id"
    with pytest.raises(asyncpg.RaiseError, match="inmutable"):
        async with conn.transaction():
            await conn.execute(f"UPDATE {tabla} SET {campo} = {campo} WHERE {col} = $1", firma)


@pytest.mark.parametrize("tabla", TABLAS)
async def test_la_firma_no_se_borra(conexion_revertida, tabla):
    conn = conexion_revertida
    firma = await _una_firma(conn)
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
