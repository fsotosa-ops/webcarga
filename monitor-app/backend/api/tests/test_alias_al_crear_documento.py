"""Un documento nuevo no puede nacer invisible para el clasificador.

Contra Postgres real: el INSERT del alias va en la MISMA transacción que el del
requisito, y eso un AsyncMock no lo puede contradecir.

POR QUÉ EXISTE. El motor de match resuelve buscando alias dentro del nombre del
archivo normalizado. Sin un solo alias, el documento es invisible: todo archivo
suyo cae en "sin resolver" para siempre. Desde que se pueden crear documentos
desde la pantalla (Ronda 140) eso pasaba con cada alta, EN SILENCIO — nada
falla, el documento simplemente nunca matchea. Es la misma familia que el resto
de los huecos de este módulo: la capacidad existía y faltaba la puerta.
"""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.routers.requirements import create_requirement
from app.schemas.requirement import RequirementCreateBody
from app.services.document_matcher import normalize_text
from tests.conftest import PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion


async def _crear(conexion, nombre: str):
    pool = PoolDeUnaConexion(conexion)
    usuario = await _usuario_real(conexion)
    return await create_requirement(
        body=RequirementCreateBody(
            name=nombre, target_entity="CARRIER", requirement_level="LEGAL_MANDATORY",
        ),
        pool=pool, user=usuario,
    )


async def _alias_de(conexion, requirement_id: str) -> list[str]:
    filas = await conexion.fetch(
        "SELECT alias FROM public.requirement_filename_aliases "
        "WHERE requirement_id = $1::uuid ORDER BY alias",
        requirement_id,
    )
    return [f["alias"] for f in filas]


async def test_nace_con_su_alias(conexion_revertida):
    nombre = f"ZZ Test Documento {uuid4().hex[:8]}"
    creado = await _crear(conexion_revertida, nombre)

    assert await _alias_de(conexion_revertida, creado["id"]) == [normalize_text(nombre)]


async def test_el_alias_es_el_NOMBRE_normalizado_y_no_el_codigo(conexion_revertida):
    """El nombre es lo que la gente escribe en el archivo. Un código interno no
    aparece en ningún archivo real: sembrar desde ahí daría un alias que nunca
    matchea, que es lo mismo que no sembrar nada."""
    nombre = f"ZZ Póliza de Prueba {uuid4().hex[:6]}"
    creado = await _crear(conexion_revertida, nombre)

    alias = (await _alias_de(conexion_revertida, creado["id"]))[0]
    assert alias == alias.upper(), "el alias tiene que ir normalizado"
    assert "Ó" not in alias and "ó" not in alias, "la normalización quita las tildes"
    assert alias != creado["requirement_code"], (
        f"se sembró el código ({creado['requirement_code']}) en vez del nombre"
    )


async def test_el_alias_sembrado_hace_que_el_documento_sea_encontrable(conexion_revertida):
    """La prueba que importa: un archivo con ese nombre resuelve a ese
    documento. Sin el alias, el mismo archivo cae en "sin resolver"."""
    nombre = f"ZZ Certificado Especial {uuid4().hex[:6]}"
    creado = await _crear(conexion_revertida, nombre)

    alias = (await _alias_de(conexion_revertida, creado["id"]))[0]
    nombre_de_archivo = f"{nombre.replace(' ', '_')}_77094744-8.pdf"

    assert alias in normalize_text(nombre_de_archivo), (
        f"el alias {alias!r} no aparece en {normalize_text(nombre_de_archivo)!r}"
    )
