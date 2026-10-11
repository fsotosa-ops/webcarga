"""Certificación › Pendientes (spec 2026-10-11-pending-documents-design.md).

Contra la base real, en una transacción revertida. Los sujetos los crea cada
test con el prefijo ZZ-TEST-PENDIENTES; los requisitos nacen APAGADOS
(is_active = false) para que la siembra no recorra el padrón, y los registros
se insertan a mano con el estado y las fechas que cada caso necesita."""
from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest

from app.services.vencimientos import document_state_sql, in_scope_sql

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-PENDIENTES"


def _suf() -> str:
    return uuid4().hex[:8]


async def _hoy(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def _empresa(conn, *, estado: str = "ACTIVE") -> str:
    s = _suf()
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} Empresa {s}", f"{PREFIJO}-{s}", estado))


async def _conductor(conn, empresa: str | None, *, estado: str = "ACTIVE",
                     asignacion: str | None = "ACTIVE") -> str:
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado))
    if empresa and asignacion:
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, $3, public.hoy_chile() - 400)", d, empresa, asignacion)
    return d


async def _requisito(conn, *, entidad: str, politica: str = "REQUIRED",
                     exigible_on: str = "ON_ENTITY_START") -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', $4, $5, false, true)
        RETURNING id
        """,
        entidad, f"ZZ_PEND_{_suf().upper()}", f"{PREFIJO} documento", politica, exigible_on))


async def _registro(conn, requisito: str, entidad_tipo: str, entidad_id: str, *,
                    status: str = "MISSING", vence: date | None = None,
                    emision: date | None = None, periodo: date | None = None) -> str:
    return str(await conn.fetchval(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status, is_current,
             expiration_date, issue_date, period_start, file_url)
        VALUES ($1, $2, $3, $4, true, $5, $6, $7,
                $8)
        RETURNING id
        """,
        entidad_id, entidad_tipo, requisito, status, vence, emision, periodo,
        None if status == 'MISSING' else 'zz/test.pdf'))


async def _estado(conn, registro: str) -> str:
    return await conn.fetchval(
        f"SELECT {document_state_sql('cr')} FROM public.compliance_records cr WHERE cr.id = $1",
        registro)


async def _en_alcance(conn, registro: str) -> bool:
    return await conn.fetchval(
        f"SELECT {in_scope_sql('cr')} FROM public.compliance_records cr WHERE cr.id = $1",
        registro)


# ── Estado ───────────────────────────────────────────────────────────────────

async def test_un_documento_que_nunca_se_cargo_falta(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER")
    assert await _estado(conn, await _registro(conn, req, "CARRIER", empresa)) == "MISSING"


async def test_una_fecha_impresa_que_ya_paso_esta_vencida(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy - timedelta(days=3))
    assert await _estado(conn, reg) == "OVERDUE"


async def test_dentro_del_aviso_general_esta_por_vencer(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=10))
    assert await _estado(conn, reg) == "EXPIRING"


async def test_lejos_del_vencimiento_esta_al_dia(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=400))
    assert await _estado(conn, reg) == "UP_TO_DATE"


async def test_un_archivo_sin_la_emision_que_pide_su_regla_esta_vencido(conexion_revertida):
    """Review Focus 1: cargado, pero sin el dato que su tipo necesita. No es
    "al día" ni "falta": no sirve, y la fila lo dice."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="ISSUE_PLUS_MONTHS")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules "
        "(requirement_id, shipper_id, validity_months, vigente_desde) "
        "VALUES ($1, NULL, 3, public.hoy_chile() - 30)", req)
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL")
    assert await _estado(conn, reg) == "OVERDUE"


async def test_desde_el_mes_siguiente_al_ingreso_todavia_no_se_exige(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name) VALUES ($1) RETURNING id", f"{PREFIJO} {_suf()}"))
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
        "VALUES ($1, $2, 'ACTIVE', public.hoy_chile())", d, empresa)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="MONTH_AFTER_START")
    assert await _estado(conn, await _registro(conn, req, "DRIVER", d)) == "NOT_REQUIRED"


# ── Estado: ventana propia, plazo desde la emisión, período, a pedido ────────

async def test_dentro_del_aviso_propio_del_documento_esta_por_vencer(conexion_revertida):
    """Vence en 50 días: el aviso general no alcanza, la ventana propia (60) sí."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    general = await conn.fetchval(
        "SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'documento_por_vencer'")
    assert general < 50  # si no, el test no distinguiría la ventana propia
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, warning_days) "
        "VALUES ($1, NULL, 60)", req)
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=50))
    assert await _estado(conn, reg) == "EXPIRING"


