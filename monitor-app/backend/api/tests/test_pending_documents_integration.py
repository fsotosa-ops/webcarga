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


async def _empresa(conn, *, estado: str = "ACTIVE", nombre: str = "Empresa") -> str:
    s = _suf()
    return str(await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, $3) RETURNING id",
        f"{PREFIJO} {nombre} {s}", f"{PREFIJO}-{s}", estado))


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


async def test_pending_un_equipo_inactivo_no_sale_con_state_pero_su_ficha_si(conexion_revertida):
    """Asignacion ACTIVE, pero el equipo no esta activo: solo el alcance lo saca."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    activo = await _equipo(conn, empresa)
    inactivo = await _equipo(conn, empresa)
    await conn.execute("UPDATE public.assets SET operational_status = 'INACTIVE' WHERE id = $1", inactivo)
    req = await _requisito(conn, entidad="ASSET")
    await _registro(conn, req, "ASSET", activo)
    await _registro(conn, req, "ASSET", inactivo)
    codigo = await _codigo(conn, req)

    cola = await _listar(conn, requirement_code=codigo, carrier_id=empresa, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=empresa)

    assert [r["entity_id"] for r in cola["rows"]] == [activo]
    assert {r["entity_id"] for r in ficha["rows"]} == {activo, inactivo}


async def test_pending_un_equipo_activo_de_una_empresa_inactiva_no_sale_en_la_cola_global(conexion_revertida):
    conn = conexion_revertida
    activa = await _empresa(conn)
    de_baja = await _empresa(conn, estado="INACTIVE")
    bueno = await _equipo(conn, activa)
    huerfano = await _equipo(conn, de_baja)
    req = await _requisito(conn, entidad="ASSET")
    await _registro(conn, req, "ASSET", bueno)
    await _registro(conn, req, "ASSET", huerfano)
    codigo = await _codigo(conn, req)

    cola = await _listar(conn, requirement_code=codigo, state="pending")
    ficha = await _listar(conn, requirement_code=codigo, carrier_id=de_baja)
    # La cola global ya excluye a la empresa de baja por su filtro propio; pedida
    # por empresa, solo el alcance del equipo la saca.
    de_baja_con_state = await _listar(conn, requirement_code=codigo, carrier_id=de_baja, state="pending")

    assert de_baja_con_state["rows"] == []
    assert [r["entity_id"] for r in cola["rows"]] == [bueno]
    assert [r["entity_id"] for r in ficha["rows"]] == [huerfano]


async def test_pending_ordena_por_fecha_dentro_de_cada_estado_y_el_total_es_el_filtrado(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    # Nombres en orden alfabetico OPUESTO al orden esperado por fecha: sin el
    # orden por fecha, el desempate por nombre dejaria la lista al reves.
    nombres = {"v_viejo": "Z", "v_reciente": "A", "p_cerca": "Z", "p_lejos": "A"}
    emp = {k: await _empresa(conn, nombre=nombres.get(k, "Empresa"))
           for k in ("v_viejo", "v_reciente", "p_cerca", "p_lejos", "falta1", "falta2", "al_dia")}
    await _registro(conn, req, "CARRIER", emp["v_reciente"], status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))
    await _registro(conn, req, "CARRIER", emp["v_viejo"], status="APPROVED_MANUAL", vence=hoy - timedelta(days=30))
    await _registro(conn, req, "CARRIER", emp["p_lejos"], status="APPROVED_MANUAL", vence=hoy + timedelta(days=9))
    await _registro(conn, req, "CARRIER", emp["p_cerca"], status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))
    await _registro(conn, req, "CARRIER", emp["falta1"])
    await _registro(conn, req, "CARRIER", emp["falta2"])
    await _registro(conn, req, "CARRIER", emp["al_dia"], status="APPROVED_MANUAL", vence=hoy + timedelta(days=400))

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="pending")

    ids = [r["carrier_id"] for r in res["rows"]]
    assert ids[:4] == [emp["v_viejo"], emp["v_reciente"], emp["p_cerca"], emp["p_lejos"]]
    assert {emp["falta1"], emp["falta2"]} == set(ids[4:])
    assert res["total"] == 6  # el al dia no cuenta
    todos = await _listar(conn, requirement_code=await _codigo(conn, req), state="all")
    assert todos["total"] == 7


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


# ── Resumen (columna izquierda) ──────────────────────────────────────────────

from app.routers.compliance import pending_summary  # noqa: E402


async def test_el_resumen_por_documento_coincide_con_la_lista(conexion_revertida):
    """La promesa central: las tres cifras de la izquierda son la lista de la derecha."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    for _ in range(2):
        await _registro(conn, req, "CARRIER", await _empresa(conn))
    await _registro(conn, req, "CARRIER", await _empresa(conn), status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))
    await _registro(conn, req, "CARRIER", await _empresa(conn), status="APPROVED_MANUAL", vence=hoy - timedelta(days=3))
    await _registro(conn, req, "CARRIER", await _empresa(conn, estado="INACTIVE"))  # fuera de alcance
    codigo = await _codigo(conn, req)

    resumen = await pending_summary(group_by="requirement", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in resumen["rows"] if r["requirement_code"] == codigo)

    for state, campo in (("overdue", "overdue"), ("expiring", "expiring"), ("missing", "missing")):
        lista = await _listar(conn, requirement_code=codigo, state=state)
        assert fila[campo] == lista["total"], campo
    assert (fila["overdue"], fila["expiring"], fila["missing"]) == (1, 1, 2)


