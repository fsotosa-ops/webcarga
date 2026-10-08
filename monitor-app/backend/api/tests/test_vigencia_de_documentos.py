"""La vigencia de un documento, calculada al leer (HU-C1, entrega 2).

Cada test es un criterio de aceptacion de la HU o un borde que el spec
implica. Se evalua la EXPRESION real de app/services/vencimientos.py (la unica
definicion) sobre una fila armada con los parametros. Las piezas de la base
que usa se cargan desde las migraciones dentro de la transaccion revertida: se
prueba el SQL que se va a desplegar.

"Hoy" se fija reemplazando public.hoy_chile() dentro de la misma
transaccion, asi los casos no dependen del dia en que corra la suite.
Los nombres son SINTETICOS."""
import datetime as dt
import re
from pathlib import Path
from uuid import uuid4

import pytest

from app.services.vencimientos import aviso_desde_sql, exigible_sql, vence_el_sql

pytestmark = pytest.mark.integracion

MIGRACIONES = [
    Path(__file__).resolve().parents[2] / "supabase/migrations" / nombre
    for nombre in (
        "20261008120000_vigencia_de_documentos.sql",
        # El calculo pasa a la consulta; quedan las formulas (Task 5).
        "20261008130000_vigencia_en_la_consulta.sql",
        # Correcciones de la revision final (gracia en todos los tipos,
        # coherencia de reglas).
        "20261008140000_vigencia_correcciones.sql",
    )
]
PREFIJO = "ZZ-TEST-VIGENCIA"
D = dt.date
F30_1 = dict(frequency_months=1, cutoff_day=18, period_offset_months=1)


async def _cargar(conn) -> None:
    """Carga las migraciones de la vigencia en orden, sentencia por sentencia
    (funciones y DROP), dentro de la transaccion revertida."""
    for migracion in MIGRACIONES:
        sql = migracion.read_text()
        for sentencia in re.findall(
            r"(?:CREATE OR REPLACE FUNCTION.*?\$\$;|DROP FUNCTION[^;]*;)", sql, re.S
        ):
            await conn.execute(sentencia)


async def _hoy(conn, dia: dt.date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$"
    )


def _suf() -> str:
    return uuid4().hex[:8].upper()


async def _empresa(conn):
    s = _suf()
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} {s}", f"{PREFIJO}-{s}",
    )


async def _cliente(conn, empresa=None):
    cliente = await conn.fetchval(
        "INSERT INTO public.shippers (name) VALUES ($1) RETURNING id", f"{PREFIJO} {_suf()}",
    )
    if empresa:
        await conn.execute(
            "INSERT INTO public.carrier_shippers (carrier_id, shipper_id, status) "
            "VALUES ($1, $2, 'ACTIVE')", empresa, cliente,
        )
    return cliente


async def _conductor(conn, empresa=None, *, desde=None, estado="ACTIVE"):
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name) VALUES ($1) RETURNING id", f"{PREFIJO} {_suf()}",
    )
    if empresa:
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))",
            conductor, empresa, estado, desde,
        )
    return conductor


async def _regla(conn, requisito, **params):
    columnas = ["requirement_id", *params]
    marcas = ", ".join(f"${i}" for i in range(1, len(columnas) + 1))
    await conn.execute(
        f"INSERT INTO public.compliance_requirement_rules ({', '.join(columnas)}) "
        f"VALUES ({marcas})", requisito, *params.values(),
    )


async def _requisito(conn, politica, *, entidad="CARRIER", exigible_on="ON_ENTITY_START",
                     base: dict | None = None):
    requisito = await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, exigible_on, is_active)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4, $5, false)
        RETURNING id
        """,
        f"ZZ_VIG_{_suf()}", f"{PREFIJO} requisito", entidad, politica, exigible_on,
    )
    if base is not None:
        await _regla(conn, requisito, **base)
    return requisito


_FILA = (
    "(SELECT $1::uuid AS requirement_id, $2::text AS entity_type, $3::uuid AS entity_id, "
    "$4::text AS status, $5::date AS expiration_date, $6::date AS issue_date, "
    "$7::date AS period_start) d"
)


async def _evaluar(conn, expresion, requisito, entidad_tipo, entidad, *, status="APPROVED",
                   expiration_date=None, issue_date=None, period_start=None):
    return await conn.fetchval(
        f"SELECT {expresion} FROM {_FILA}",
        requisito, entidad_tipo, entidad, status, expiration_date, issue_date, period_start,
    )


async def _vence(conn, requisito, entidad_tipo, entidad, **kw):
    return await _evaluar(conn, vence_el_sql("d"), requisito, entidad_tipo, entidad, **kw)


async def _aviso(conn, requisito, entidad_tipo, entidad, *, expiration_date):
    return await _evaluar(conn, aviso_desde_sql("d"), requisito, entidad_tipo, entidad,
                          expiration_date=expiration_date)


async def _exigible(conn, requisito, tipo, entidad):
    return await _evaluar(conn, exigible_sql("d"), requisito, tipo, entidad)


# ── Periodo de calendario (criterio 2) ───────────────────────────────────────

async def test_f30_1_de_septiembre_cubre_hasta_el_corte_de_noviembre(conexion_revertida):
    """El de septiembre se pide el 18/10 y cubre hasta que se pide el de
    octubre, el 18/11."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 18)