async def test_un_plazo_desde_la_emision_ya_cumplido_esta_vencido(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="ISSUE_PLUS_MONTHS")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules "
        "(requirement_id, shipper_id, validity_months, vigente_desde) "
        "VALUES ($1, NULL, 3, public.hoy_chile() - 400)", req)
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          emision=hoy - timedelta(days=200))
    assert await _estado(conn, reg) == "OVERDUE"


async def _requisito_por_periodo(conn) -> str:
    req = await _requisito(conn, entidad="CARRIER", politica="CALENDAR_PERIOD")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules "
        "(requirement_id, frequency_months, cutoff_day, period_offset_months, warning_days) "
        "VALUES ($1, 1, 18, 1, 5)", req)
    return req


async def test_un_periodo_reciente_esta_al_dia(conexion_revertida):
    """El mes en curso vence recién el 18 del mes subsiguiente: aún no toca."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito_por_periodo(conn)
    inicio = await conn.fetchval("SELECT date_trunc('month', public.hoy_chile())::date")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL", periodo=inicio)
    assert await _estado(conn, reg) == "UP_TO_DATE"


async def test_un_periodo_antiguo_pasado_su_corte_esta_vencido(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito_por_periodo(conn)
    inicio = await conn.fetchval(
        "SELECT (date_trunc('month', public.hoy_chile()) - interval '8 months')::date")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL", periodo=inicio)
    assert await _estado(conn, reg) == "OVERDUE"


async def test_un_documento_a_pedido_solicitado_y_sin_archivo_falta_y_esta_en_alcance(conexion_revertida):
    """A pedido se exige desde que existe el registro (la siembra no lo crea:
    eso es de la siembra, no de esta función)."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", exigible_on="ON_REQUEST")
    reg = await _registro(conn, req, "CARRIER", empresa)
    assert await _estado(conn, reg) == "MISSING"
    assert await _en_alcance(conn, reg) is True


async def test_un_documento_a_pedido_con_archivo_vigente_esta_al_dia(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED", exigible_on="ON_REQUEST")
    reg = await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL",
                          vence=hoy + timedelta(days=400))
    assert await _estado(conn, reg) == "UP_TO_DATE"


# ── Alcance ──────────────────────────────────────────────────────────────────

async def test_el_documento_de_una_empresa_activa_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    req = await _requisito(conn, entidad="CARRIER")
    assert await _en_alcance(conn, await _registro(conn, req, "CARRIER", empresa)) is True


async def test_el_documento_de_una_empresa_de_baja_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    req = await _requisito(conn, entidad="CARRIER")
    assert await _en_alcance(conn, await _registro(conn, req, "CARRIER", empresa)) is False


async def test_un_conductor_inactivo_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa, estado="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_sin_asignacion_vigente_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa, asignacion="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_activo_de_una_empresa_de_baja_no_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    d = await _conductor(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_conductor_activo_de_una_empresa_activa_esta_en_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is True


# ── Alcance: documentos que se exigen al término (ON_ENTITY_END) ─────────────

async def _conductor_que_se_fue(conn, empresa: str) -> str:
    """Inactivo, con una única asignación ya terminada a `empresa`."""
    d = str(await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'INACTIVE') RETURNING id",
        f"{PREFIJO} Conductor {_suf()}"))
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date, end_date) "
        "VALUES ($1, $2, 'INACTIVE', public.hoy_chile() - 200, public.hoy_chile() - 10)", d, empresa)
    return d