async def test_el_resumen_por_empresa_cuenta_lo_de_la_empresa_y_su_gente(conexion_revertida):
    conn = conexion_revertida
    # Una empresa y un conductor recién creados ya traen pendientes sembrados
    # con el catálogo real: se mide contra una gemela sin nuestros registros.
    gemela = await _empresa(conn)
    await _conductor(conn, gemela)
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa)
    req_e = await _requisito(conn, entidad="CARRIER")
    req_d = await _requisito(conn, entidad="DRIVER")
    await _registro(conn, req_e, "CARRIER", empresa)
    await _registro(conn, req_d, "DRIVER", d)

    resumen = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    base = next(r for r in resumen["rows"] if r["key"] == gemela)
    fila = next(r for r in resumen["rows"] if r["key"] == empresa)

    assert fila["missing"] == base["missing"] + 2   # lo de la empresa + lo de su conductor
    assert fila["overdue"] == base["overdue"] and fila["vigencia"] is None


async def test_el_resumen_por_empresa_coincide_con_la_lista_de_esa_empresa(conexion_revertida):
    """Spec 7: la coherencia vale también por empresa, para cada estado."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    gemela = await _empresa(conn)
    await _conductor(conn, gemela)
    empresa = await _empresa(conn)
    d = await _conductor(conn, empresa)
    req_e = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    req_d = await _requisito(conn, entidad="DRIVER", politica="REQUIRED")
    await _registro(conn, req_e, "CARRIER", empresa)  # falta
    await _registro(conn, req_d, "DRIVER", d, status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))  # vencido
    req_e2 = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    await _registro(conn, req_e2, "CARRIER", empresa, status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))  # por vencer
    inactiva = await _empresa(conn, estado="INACTIVE")
    await _registro(conn, req_e, "CARRIER", inactiva)  # fuera de alcance: no aparece

    resumen = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    base = next((r for r in resumen["rows"] if r["key"] == gemela),
                {"overdue": 0, "expiring": 0, "missing": 0})
    fila = next(r for r in resumen["rows"] if r["key"] == empresa)

    for state in ("overdue", "expiring", "missing"):
        lista = await _listar(conn, carrier_id=empresa, state=state)
        assert fila[state] == lista["total"], state
    # Lo sembrado del catálogo real está en las dos listas (arriba se comparó);
    # lo nuestro es 1 vencido, 1 por vencer y 1 que falta además de lo sembrado.
    assert fila["overdue"] == base["overdue"] + 1 and fila["expiring"] == base["expiring"] + 1
    assert fila["missing"] == base["missing"] + 1
    assert fila["requirement_code"] is None and fila["expiration_policy"] is None
    assert all(r["key"] != inactiva for r in resumen["rows"])


async def test_el_resumen_trae_la_regla_del_documento(conexion_revertida):
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER", politica="CALENDAR_PERIOD")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, frequency_months, "
        "cutoff_day, period_offset_months, warning_days, vigente_desde) "
        "VALUES ($1, NULL, 1, 18, 1, 5, public.hoy_chile() - 30)", req)
    await _registro(conn, req, "CARRIER", await _empresa(conn))

    resumen = await pending_summary(group_by="requirement", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in resumen["rows"] if r["key"] == req)

    assert fila["expiration_policy"] == "CALENDAR_PERIOD"
    assert fila["vigencia"]["cutoff_day"] == 18 and fila["vigencia"]["frequency_months"] == 1


# ── Match de archivos (carga en lote) ────────────────────────────────────────

from app.routers.compliance import match_pending_files  # noqa: E402
from app.schemas.compliance import PendingMatchBody  # noqa: E402


async def _con_rut(conn, empresa: str) -> str:
    """Le da a la empresa sintética un RUT válido (DV correcto) y lo devuelve."""
    base = int(uuid4().int % 9_000_000) + 70_000_000
    s, m = 0, 2
    for d in reversed(str(base)):
        s += int(d) * m
        m = 2 if m == 7 else m + 1
    dv = {11: "0", 10: "K"}.get(11 - s % 11, str(11 - s % 11))
    rut = f"{base}-{dv}"
    await conn.execute("UPDATE public.carriers SET tax_id = public.canonical_rut($2) WHERE id = $1", empresa, rut)
    return rut


async def _escrituras(conn) -> tuple:
    """Foto del contenido (no solo el conteo): una subida ACTUALIZA filas."""
    return (await conn.fetchval(
        "SELECT count(*) || ':' || coalesce(md5(string_agg(cr::text, '|' ORDER BY cr.id)), '') "
        "FROM public.compliance_records cr"),
            await conn.fetchval("SELECT count(*) FROM public.audit_log"))


async def test_el_match_propone_solo_entre_quienes_deben_y_no_escribe(conexion_revertida):
    """Review Focus 4: un archivo de alguien al día queda sin asignar."""
    conn = conexion_revertida
    hoy = await _hoy(conn)
    req = await _requisito(conn, entidad="CARRIER", politica="REQUIRED")
    debe = await _empresa(conn)
    al_dia = await _empresa(conn)
    rut_debe, rut_al_dia = await _con_rut(conn, debe), await _con_rut(conn, al_dia)
    await _registro(conn, req, "CARRIER", debe)
    await _registro(conn, req, "CARRIER", al_dia, status="APPROVED_MANUAL", vence=hoy + timedelta(days=400))
    antes = await _escrituras(conn)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"doc {rut_debe}.pdf", f"doc {rut_al_dia}.pdf", "scan.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    estados = {f["file_name"]: f["status"] for f in res["files"]}
    assert estados == {f"doc {rut_debe}.pdf": "matched", f"doc {rut_al_dia}.pdf": "unmatched", "scan.pdf": "unmatched"}
    assert await _escrituras(conn) == antes


async def test_dos_archivos_para_el_mismo_dueno_quedan_por_elegir(conexion_revertida):
    """Review Focus 3: ninguno se guarda solo."""
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER")
    empresa = await _empresa(conn)
    rut = await _con_rut(conn, empresa)
    await _registro(conn, req, "CARRIER", empresa)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"a {rut}.pdf", f"b {rut}.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    assert [f["status"] for f in res["files"]] == ["ambiguous", "ambiguous"]
    assert all(f["record_id"] is None for f in res["files"])


async def test_el_match_reconoce_un_rut_guardado_con_puntos(conexion_revertida):
    """Ruling 2: la base puede tener el RUT crudo ('12.345.678-5'); el matcher lo
    recibe canónico, así que el archivo con '12345678-5' sí lo encuentra."""
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER")
    empresa = await _empresa(conn)
    canonico = await _con_rut(conn, empresa)
    cuerpo, dv = canonico.split("-")
    crudo = f"{int(cuerpo):,}".replace(",", ".") + "-" + dv
    # Escritura cruda: sin pasar por canonical_rut (si la columna lo rechaza, el test lo dirá).
    await conn.execute("UPDATE public.carriers SET tax_id = $2 WHERE id = $1", empresa, crudo)
    registro = await _registro(conn, req, "CARRIER", empresa)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"F30-1 {canonico}.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    assert (res["files"][0]["status"], res["files"][0]["record_id"]) == ("matched", registro)


async def test_el_match_no_propone_a_quien_esta_fuera_de_alcance(conexion_revertida):
    """Review Focus 4: una empresa inactiva con el documento faltante no debe nada."""
    conn = conexion_revertida
    req = await _requisito(conn, entidad="CARRIER")
    activa, inactiva = await _empresa(conn), await _empresa(conn, estado="INACTIVE")
    rut_activa, rut_inactiva = await _con_rut(conn, activa), await _con_rut(conn, inactiva)
    await _registro(conn, req, "CARRIER", activa)
    await _registro(conn, req, "CARRIER", inactiva)

    res = await match_pending_files(
        PendingMatchBody(requirement_id=req, file_names=[f"x {rut_activa}.pdf", f"x {rut_inactiva}.pdf"]),
        pool=PoolDeUnaConexion(conn), _=None)

    assert [f["status"] for f in res["files"]] == ["matched", "unmatched"]


# ── entered_on: desde cuándo está quien debe (spec §5.2, "Falta · Ingresó hace N días") ──

async def test_entered_on_de_un_conductor_es_el_inicio_de_su_asignacion_vigente(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)  # asignación ACTIVE desde hoy - 400
    # Una asignación anterior, ya cerrada, no es "cuándo ingresó" hoy.
    otra = await _empresa(conn)
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date, end_date) "
        "VALUES ($1, $2, 'INACTIVE', public.hoy_chile() - 900, public.hoy_chile() - 500)", conductor, otra)
    req = await _requisito(conn, entidad="DRIVER")
    await _registro(conn, req, "DRIVER", conductor)

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="missing")

    assert [r["entered_on"] for r in res["rows"]] == [await _hoy(conn) - timedelta(days=400)]


async def test_entered_on_de_un_equipo_es_el_inicio_de_su_asignacion_vigente(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    equipo = await _equipo(conn, empresa)
    await conn.execute(
        "UPDATE public.asset_assignments SET start_date = public.hoy_chile() - 10 WHERE asset_id = $1", equipo)
    req = await _requisito(conn, entidad="ASSET")
    await _registro(conn, req, "ASSET", equipo)

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="missing")

    assert [r["entered_on"] for r in res["rows"]] == [await _hoy(conn) - timedelta(days=10)]


async def test_entered_on_de_una_empresa_es_su_alta_en_hora_de_chile(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    # 02:30 UTC del día 20 son las 23:30 (o 22:30) del 19 en Chile.
    await conn.execute(
        "UPDATE public.carriers SET created_at = '2026-09-20 02:30:00+00' WHERE id = $1", empresa)
    req = await _requisito(conn, entidad="CARRIER")
    await _registro(conn, req, "CARRIER", empresa)

    res = await _listar(conn, requirement_code=await _codigo(conn, req), state="missing")

    assert [r["entered_on"] for r in res["rows"]] == [date(2026, 9, 19)]