async def test_con_el_de_agosto_vence_el_18_de_octubre(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 8, 1)) == D(2026, 10, 18)


async def test_la_gracia_corre_el_corte(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base={**F30_1, "grace_days": 3})
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 8, 1)) == D(2026, 10, 21)


async def test_corte_31_en_febrero_es_el_ultimo_dia_de_febrero(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                           base=dict(frequency_months=1, cutoff_day=31, period_offset_months=1))
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 12, 1)) == D(2027, 2, 28)


async def test_un_mensual_aprobado_sin_periodo_no_cubre_nada(conexion_revertida):
    """Review Focus 1: sin periodo no hay de que periodo es. Cuenta como
    vencido, no como al dia. -infinity se compara en SQL: asyncpg no tiene un
    equivalente fiel en datetime.date."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    assert await _evaluar(conexion_revertida, f"{vence_el_sql('d')} = '-infinity'::date",
                          req, "CARRIER", empresa)


async def test_un_mensual_que_falta_no_esta_vencido_sino_faltante(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa, status="MISSING") is None


# ── Corte por cliente (criterio 3) ───────────────────────────────────────────

async def test_un_solo_registro_se_evalua_contra_el_corte_de_cada_cliente(conexion_revertida):
    """Base dia 15; el cliente A corta el 5 y el B no tiene variante. Gana el
    peor: el de septiembre vence el 05/11, que es el de A."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    cliente_a = await _cliente(conexion_revertida, empresa)
    await _cliente(conexion_revertida, empresa)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                           base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
    await _regla(conexion_revertida, req, shipper_id=cliente_a,
                 frequency_months=1, cutoff_day=5, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 5)


async def test_la_variante_reemplaza_a_la_base_para_su_cliente(conexion_revertida):
    """Si el unico cliente tiene variante, la base no le aplica: una variante
    MAS permisiva (dia 25) tambien se respeta."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    cliente = await _cliente(conexion_revertida, empresa)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                           base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
    await _regla(conexion_revertida, req, shipper_id=cliente,
                 frequency_months=1, cutoff_day=25, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 25)


async def test_la_variante_de_un_cliente_ajeno_no_aplica(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    ajeno = await _cliente(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    await _regla(conexion_revertida, req, shipper_id=ajeno,
                 frequency_months=1, cutoff_day=5, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 18)


async def test_el_conductor_hereda_los_clientes_de_su_empresa(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    cliente = await _cliente(conexion_revertida, empresa)
    conductor = await _conductor(conexion_revertida, empresa)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", entidad="DRIVER",
                           base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
    await _regla(conexion_revertida, req, shipper_id=cliente,
                 frequency_months=1, cutoff_day=5, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "DRIVER", conductor,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 5)


# ── Cambiar la politica no reescribe el pasado (criterio 6) ──────────────────

async def test_mover_el_corte_no_cambia_un_periodo_anterior(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                           base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
    # Desde octubre, el corte pasa al 5.
    await _regla(conexion_revertida, req, vigente_desde=D(2026, 10, 1),
                 frequency_months=1, cutoff_day=5, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 9, 1)) == D(2026, 11, 15)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        period_start=D(2026, 10, 1)) == D(2026, 12, 5)


# ── Plazo desde la emision ───────────────────────────────────────────────────

async def test_anual_vence_doce_meses_despues_de_la_emision(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "ISSUE_PLUS_MONTHS", base=dict(validity_months=12))
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        issue_date=D(2026, 3, 10)) == D(2027, 3, 10)


# ── Fecha del documento y no vence ───────────────────────────────────────────

async def test_fecha_del_documento_no_necesita_regla(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "REQUIRED")
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 1)) == D(2026, 12, 1)


async def test_un_documento_que_no_vence_no_vence_aunque_traiga_fecha(conexion_revertida):
    """La politica es la unica fuente. Hay 12 registros asi en produccion
    (07/10): ver el gate de la Task 5 del plan."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "NONE")
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2020, 1, 1)) is None


# ── Aviso (criterio 5) ───────────────────────────────────────────────────────

async def test_sin_dias_propios_avisa_con_el_general(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "REQUIRED")
    await conexion_revertida.execute(
        "UPDATE app.alert_thresholds SET warning_days = 11 WHERE doc_type = 'documento_por_vencer'")
    assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 31)) == D(2026, 12, 20)


async def test_los_dias_del_tipo_cambian_el_aviso(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "REQUIRED", base=dict(warning_days=7))
    assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 31)) == D(2026, 12, 24)


# ── Exigibilidad ────────────────────────────────────────────────────────────

