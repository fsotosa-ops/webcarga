"""D1, B-8 (spec §5.2): cuándo se exige un documento depende del tipo de quien
lo debe. `exigible_sql` y `exigible_desde_sql` miraban driver_assignments para
cualquier entidad: el documento al término de un equipo nunca se exigía, y el
"mes siguiente al ingreso" de un equipo se exigía desde el primer día.

Hoy la CHECK compliance_requirements_exigible_on_entity_check solo admite
MONTH_AFTER_START y ON_ENTITY_END en requisitos de conductor, así que ningún
registro real cae en estas ramas (ruling A-R2). El registro del test es de tipo
ASSET y apunta a un requisito de conductor: los predicados leen `cr.entity_type`,
no el `target_entity` del requisito, y así se prueba la rama sin tocar la CHECK
(un ALTER TABLE tomaría un lock exclusivo sobre compliance_requirements durante
todo el test). Contra la base real, en una transacción revertida; requisitos
apagados (is_active = false) y sujetos ZZ-TEST-D1."""
from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.vencimientos import document_state_sql, exigible_desde_sql
from tests.conftest import insertar_asignacion

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-D1"


def _suf() -> str:
    return uuid4().hex[:6].upper()


async def _empresa(conn) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIJO} Empresa {_suf()}"))


async def _equipo(conn, empresa: str, *, asignacion: str, desde: str = "public.hoy_chile() - 400") -> str:
    a = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{_suf()[:4]}"))
    # `desde` es SQL fijo de este archivo (nunca entrada de usuario).
    await insertar_asignacion(conn, "ASSET", a, empresa, status=asignacion,
                              desde=await conn.fetchval(f"SELECT {desde}"))
    return a


async def _requisito(conn, exigible_on: str) -> str:
    # target_entity DRIVER: la CHECK no admite otro con estos exigible_on (ver docstring).
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ('DRIVER', $1, $2, 'LEGAL_MANDATORY', 'NONE', $3, false, true)
        RETURNING id
        """,
        f"ZZ_D1_{_suf()}", f"{PREFIJO} documento", exigible_on))


async def _registro_del_equipo(conn, requisito: str, equipo: str) -> str:
    return str(await conn.fetchval(
        "INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current) "
        "VALUES ($1, 'ASSET', $2, 'MISSING', true) RETURNING id", equipo, requisito))


async def _estado_y_desde(conn, registro: str):
    return await conn.fetchrow(
        f"SELECT {document_state_sql('cr')} AS estado, {exigible_desde_sql('cr')} AS desde "
        "FROM public.compliance_records cr WHERE cr.id = $1", registro)


async def test_el_documento_al_termino_de_un_equipo_que_se_fue_se_exige(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="INACTIVE")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "ON_ENTITY_END"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "MISSING"


async def test_el_documento_al_termino_de_un_equipo_asignado_aun_no_se_exige(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "ON_ENTITY_END"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "NOT_REQUIRED"


async def test_un_equipo_que_ingreso_este_mes_aun_no_debe_lo_del_mes_siguiente(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE", desde="public.hoy_chile()")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "MONTH_AFTER_START"), equipo)
    primero_del_mes_siguiente = await conn.fetchval(
        "SELECT (date_trunc('month', public.hoy_chile()) + interval '1 month')::date")

    fila = await _estado_y_desde(conn, registro)

    assert fila["estado"] == "NOT_REQUIRED"
    assert fila["desde"] == primero_del_mes_siguiente


async def test_un_equipo_que_ingreso_hace_mas_de_un_mes_ya_lo_debe(conexion_revertida):
    conn = conexion_revertida
    equipo = await _equipo(conn, await _empresa(conn), asignacion="ACTIVE", desde="public.hoy_chile() - 400")
    registro = await _registro_del_equipo(conn, await _requisito(conn, "MONTH_AFTER_START"), equipo)

    assert (await _estado_y_desde(conn, registro))["estado"] == "MISSING"
