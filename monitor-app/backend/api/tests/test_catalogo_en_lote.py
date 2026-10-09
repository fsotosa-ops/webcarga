"""Editar el catálogo en lote: vista previa y publicación (HU-C1, entrega 2c).

La tabla de Configuración junta cambios en un borrador; "Ver efecto" los
ensaya todos juntos y "Publicar" los guarda y aplica en una sola transacción.

Se llaman los endpoints reales sobre la base, en una transacción revertida:
la coherencia de la regla la hace cumplir un trigger diferido, y la siembra
lee lo que la misma transacción acaba de escribir. AsyncMock no ve ninguna
de las dos cosas. Los nombres son SINTÉTICOS."""
from __future__ import annotations

import re
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.routers.requirements import (
    create_requirement,
    publicar_lote,
    ver_efecto_del_lote,
)
from app.schemas.requirement import LoteDeCambios, RequirementCreateBody
from tests.conftest import PoolDeUnaConexion, _usuario_real

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


async def _nuevo(conn, *, entidad: str = "CARRIER") -> str:
    creado = await create_requirement(
        RequirementCreateBody(name=f"ZZ-TEST-LOTE {uuid4().hex[:8]}", target_entity=entidad),
        pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))
    return creado["id"]


async def _aprobado_sin_emision(conn, requisito) -> None:
    empresa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-LOTE {uuid4().hex[:8]}", f"ZZ-TEST-LOTE-{uuid4().hex[:8]}")
    await conn.execute(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, file_url) "
        "VALUES ($1, 'CARRIER', $2, 'APPROVED', 'carrier/x/doc.pdf')",
        empresa, requisito)


def _lote(*cambios: tuple[str, dict]) -> LoteDeCambios:
    return LoteDeCambios(cambios=[{"requirement_id": r, "patch": p} for r, p in cambios])


async def _publicar(conn, lote):
    return await publicar_lote(lote, pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))


async def _ver_efecto(conn, lote):
    return await ver_efecto_del_lote(lote, pool=PoolDeUnaConexion(conn), user=await _usuario_real(conn))


async def _politica(conn, requisito) -> str:
    return await conn.fetchval(
        "SELECT expiration_policy FROM public.compliance_requirements WHERE id = $1", requisito)


# ── Ver efecto ───────────────────────────────────────────────────────────────

async def test_el_efecto_del_lote_suma_los_documentos_y_no_guarda(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    a, b = await _nuevo(conexion_revertida), await _nuevo(conexion_revertida)
    for requisito in (a, a, b):
        await _aprobado_sin_emision(conexion_revertida, requisito)
    anual = {"vigencia": {"politica": "ISSUE_PLUS_MONTHS", "validity_months": 12}}

    efecto = await _ver_efecto(conexion_revertida, _lote((a, anual), (b, anual)))

    por_id = {d["requirement_id"]: d for d in efecto["por_documento"]}
    assert por_id[a]["despues"]["vencidos"] == 2
    assert por_id[b]["despues"]["vencidos"] == 1
    assert efecto["total"]["antes"]["vencidos"] == 0
    assert efecto["total"]["despues"]["vencidos"] == 3
    assert await _politica(conexion_revertida, a) == "NONE"


async def test_el_efecto_anuncia_cuantos_pendientes_crea_activar(conexion_revertida):
    """Activar siembra un pendiente por empresa: el número se ve ANTES."""
    await _cargar_m6(conexion_revertida)
    requisito = await _nuevo(conexion_revertida)
    empresas = await conexion_revertida.fetchval("SELECT count(*) FROM public.carriers")

    efecto = await _ver_efecto(conexion_revertida, _lote((requisito, {"is_active": True})))

    assert efecto["total"]["crear"] == empresas
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.compliance_records WHERE requirement_id = $1",
        requisito) == 0


# ── Publicar ─────────────────────────────────────────────────────────────────

async def test_publicar_guarda_todo_y_siembra_lo_activado(conexion_revertida):
    await _cargar_m6(conexion_revertida)
    a, b = await _nuevo(conexion_revertida), await _nuevo(conexion_revertida)

    resultado = await _publicar(conexion_revertida, _lote(
        (a, {"is_active": True, "vigencia": F30_1}),
        (b, {"exigible_on": "ON_REQUEST"}),
    ))

    assert resultado["actualizados"] == 2
    assert await _politica(conexion_revertida, a) == "CALENDAR_PERIOD"
    assert await conexion_revertida.fetchval(
        "SELECT exigible_on FROM public.compliance_requirements WHERE id = $1", b) == "ON_REQUEST"
    sembrados = await conexion_revertida.fetchval(
        "SELECT count(*) FROM public.compliance_records WHERE requirement_id = $1 AND is_current", a)
    assert sembrados > 0
    assert resultado["creados"] == sembrados


async def test_si_un_cambio_es_invalido_no_se_guarda_ninguno(conexion_revertida):
    """Atómico: un borrador a medias publicado sería una regla que nadie vio."""
    await _cargar_m6(conexion_revertida)
    a, b = await _nuevo(conexion_revertida), await _nuevo(conexion_revertida)
    nombre_b = await conexion_revertida.fetchval(
        "SELECT name FROM public.compliance_requirements WHERE id = $1", b)

    with pytest.raises(HTTPException) as error:
        await _publicar(conexion_revertida, _lote(
            (a, {"vigencia": F30_1}),
            (b, {"vigencia": {**F30_1, "cutoff_day": None}}),
        ))

    assert error.value.status_code == 422
    # El mensaje dice CUÁL documento: con 75 en el borrador, "falta el día de
    # corte" a secas no sirve para corregirlo.
    assert nombre_b in error.value.detail
    assert await _politica(conexion_revertida, a) == "NONE"


def test_un_documento_repetido_en_el_lote_no_valida():
    """FastAPI lo devuelve como 422 antes de tocar la base."""
    requisito = str(uuid4())
    with pytest.raises(ValidationError, match="dos veces"):
        _lote((requisito, {"is_active": True}), (requisito, {"is_active": False}))


async def test_un_documento_que_no_existe_es_404(conexion_revertida):
    with pytest.raises(HTTPException) as error:
        await _publicar(conexion_revertida, _lote((str(uuid4()), {"is_active": True})))
    assert error.value.status_code == 404
