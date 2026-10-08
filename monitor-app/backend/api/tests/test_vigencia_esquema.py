"""El esquema de la vigencia (HU-C1, entrega 2). Lo que se prueba es lo que
Postgres hace cumplir, no lo que la API promete: una regla incoherente con la
politica no puede quedar guardada, venga de donde venga la escritura."""
import re
from datetime import date
from pathlib import Path
from uuid import uuid4

import asyncpg
import pytest

pytestmark = pytest.mark.integracion

CORRECCIONES = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261008140000_vigencia_correcciones.sql"
)


async def _cargar_correcciones(conn) -> None:
    """La validacion corregida en la revision final, cargada desde su
    migracion dentro de la transaccion revertida."""
    for sentencia in re.findall(r"CREATE OR REPLACE FUNCTION.*?\$\$;",
                                CORRECCIONES.read_text(), re.S):
        await conn.execute(sentencia)


async def _requisito(conn, politica: str, *, exigible_on: str | None = None,
                     entidad: str = "CARRIER") -> str:
    suf = uuid4().hex[:8].upper()
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, exigible_on, is_active)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4,
                COALESCE($5, 'ON_ENTITY_START'), false)
        RETURNING id
        """,
        f"ZZ_TEST_VIG_{suf}", f"ZZ-TEST-VIG {suf}", entidad, politica, exigible_on,
    )


async def _regla(conn, requisito, **params) -> None:
    columnas = ["requirement_id", *params]
    marcas = ", ".join(f"${i}" for i in range(1, len(columnas) + 1))
    await conn.execute(
        f"INSERT INTO public.compliance_requirement_rules ({', '.join(columnas)}) "
        f"VALUES ({marcas})",
        requisito, *params.values(),
    )


async def _confirmar(conn) -> None:
    """Corre ahora los chequeos diferidos, como si la transaccion cerrara, y
    vuelve a diferirlos: SET CONSTRAINTS ALL IMMEDIATE queda vigente por el
    resto de la transaccion, y el caso siguiente se validaria antes de
    insertar su regla."""
    await conn.execute("SET CONSTRAINTS ALL IMMEDIATE")
    await conn.execute("SET CONSTRAINTS ALL DEFERRED")


async def _falla_al_confirmar(conn, caso) -> None:
    """Las reglas de coherencia son CONSTRAINT TRIGGER diferidos: fallan al
    cerrar la transaccion, no en el INSERT. Por eso cada caso va en su propio
    savepoint y se fuerza el chequeo con SET CONSTRAINTS ALL IMMEDIATE.
    Se exige CheckViolationError, no cualquier error: un "columna no existe"
    haria pasar el test sin probar nada."""
    with pytest.raises(asyncpg.CheckViolationError):
        async with conn.transaction():
            await caso()
            await _confirmar(conn)


async def test_los_tipos_nuevos_entran_y_uno_inventado_no(conexion_revertida):
    for politica in ("ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD"):
        requisito = await _requisito(conexion_revertida, politica)
        if politica == "ISSUE_PLUS_MONTHS":
            await _regla(conexion_revertida, requisito, validity_months=12)
        else:
            await _regla(conexion_revertida, requisito, frequency_months=1, warning_days=5,
                         cutoff_day=18, period_offset_months=1)
        await _confirmar(conexion_revertida)
    with pytest.raises(asyncpg.CheckViolationError):
        async with conexion_revertida.transaction():
            await _requisito(conexion_revertida, "SEMANAL")


async def test_un_plazo_desde_la_emision_exige_sus_meses(conexion_revertida):
    async def caso():
        requisito = await _requisito(conexion_revertida, "ISSUE_PLUS_MONTHS")
        await _regla(conexion_revertida, requisito, warning_days=10)
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_un_periodo_de_calendario_exige_frecuencia_y_corte(conexion_revertida):
    async def caso():
        requisito = await _requisito(conexion_revertida, "CALENDAR_PERIOD")
        await _regla(conexion_revertida, requisito, frequency_months=1, warning_days=5)
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_un_tipo_con_parametros_no_existe_sin_regla_base(conexion_revertida):
    async def caso():
        await _requisito(conexion_revertida, "CALENDAR_PERIOD")
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_cambiar_la_politica_sin_sus_parametros_no_se_guarda(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "REQUIRED")
    await _confirmar(conexion_revertida)

    async def caso():
        await conexion_revertida.execute(
            "UPDATE public.compliance_requirements SET expiration_policy = 'ISSUE_PLUS_MONTHS' "
            "WHERE id = $1", requisito,
        )
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_borrar_la_regla_base_de_un_mensual_no_se_guarda(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "CALENDAR_PERIOD")
    await _regla(conexion_revertida, requisito, frequency_months=1, warning_days=5,
                 cutoff_day=5, period_offset_months=1)
    await _confirmar(conexion_revertida)

    async def caso():
        await conexion_revertida.execute(
            "DELETE FROM public.compliance_requirement_rules WHERE requirement_id = $1", requisito,
        )
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_los_tipos_de_fecha_y_no_vence_no_necesitan_regla(conexion_revertida):
    for politica in ("NONE", "REQUIRED", "OPTIONAL"):
        await _requisito(conexion_revertida, politica)
    await _confirmar(conexion_revertida)


async def test_una_regla_base_por_version(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "REQUIRED")
    await _regla(conexion_revertida, requisito, warning_days=10)
    with pytest.raises(asyncpg.UniqueViolationError):
        async with conexion_revertida.transaction():
            await _regla(conexion_revertida, requisito, warning_days=20)


async def test_el_corte_va_del_1_al_31(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "REQUIRED")
    with pytest.raises(asyncpg.CheckViolationError):
        async with conexion_revertida.transaction():
            await _regla(conexion_revertida, requisito, cutoff_day=32)


async def test_el_periodo_cubierto_empieza_el_dia_1(conexion_revertida):
    requisito = await _requisito(conexion_revertida, "NONE")
    empresa = await conexion_revertida.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"ZZ-TEST-VIG {uuid4().hex[:8]}", f"ZZ-TEST-VIG-{uuid4().hex[:8]}",
    )
    with pytest.raises(asyncpg.CheckViolationError):
        async with conexion_revertida.transaction():
            await conexion_revertida.execute(
                "INSERT INTO public.compliance_records "
                "(entity_id, entity_type, requirement_id, status, period_start) "
                "VALUES ($1, 'CARRIER', $2, 'APPROVED', DATE '2026-09-15')",
                empresa, requisito,
            )


async def test_mes_siguiente_y_termino_son_solo_de_conductor(conexion_revertida):
    for exigible_on in ("MONTH_AFTER_START", "ON_ENTITY_END"):
        with pytest.raises(asyncpg.CheckViolationError):
            async with conexion_revertida.transaction():
                await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on,
                                 entidad="CARRIER")
        await _requisito(conexion_revertida, "NONE", exigible_on=exigible_on, entidad="DRIVER")


async def test_existe_el_aviso_general(conexion_revertida):
    dias = await conexion_revertida.fetchval(
        "SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'documento_por_vencer'"
    )
    assert dias == 30


# ── Revision final (I2, I3) ──────────────────────────────────────────────────

async def test_una_variante_de_cliente_exige_una_regla_base(conexion_revertida):
    """I2: sin base, un cliente sin variante se quedaba sin dias de aviso. Toda
    regla de cliente es variante DE una base."""
    await _cargar_correcciones(conexion_revertida)
    cliente = await conexion_revertida.fetchval(
        "INSERT INTO public.shippers (name) VALUES ($1) RETURNING id",
        f"ZZ-TEST-VIG {uuid4().hex[:8]}")

    async def caso():
        requisito = await _requisito(conexion_revertida, "REQUIRED")
        await _regla(conexion_revertida, requisito, shipper_id=cliente, warning_days=5)
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_la_regla_base_rige_desde_siempre(conexion_revertida):
    """I3b: una base que empieza en noviembre deja sin regla a todo documento
    anterior, y su vencimiento salia NULL (al dia) en vez de vencido."""
    await _cargar_correcciones(conexion_revertida)

    async def caso():
        requisito = await _requisito(conexion_revertida, "CALENDAR_PERIOD")
        await _regla(conexion_revertida, requisito, vigente_desde=date(2026, 11, 1),
                     frequency_months=1, warning_days=5, cutoff_day=5, period_offset_months=1)
    await _falla_al_confirmar(conexion_revertida, caso)


async def test_mover_la_base_a_otro_requisito_no_deja_huerfano_al_primero(conexion_revertida):
    """I3a: en un UPDATE se validaba solo el requisito nuevo."""
    await _cargar_correcciones(conexion_revertida)
    origen = await _requisito(conexion_revertida, "CALENDAR_PERIOD")
    await _regla(conexion_revertida, origen, frequency_months=1, warning_days=5, cutoff_day=5, period_offset_months=1)
    destino = await _requisito(conexion_revertida, "REQUIRED")
    await _confirmar(conexion_revertida)

    async def caso():
        await conexion_revertida.execute(
            "UPDATE public.compliance_requirement_rules SET requirement_id = $2 "
            "WHERE requirement_id = $1", origen, destino)
    await _falla_al_confirmar(conexion_revertida, caso)