async def test_el_documento_al_termino_de_quien_se_fue_esta_en_alcance_si_su_ultima_empresa_esta_activa(
        conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor_que_se_fue(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="ON_ENTITY_END")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is True


async def test_el_documento_al_termino_no_esta_en_alcance_si_su_ultima_empresa_no_esta_activa(
        conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    d = await _conductor_que_se_fue(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="ON_ENTITY_END")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_la_ultima_asignacion_manda_no_una_anterior(conexion_revertida):
    """Trabajó antes en una empresa activa, pero la última fue en una de baja."""
    conn = conexion_revertida
    activa = await _empresa(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    d = await _conductor_que_se_fue(conn, activa)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date, end_date) "
        "VALUES ($1, $2, 'INACTIVE', public.hoy_chile() - 9, public.hoy_chile() - 1)", d, de_baja)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="ON_ENTITY_END")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_un_documento_corriente_de_quien_se_fue_sigue_fuera_de_alcance(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    d = await _conductor_que_se_fue(conn, empresa)
    req = await _requisito(conn, entidad="DRIVER")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


async def test_la_ultima_asignacion_abierta_a_una_empresa_de_baja_deja_fuera(conexion_revertida):
    """end_date NULL es la más reciente aunque haya otra, cerrada, a una empresa activa."""
    conn = conexion_revertida
    activa = await _empresa(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    d = await _conductor_que_se_fue(conn, activa)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date, end_date) "
        "VALUES ($1, $2, 'INACTIVE', public.hoy_chile() - 5, NULL)", d, de_baja)
    req = await _requisito(conn, entidad="DRIVER", exigible_on="ON_ENTITY_END")
    assert await _en_alcance(conn, await _registro(conn, req, "DRIVER", d)) is False


# ── GET /compliance-records/pending: state, alcance, orden ───────────────────

from app.routers.compliance import list_pending_compliance_records  # noqa: E402
from tests.conftest import PoolDeUnaConexion  # noqa: E402


async def _listar(conn, *, requirement_code=None, carrier_id=None, state=None, estado="falta"):
    """El handler con TODOS sus parámetros explícitos (los defaults son Query())."""
    return await list_pending_compliance_records(
        carrier_id=carrier_id, category=None, requirement_code=requirement_code, q="",
        operation_type=None, entity_id=None, limit=500, offset=0, estado=estado, state=state,
        pool=PoolDeUnaConexion(conn), _=None)


async def _codigo(conn, req: str) -> str:
    return await conn.fetchval("SELECT requirement_code FROM public.compliance_requirements WHERE id = $1", req)


