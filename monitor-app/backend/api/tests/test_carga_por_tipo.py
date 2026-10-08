"""Qué se pide al cargar un documento, según su tipo de vigencia (HU-C1,
entrega 2b, F4).

Una sola definición —`campos_que_pide`— para la carga directa, la masiva, la
bandeja y la planilla. Antes eran `lleva_fecha` y `exige_fecha`, que desde la
entrega 2 decían "lleva fecha de vencimiento" a un mensual (todo lo que no
fuera NONE)."""
from __future__ import annotations

import datetime as dt
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.services.vencimientos import (
    campos_que_pide,
    falta_para_aprobar,
    lleva_fecha_sql,
)
from tests.conftest import USER, PoolDeUnaConexion, wire_transactional_conn
from tests.test_compliance import make_client

D = dt.date


# ── La regla ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("politica,fecha,emision,periodo", [
    ("NONE", "no", False, False),
    ("REQUIRED", "obligatoria", False, False),
    ("OPTIONAL", "opcional", False, False),
    ("ISSUE_PLUS_MONTHS", "no", True, False),
    ("CALENDAR_PERIOD", "no", False, True),
])
def test_cada_tipo_pide_lo_suyo(politica, fecha, emision, periodo):
    c = campos_que_pide(politica)
    assert (c.fecha, c.emision, c.periodo) == (fecha, emision, periodo)


def test_un_mensual_no_lleva_fecha_de_vencimiento_en_sql():
    """La planilla pregunta "lleva fecha" con la versión SQL: un mensual o un
    anual no la llevan (llevan período o emisión)."""
    sql = lleva_fecha_sql("r")
    assert "'REQUIRED'" in sql and "'OPTIONAL'" in sql
    assert "<> 'NONE'" not in sql


@pytest.mark.parametrize("politica,datos,mensaje", [
    ("REQUIRED", {}, "fecha de vencimiento"),
    ("ISSUE_PLUS_MONTHS", {}, "fecha de emisión"),
    ("CALENDAR_PERIOD", {}, "período"),
    ("OPTIONAL", {}, None),
    ("NONE", {}, None),
    ("CALENDAR_PERIOD", {"period_start": D(2026, 9, 1)}, None),
])
def test_que_falta_para_dar_por_recibido(politica, datos, mensaje):
    falta = falta_para_aprobar(politica, expiration_date=datos.get("expiration_date"),
                               issue_date=datos.get("issue_date"),
                               period_start=datos.get("period_start"))
    if mensaje is None:
        assert falta is None
    else:
        assert mensaje in falta


# ── La carga directa ────────────────────────────────────────────────────────

def _registro(politica, **extra):
    return {"entity_id": "c1", "entity_type": "CARRIER", "status": "MISSING",
            "expiration_date": None, "issue_date": None, "period_start": None,
            "metadata": {}, "expiration_policy": politica, **extra}


def _subir(pool, supabase, **data):
    client = make_client(pool, supabase=supabase)
    return client.post(
        "/api/v1/compliance-records/r1/file",
        files={"file": ("f30.pdf", b"contenido", "application/pdf")},
        data=data,
    )


def _storage():
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


def test_un_mensual_sin_periodo_se_rechaza_antes_de_subir():
    pool, conn, supabase = AsyncMock(), AsyncMock(), _storage()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = _registro("CALENDAR_PERIOD")

    res = _subir(pool, supabase)

    assert res.status_code == 422
    assert "período" in res.json()["detail"]
    supabase.storage.from_.return_value.upload.assert_not_called()


def test_el_periodo_se_guarda_como_el_dia_1_del_mes():
    pool, conn, supabase = AsyncMock(), AsyncMock(), _storage()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = _registro("CALENDAR_PERIOD")

    res = _subir(pool, supabase, period_start="2026-09-17")

    assert res.status_code == 201
    update = conn.execute.call_args_list[0]
    assert "period_start" in update.args[0]
    assert D(2026, 9, 1) in update.args


def test_un_periodo_anterior_al_cargado_se_rechaza_sin_subir():
    """Review Focus 4: subir el de agosto cuando ya está el de octubre
    retrocedería el estado del documento."""
    pool, conn, supabase = AsyncMock(), AsyncMock(), _storage()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = _registro("CALENDAR_PERIOD", period_start=D(2026, 10, 1))

    res = _subir(pool, supabase, period_start="2026-08-01")

    assert res.status_code == 409
    assert "octubre" in res.json()["detail"].lower()
    supabase.storage.from_.return_value.upload.assert_not_called()


def test_un_anual_pide_la_fecha_de_emision():
    pool, conn, supabase = AsyncMock(), AsyncMock(), _storage()
    wire_transactional_conn(pool, conn)
    pool.fetchrow.return_value = _registro("ISSUE_PLUS_MONTHS")

    assert _subir(pool, supabase).status_code == 422

    res = _subir(pool, supabase, issue_date="2026-03-10")
    assert res.status_code == 201
    update = conn.execute.call_args_list[0]
    assert "issue_date" in update.args[0]
    assert D(2026, 3, 10) in update.args


# ── Lo que se muestra: el vencimiento calculado ─────────────────────────────

@pytest.mark.integracion
async def test_la_cola_trae_el_vencimiento_calculado(conexion_revertida):
    from app.routers.compliance import list_pending_compliance_records

    conn = conexion_revertida
    s = uuid4().hex[:8]
    empresa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-CARGA {s}", f"ZZ-TEST-CARGA-{s}")
    requisito = await conn.fetchval(
        """INSERT INTO public.compliance_requirements
             (requirement_code, name, target_entity, requirement_level, expiration_policy, is_active)
           VALUES ($1, $2, 'CARRIER', 'LEGAL_MANDATORY', 'CALENDAR_PERIOD', false) RETURNING id""",
        f"ZZ_CARGA_{s.upper()}", f"ZZ-TEST-CARGA {s}")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules "
        "(requirement_id, frequency_months, cutoff_day, period_offset_months, warning_days) "
        "VALUES ($1, 1, 18, 1, 5)", requisito)
    await conn.execute(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, file_url, period_start) "
        "VALUES ($1, 'CARRIER', $2, 'APPROVED_MANUAL', 'carrier/x/f30.pdf', DATE '2026-09-01')",
        empresa, requisito)

    respuesta = await list_pending_compliance_records(
        carrier_id=str(empresa), category=None, requirement_code=None, q="",
        operation_type=None, entity_id=None, limit=200, offset=0, estado="todos",
        pool=PoolDeUnaConexion(conn), _=USER)
    fila = next(f for f in respuesta["rows"] if f["requirement_id"] == str(requisito))
    assert fila["vence_el"] == D(2026, 11, 18)
    assert fila["period_start"] == D(2026, 9, 1)
