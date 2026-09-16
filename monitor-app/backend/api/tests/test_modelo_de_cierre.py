"""Modelo de cierre: app.closure_periods y app.closure_lines.

Diseño: docs/superpowers/specs/2026-09-14-modelo-de-cierre-design.md.
Migración: 20260916235000_modelo_de_cierre_periodos_y_lineas.sql.

Los invariantes viven en la base, así que se prueban contra la base. Todo
corre en la transacción revertida de `conexion_revertida`.
"""
from __future__ import annotations

import uuid
from datetime import date

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

DIA = date.fromisoformat("2026-06-10")


async def _rechaza(conn, sql, *args):
    """True si Postgres rechaza la sentencia. Corre en un SAVEPOINT para que
    el rechazo no aborte la transacción del fixture."""
    savepoint = conn.transaction()
    await savepoint.start()
    try:
        await conn.execute(sql, *args)
        return False
    except asyncpg.PostgresError:
        return True
    finally:
        await savepoint.rollback()


async def _dia_con_una_linea(conn):
    await conn.execute("INSERT INTO app.closure_periods (business_date) VALUES ($1)", DIA)
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name) VALUES ('Conductor modelo de cierre') RETURNING id")
    await conn.execute(
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status) "
        "VALUES ($1, 'DRIVER', $2, 'UNASSIGNED')",
        DIA, conductor,
    )
    return conductor


async def test_un_sujeto_tiene_una_sola_linea_por_dia(conexion_revertida):
    conn = conexion_revertida
    conductor = await _dia_con_una_linea(conn)

    assert await _rechaza(
        conn,
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status) "
        "VALUES ($1, 'DRIVER', $2, 'ASSIGNED')",
        DIA, conductor,
    )


async def test_el_sujeto_polimorfico_tiene_que_existir_en_la_tabla_de_su_tipo(conexion_revertida):
    """Sin FK posible, el trigger es la integridad. Un id de conductor con
    subject_type ASSET es exactamente el falso negativo que este proyecto ya
    tiene anotado con los entity_id polimórficos."""
    conn = conexion_revertida
    conductor = await _dia_con_una_linea(conn)

    assert await _rechaza(
        conn,
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status) "
        "VALUES ($1, 'ASSET', $2, 'ASSIGNED')",
        DIA, conductor,
    )
    assert await _rechaza(
        conn,
        "INSERT INTO app.closure_lines (business_date, subject_type, subject_id, status) "
        "VALUES ($1, 'TRIP', $2, 'ASSIGNED')",
        DIA, uuid.uuid4(),
    )


async def test_una_vigencia_exige_motivo(conexion_revertida):
    conn = conexion_revertida
    conductor = await _dia_con_una_linea(conn)

    assert await _rechaza(
        conn,
        "UPDATE app.closure_lines SET valid_until = $1 WHERE subject_id = $2",
        date.fromisoformat("2026-06-12"), conductor,
    )


async def test_un_dia_cerrado_tiene_firma(conexion_revertida):
    conn = conexion_revertida
    await _dia_con_una_linea(conn)

    assert await _rechaza(
        conn, "UPDATE app.closure_periods SET status = 'CLOSED' WHERE business_date = $1", DIA,
    )


async def test_las_dos_tablas_nacen_con_rls_y_politica_de_lectura(conexion_revertida):
    """Es el paso que se perdió al copiar driver_day_status a
    equipment_day_status: esas gemelas tienen RLS apagada y cero políticas."""
    filas = await conexion_revertida.fetch(
        """
        SELECT c.relname, c.relrowsecurity,
               (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname IN ('closure_periods', 'closure_lines')
        """)

    assert {f["relname"]: (f["relrowsecurity"], f["politicas"] > 0) for f in filas} == {
        "closure_periods": (True, True),
        "closure_lines": (True, True),
    }
