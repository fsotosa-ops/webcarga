"""Configurar la vigencia y la exigibilidad desde el catálogo (HU-C1, entrega 2b, F5).

Se llaman los endpoints reales sobre la base, en una transacción revertida:
- la coherencia la hace cumplir la base (trigger diferido), no una segunda
  validación en Python;
- el versionado (regla 6) depende de qué hay guardado.

AsyncMock no ve ninguna de las dos cosas. Los nombres son SINTÉTICOS."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.requirements import (
    create_requirement,
    list_compliance_requirements,
    patch_requirement_conditions,
    preview_vigencia,
)
from app.schemas.requirement import (
    RequirementConditionsPatchBody,
    RequirementCreateBody,
    VigenciaBody,
)
from tests.conftest import USER, PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

MIGRACION_M6 = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261009100000_vigencia_mensual_exige_aviso.sql"
)
F30_1 = dict(politica="CALENDAR_PERIOD", frequency_months=1, cutoff_day=18,
             period_offset_months=1, warning_days=5)


async def _cargar_m6(conn) -> None:
    for sentencia in re.findall(r"CREATE OR REPLACE FUNCTION.*?\$\$;",
                                MIGRACION_M6.read_text(), re.S):
        await conn.execute(sentencia)


async def _hoy(conn, dia: dt.date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$"
    )


async def _nuevo(conn, *, vigencia: dict | None = None, exigible_on: str | None = None,
                 entidad: str = "CARRIER") -> str:
    cuerpo = {"name": f"ZZ-TEST-VIGCONF {uuid4().hex[:8]}", "target_entity": entidad}
    if vigencia is not None:
        cuerpo["vigencia"] = vigencia
    if exigible_on is not None:
        cuerpo["exigible_on"] = exigible_on
    creado = await create_requirement(
        RequirementCreateBody(**cuerpo), pool=PoolDeUnaConexion(conn),
        user=await _usuario_real(conn))
    return creado["id"]


async def _patch(conn, requisito, **campos):
    return await patch_requirement_conditions(
        requisito, RequirementConditionsPatchBody(**campos),
        pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))


async def _del_catalogo(conn, requisito) -> dict:
    catalogo = await list_compliance_requirements(
        target_entity=None, pool=PoolDeUnaConexion(conn), _=USER)
    return next(f for f in catalogo if f["id"] == str(requisito))


async def _versiones(conn, requisito) -> list:
    return await conn.fetch(
        "SELECT vigente_desde, cutoff_day FROM public.compliance_requirement_rules "
        "WHERE requirement_id = $1 AND shipper_id IS NULL ORDER BY vigente_desde",
        requisito)


async def _registro_con_archivo(conn, requisito) -> None:
    empresa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-VIGCONF {uuid4().hex[:8]}", f"ZZ-TEST-VIGCONF-{uuid4().hex[:8]}")
    await conn.execute(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, file_url, period_start) "
        "VALUES ($1, 'CARRIER', $2, 'APPROVED', 'carrier/x/f30.pdf', DATE '2026-09-01')",
        empresa, requisito)


# ── Guardar y leer ───────────────────────────────────────────────────────────

async def test_el_catalogo_devuelve_la_vigencia_y_cuando_se_exige(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    await _patch(conexion_revertida, requisito, vigencia=F30_1, exigible_on="ON_REQUEST")

    fila = await _del_catalogo(conexion_revertida, requisito)
    assert fila["expiration_policy"] == "CALENDAR_PERIOD"
    assert fila["exigible_on"] == "ON_REQUEST"
    assert (fila["vigencia"]["cutoff_day"], fila["vigencia"]["warning_days"]) == (18, 5)
    assert fila["tiene_versiones"] is False


async def test_guardar_la_vigencia_queda_auditado(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    await _patch(conexion_revertida, requisito, vigencia=F30_1)
    campos = await conexion_revertida.fetch(
        "SELECT field FROM public.audit_log WHERE entity_id = $1::uuid", str(requisito))
    assert "vigencia" in {c["field"] for c in campos}


async def test_crear_con_vigencia_nace_apagado_y_con_su_regla(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1, exigible_on="ON_ENTITY_START")
    fila = await _del_catalogo(conexion_revertida, requisito)
    assert fila["is_active"] is False
    assert fila["vigencia"]["cutoff_day"] == 18


async def test_un_documento_que_no_vence_no_guarda_reglas(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _patch(conexion_revertida, requisito, vigencia={"politica": "NONE"})
    assert await _versiones(conexion_revertida, requisito) == []
    assert (await _del_catalogo(conexion_revertida, requisito))["vigencia"] is None


# ── Versionado (regla 6) ─────────────────────────────────────────────────────

async def test_sin_uso_cambiar_parametros_corrige_la_regla(conexion_revertida):
    """Nadie cargó nada todavía: no hay pasado que proteger."""
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": 15})
    versiones = await _versiones(conexion_revertida, requisito)
    assert [v["cutoff_day"] for v in versiones] == [15]


async def test_en_uso_cambiar_parametros_rige_desde_hoy(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 10, 8))
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _registro_con_archivo(conexion_revertida, requisito)
    await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": 15})

    versiones = await _versiones(conexion_revertida, requisito)
    assert [v["cutoff_day"] for v in versiones] == [18, 15]
    assert versiones[1]["vigente_desde"] == dt.date(2026, 10, 8)
    assert (await _del_catalogo(conexion_revertida, requisito))["tiene_versiones"] is True


async def test_dos_cambios_el_mismo_dia_dejan_una_sola_version_de_hoy(conexion_revertida):
    """Review Focus 2: el segundo cambio de hoy corrige el primero, no choca
    con la unicidad (requirement_id, shipper_id, vigente_desde)."""
    await _cargar_m6(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 10, 8))
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _registro_con_archivo(conexion_revertida, requisito)
    await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": 15})
    await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": 12})
    assert [v["cutoff_day"] for v in await _versiones(conexion_revertida, requisito)] == [18, 12]


async def test_cambiar_de_tipo_reinicia_la_regla(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 10, 8))
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _registro_con_archivo(conexion_revertida, requisito)
    await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": 15})
    await _patch(conexion_revertida, requisito,
                 vigencia={"politica": "ISSUE_PLUS_MONTHS", "validity_months": 12})
    versiones = await _versiones(conexion_revertida, requisito)
    assert len(versiones) == 1
    assert await conexion_revertida.fetchval(
        "SELECT vigente_desde = '-infinity'::date FROM public.compliance_requirement_rules "
        "WHERE requirement_id = $1", requisito)


async def test_guardar_lo_mismo_no_crea_version(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _registro_con_archivo(conexion_revertida, requisito)
    await _patch(conexion_revertida, requisito, vigencia=F30_1)
    assert len(await _versiones(conexion_revertida, requisito)) == 1


# ── Errores legibles ─────────────────────────────────────────────────────────

async def test_un_mensual_sin_dias_de_aviso_no_se_guarda(conexion_revertida):
    """M6: con el aviso general de 30, un mensual estaria siempre por vencer."""
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    with pytest.raises(HTTPException) as error:
        await _patch(conexion_revertida, requisito,
                     vigencia={**F30_1, "warning_days": None})
    assert error.value.status_code == 422
    assert "aviso" in error.value.detail


async def test_un_mensual_sin_dia_tope_da_el_mensaje_de_la_base(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    with pytest.raises(HTTPException) as error:
        await _patch(conexion_revertida, requisito, vigencia={**F30_1, "cutoff_day": None})
    assert error.value.status_code == 422
    assert "día de corte" in error.value.detail


async def test_mes_siguiente_para_una_empresa_es_422_y_no_500(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    with pytest.raises(HTTPException) as error:
        await _patch(conexion_revertida, requisito, exigible_on="MONTH_AFTER_START")
    assert error.value.status_code == 422


# ── Vista previa del efecto (Task 2) ─────────────────────────────────────────

async def _aprobado_sin_emision(conn, requisito) -> None:
    empresa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-VIGCONF {uuid4().hex[:8]}", f"ZZ-TEST-VIGCONF-{uuid4().hex[:8]}")
    await conn.execute(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, file_url) "
        "VALUES ($1, 'CARRIER', $2, 'APPROVED', 'carrier/x/doc.pdf')",
        empresa, requisito)


async def test_la_vista_previa_anuncia_los_que_pasan_a_vencidos(conexion_revertida):
    """Review Focus 1: de NONE a anual, los aprobados sin fecha de emision no
    cubren nada. Se anuncia antes de guardar, y no se guarda nada."""
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    await _aprobado_sin_emision(conexion_revertida, requisito)
    await _aprobado_sin_emision(conexion_revertida, requisito)

    efecto = await preview_vigencia(
        requisito, VigenciaBody(politica="ISSUE_PLUS_MONTHS", validity_months=12),
        pool=PoolDeUnaConexion(conexion_revertida), _=USER)

    assert efecto["antes"]["vencidos"] == 0
    assert efecto["despues"]["vencidos"] == 2
    assert (await _del_catalogo(conexion_revertida, requisito))["expiration_policy"] == "NONE"


async def test_la_vista_previa_dice_si_rige_desde_hoy(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida, vigencia=F30_1)
    await _registro_con_archivo(conexion_revertida, requisito)
    efecto = await preview_vigencia(
        requisito, VigenciaBody(**{**F30_1, "cutoff_day": 15}),
        pool=PoolDeUnaConexion(conexion_revertida), _=USER)
    assert efecto["rige_desde_hoy"] is True