async def _equipo(conn, empresa: str | None, *, asignacion: str = "ACTIVE") -> str:
    a = str(await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{_suf()[:4].upper()}"))
    if empresa:
        await conn.execute(
            "INSERT INTO public.asset_assignments (asset_id, carrier_id, status) VALUES ($1, $2, $3)",
            a, empresa, asignacion)
    return a


async def test_pending_con_state_trae_el_estado_y_ordena_vencido_por_vencer_falta(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    falta = await _empresa(conn)
    por_vencer = await _empresa(conn)
    vencida = await _empresa(conn)
    await _registro(conn, req, "CARRIER", falta)
    await _registro(conn, req, "CARRIER", por_vencer, status="APPROVED_MANUAL", vence=hoy + timedelta(days=5))
    await _registro(conn, req, "CARRIER", vencida, status="APPROVED_MANUAL", vence=hoy - timedelta(days=5))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="pending")

    assert [r["document_state"] for r in res["rows"]] == ["OVERDUE", "EXPIRING", "MISSING"]
    assert [r["carrier_id"] for r in res["rows"]] == [vencida, por_vencer, falta]


async def test_pending_state_overdue_trae_solo_los_vencidos(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    await _registro(conn, req, "CARRIER", await _empresa(conn))
    vencida = await _empresa(conn)
    await _registro(conn, req, "CARRIER", vencida, status="APPROVED_MANUAL", vence=hoy - timedelta(days=1))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="overdue")

    assert [r["carrier_id"] for r in res["rows"]] == [vencida]


async def test_pending_state_all_trae_tambien_lo_que_esta_al_dia(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    al_dia = await _empresa(conn)
    await _registro(conn, req, "CARRIER", al_dia, status="APPROVED_MANUAL", vence=hoy + timedelta(days=400))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="all")

    assert [(r["carrier_id"], r["document_state"]) for r in res["rows"]] == [(al_dia, "UP_TO_DATE")]


async def test_pending_global_no_trae_a_un_conductor_inactivo_pero_la_ficha_si(conexion_revertida):
    """Review Focus 2: el alcance se aplica a la cola, no a la ficha."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    activo = await _conductor(conn, empresa)
    inactivo = await _conductor(conn, empresa, estado="INACTIVE")
    req = await _requisito(conn, entidad="DRIVER")
    await _registro(conn, req, "DRIVER", activo)
    await _registro(conn, req, "DRIVER", inactivo)
    codigo = await _codigo(conn, req)

    cola = await _listar(conn, requirement_code=codigo, state="pending")
    por_empresa = await _listar(conn, requirement_code=codigo, carrier_id=empresa, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=empresa)  # sin state: la ficha de hoy

    assert [r["entity_id"] for r in cola["rows"]] == [activo]
    assert [r["entity_id"] for r in por_empresa["rows"]] == [activo]
    assert {r["entity_id"] for r in ficha["rows"]} == {activo, inactivo}


async def test_pending_un_equipo_sin_asignacion_vigente_no_sale_con_state(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    con_asignacion = await _equipo(conn, empresa)
    sin_asignacion = await _equipo(conn, empresa, asignacion="INACTIVE")
    req = await _requisito(conn, entidad="ASSET")
    await _registro(conn, req, "ASSET", con_asignacion)
    await _registro(conn, req, "ASSET", sin_asignacion)
    codigo = await _codigo(conn, req)

    cola = await _listar(conn, requirement_code=codigo, carrier_id=empresa, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=empresa)

    assert [r["entity_id"] for r in cola["rows"]] == [con_asignacion]
    # Sin state el equipo sin asignacion vigente no se resuelve a empresa: hoy tampoco sale.
    assert {r["entity_id"] for r in ficha["rows"]} == {con_asignacion}


async def test_pending_una_empresa_inactiva_no_sale_con_state_pero_su_ficha_si(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, estado="INACTIVE")
    req = await _requisito(conn, entidad="CARRIER")
    await _registro(conn, req, "CARRIER", empresa)
    codigo = await _codigo(conn, req)

    con_state = await _listar(conn, requirement_code=codigo, carrier_id=empresa, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=empresa)

    assert con_state["rows"] == []
    assert [r["carrier_id"] for r in ficha["rows"]] == [empresa]


async def test_pending_sin_state_responde_como_antes(conexion_revertida):
    """Compatibilidad: `estado` (default 'falta') y `urgencia` no cambian."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    empresa = await _empresa(conn)
    await _registro(conn, req, "CARRIER", empresa, status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))

    res = await _listar(conn, requirement_code=await _codigo(conn, req))

    fila = res["rows"][0]
    assert [r["urgencia"] for r in res["rows"]] == ["VENCIDO"]
    assert fila["document_state"] == "OVERDUE"
    assert fila["due_on"] == fila["vence_el"] == hoy - timedelta(days=2)
    assert fila["missing_validity_data"] is fila["falta_dato_de_vigencia"] is False
