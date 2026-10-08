"""Los predicados de vencimientos.py, ejecutados contra la base.

Un predicado que nombra una columna que su CTE no proyecta compila en Python
y revienta en Postgres. AsyncMock no lo ve, asi que aca se ejecutan los
predicados sobre registros creados por el test y cada lectura real que los
usa. Los nombres son SINTETICOS."""
import datetime as dt
from uuid import uuid4

import pytest

from app.routers.compliance import (
    get_certification_status,
    get_compliance_summary,
    list_pending_compliance_records,
)
from app.services.plantilla_certificacion import sql_filas_plantilla
from app.services.vencimientos import (
    pendiente_predicate,
    por_vencer_predicate,
    vencido_predicate,
)

from tests.conftest import USER, PoolDeUnaConexion

pytestmark = pytest.mark.integracion
D = dt.date


async def _hoy(conn, dia: dt.date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$"
    )


async def _caso(conn, politica, **registro):
    s = uuid4().hex[:8].upper()
    empresa = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-PRED {s}", f"ZZ-TEST-PRED-{s}",
    )
    req = await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, is_active)
        VALUES ($1, $2, 'CARRIER', 'LEGAL_MANDATORY', $3, false)
        RETURNING id
        """,
        f"ZZ_PRED_{s}", f"ZZ-TEST-PRED {s}", politica,
    )
    if politica == "CALENDAR_PERIOD":
        await conn.execute(
            "INSERT INTO public.compliance_requirement_rules "
            "(requirement_id, frequency_months, cutoff_day, period_offset_months, warning_days) "
            "VALUES ($1, 1, 18, 1, 5)", req,
        )
    await conn.execute(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status,
             expiration_date, issue_date, period_start)
        VALUES ($1, 'CARRIER', $2, $3, $4, $5, $6)
        """,
        empresa, req, registro.get("status", "APPROVED"), registro.get("expiration_date"),
        registro.get("issue_date"), registro.get("period_start"),
    )
    return empresa, req


async def _estado(conn, empresa, req):
    return await conn.fetchrow(
        f"""
        SELECT {vencido_predicate('cr')}    AS vencido,
               {por_vencer_predicate('cr')} AS por_vencer,
               {pendiente_predicate('cr')}  AS pendiente
        FROM public.compliance_records cr
        WHERE cr.entity_id = $1 AND cr.requirement_id = $2
        """,
        empresa, req,
    )


async def test_f30_1_de_agosto_esta_vencido_el_19_de_octubre(conexion_revertida):
    empresa, req = await _caso(conexion_revertida, "CALENDAR_PERIOD", period_start=D(2026, 8, 1))
    await _hoy(conexion_revertida, D(2026, 10, 19))
    fila = await _estado(conexion_revertida, empresa, req)
    assert (fila["vencido"], fila["pendiente"]) == (True, True)


async def test_f30_1_de_septiembre_esta_al_dia_el_19_de_octubre(conexion_revertida):
    """Con 5 dias de aviso propios. Con el aviso general de 30, un mensual
    estaria siempre "por vencer" (vence el 18/11, avisa desde el 19/10): un
    tipo mensual necesita sus dias de aviso."""
    empresa, req = await _caso(conexion_revertida, "CALENDAR_PERIOD", period_start=D(2026, 9, 1))
    await _hoy(conexion_revertida, D(2026, 10, 19))
    fila = await _estado(conexion_revertida, empresa, req)
    assert (fila["vencido"], fila["por_vencer"], fila["pendiente"]) == (False, False, False)


async def test_el_dia_del_vencimiento_todavia_no_esta_vencido(conexion_revertida):
    empresa, req = await _caso(conexion_revertida, "REQUIRED", expiration_date=D(2026, 10, 18))
    await _hoy(conexion_revertida, D(2026, 10, 18))
    fila = await _estado(conexion_revertida, empresa, req)
    assert (fila["vencido"], fila["por_vencer"]) == (False, True)


async def test_un_documento_que_no_vence_no_queda_pendiente_por_su_fecha(conexion_revertida):
    """Y los predicados son de dos valores: con NULL, `NOT pendiente` dejaria
    de decir "al dia"."""
    empresa, req = await _caso(conexion_revertida, "NONE", expiration_date=D(2020, 1, 1))
    fila = await _estado(conexion_revertida, empresa, req)
    assert (fila["vencido"], fila["por_vencer"], fila["pendiente"]) == (False, False, False)


async def test_la_planilla_ejecuta(conexion_revertida):
    await conexion_revertida.fetch(sql_filas_plantilla(pendiente_predicate("cr")), "todas")


@pytest.mark.parametrize("group", ["carrier", "requirement", "driver", "asset"])
async def test_el_estado_de_certificacion_ejecuta(conexion_revertida, group):
    """Las CTE `records` y `attributed` alimentan a los predicados: si no
    proyectan las columnas del contrato, Postgres falla aca."""
    await get_certification_status(
        group=group, scope="active", carrier_id=None, q="", limit=5,
        pool=PoolDeUnaConexion(conexion_revertida), _=USER,
    )


async def test_la_cola_y_la_ficha_cuentan_el_mensual_vencido(conexion_revertida):
    empresa, req = await _caso(conexion_revertida, "CALENDAR_PERIOD", period_start=D(2026, 8, 1))
    await _hoy(conexion_revertida, D(2026, 10, 19))
    pool = PoolDeUnaConexion(conexion_revertida)

    cola = await list_pending_compliance_records(
        carrier_id=str(empresa), category=None, requirement_code=None, q="",
        operation_type=None, entity_id=None, limit=50, offset=0, estado="todos",
        pool=pool, _=USER,
    )
    # Al crear la empresa, la siembra le agrega los requisitos activos del
    # catalogo: se mira solo la fila del requisito del caso.
    del_caso = [f for f in cola["rows"] if f["requirement_id"] == str(req)]
    assert [f["urgencia"] for f in del_caso] == ["VENCIDO"]

    await get_compliance_summary(carrier_id=str(empresa), pool=pool, _=USER)