async def test_mes_siguiente_al_ingreso(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    conductor = await _conductor(conexion_revertida, empresa, desde=D(2026, 10, 7))
    req = await _requisito(conexion_revertida, "NONE", entidad="DRIVER",
                           exigible_on="MONTH_AFTER_START")
    await _hoy(conexion_revertida, D(2026, 10, 31))
    assert await _exigible(conexion_revertida, req, "DRIVER", conductor) is False
    await _hoy(conexion_revertida, D(2026, 11, 1))
    assert await _exigible(conexion_revertida, req, "DRIVER", conductor) is True


async def test_al_termino_solo_si_ya_no_tiene_empresa(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    activo = await _conductor(conexion_revertida, empresa)
    desvinculado = await _conductor(conexion_revertida, empresa, estado="INACTIVE")
    nunca_vinculado = await _conductor(conexion_revertida)
    req = await _requisito(conexion_revertida, "NONE", entidad="DRIVER",
                           exigible_on="ON_ENTITY_END")
    assert await _exigible(conexion_revertida, req, "DRIVER", activo) is False
    assert await _exigible(conexion_revertida, req, "DRIVER", desvinculado) is True
    assert await _exigible(conexion_revertida, req, "DRIVER", nunca_vinculado) is False


async def test_al_ingreso_y_a_pedido_se_exigen_si_hay_registro(conexion_revertida):
    """ON_REQUEST no lo decide la lectura: lo decide la siembra (F3). Si hay
    registro, es porque alguien lo pidio."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    for exigible_on in ("ON_ENTITY_START", "ON_REQUEST"):
        req = await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on)
        assert await _exigible(conexion_revertida, req, "CARRIER", empresa) is True


# ── Costo de leer (Task 5) ───────────────────────────────────────────────────

async def test_el_calculo_no_llama_funciones_por_registro(conexion_revertida):
    """Medido el 08/10: con funciones documento_* (no inlineables, porque
    tienen subconsultas) /compliance/status por empresa paso de 0,28 s a
    0,76 s. La expresion vive en la consulta: en el plan no puede quedar una
    llamada por registro, solo las formulas puras (que Postgres despliega)."""
    await _cargar(conexion_revertida)
    from app.services.vencimientos import pendiente_predicate

    plan = await conexion_revertida.fetch(
        f"EXPLAIN (VERBOSE) SELECT {pendiente_predicate('cr')} "
        "FROM public.compliance_records cr WHERE cr.is_current"
    )
    texto = "\n".join(r[0] for r in plan)
    for funcion in ("documento_vence_el", "documento_aviso_desde",
                    "documento_exigible", "hoy_chile"):
        assert funcion not in texto, f"{funcion} se llama por registro"


# ── Revision final (I1, I4) ──────────────────────────────────────────────────

async def test_un_mensual_con_emision_pero_sin_periodo_no_cubre_nada(conexion_revertida):
    """I1: la fecha de referencia la dicta el tipo. Un mensual que trae fecha de
    emision pero no periodo no dice de que mes es."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD", base=F30_1)
    assert await _evaluar(conexion_revertida, f"{vence_el_sql('d')} = '-infinity'::date",
                          req, "CARRIER", empresa, issue_date=D(2026, 10, 10))


async def test_un_mensual_con_las_dos_fechas_se_versiona_por_el_periodo(conexion_revertida):
    """I1 y regla 6: el F30-1 de septiembre se emite en octubre. Mover el corte
    desde el 01/10 no puede cambiar el de septiembre."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "CALENDAR_PERIOD",
                           base=dict(frequency_months=1, cutoff_day=15, period_offset_months=1))
    await _regla(conexion_revertida, req, vigente_desde=D(2026, 10, 1),
                 frequency_months=1, cutoff_day=5, period_offset_months=1)
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        issue_date=D(2026, 10, 12), period_start=D(2026, 9, 1)) == D(2026, 11, 15)


async def test_la_gracia_corre_tambien_la_fecha_del_documento(conexion_revertida):
    """I4: "Todos los tipos llevan ademas dos parametros: dias de aviso y dias
    de gracia" (HU-C1)."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "REQUIRED", base=dict(grace_days=10))
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 1)) == D(2026, 12, 11)


async def test_la_gracia_corre_tambien_el_plazo_desde_la_emision(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "ISSUE_PLUS_MONTHS",
                           base=dict(validity_months=12, grace_days=5))
    assert await _vence(conexion_revertida, req, "CARRIER", empresa,
                        issue_date=D(2026, 3, 10)) == D(2027, 3, 15)


async def test_el_aviso_de_la_fecha_del_documento_cuenta_desde_la_gracia(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    req = await _requisito(conexion_revertida, "REQUIRED", base=dict(grace_days=10, warning_days=7))
    assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 1)) == D(2026, 12, 4)


async def test_la_variante_mas_estricta_gana_en_la_fecha_del_documento(conexion_revertida):
    """Con base y una variante de un cliente: gana el peor (el aviso mas
    temprano), igual que en los tipos con parametros."""
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    cliente_a = await _cliente(conexion_revertida, empresa)
    await _cliente(conexion_revertida, empresa)
    req = await _requisito(conexion_revertida, "REQUIRED", base=dict(warning_days=10))
    await _regla(conexion_revertida, req, shipper_id=cliente_a, warning_days=20)
    assert await _aviso(conexion_revertida, req, "CARRIER", empresa,
                        expiration_date=D(2026, 12, 31)) == D(2026, 12, 11)
