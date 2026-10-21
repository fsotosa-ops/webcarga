"""D1 "Una sola respuesta": el resumen de quien debe documentos, la habilitación y
el aviso (spec §5; app/services/fleet_compliance.py).

Contra la base real, en una transacción revertida. Los sujetos los crea cada
test (prefijo ZZ-TEST-D1). Al crearlos, los triggers de siembra les cargan los
requisitos activos de hoy: `_sin_registros` los borra, para que cada test parta
de cero y cuente solo lo que inserta. Los requisitos del test nacen apagados
(is_active = false). app.active_fleet es la de la base (migración aplicada en
la Task 10): ningún test la recrea."""
from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID, uuid4

import pytest

from app.routers.compliance import pending_summary
from app.services.fleet_compliance import (
    alert_severity_sql,
    carrier_compliance_cte,
    days_to_expiry_sql,
    entity_compliance_cte,
    summary_from_row,
)
from app.services.vencimientos import document_state_sql
from tests.conftest import PoolDeUnaConexion
from tests.conftest import asignacion_previa

pytestmark = pytest.mark.integracion

PREFIJO = "ZZ-TEST-D1"


def _suf() -> str:
    return uuid4().hex[:6].upper()


async def _empresa(conn, estado: str = "ACTIVE") -> UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Empresa {_suf()}", estado)


async def _conductor(conn, empresa: UUID, *, estado: str = "ACTIVE") -> UUID:
    d = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} Conductor {_suf()}", estado)
    await asignacion_previa(conn, 'DRIVER', d, empresa,
                            await conn.fetchval("SELECT public.hoy_chile() - 400"))
    return d


async def _tracto(conn, empresa: UUID) -> UUID:
    a = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type) VALUES ($1, 'TRACTOCAMION') RETURNING id",
        f"ZZ{_suf()[:4]}")
    await asignacion_previa(conn, 'ASSET', a, empresa)
    return a


async def _sin_registros(conn, *entidades: UUID) -> None:
    await conn.execute("DELETE FROM public.compliance_records WHERE entity_id = ANY($1::uuid[])", list(entidades))


async def _requisito(conn, entidad: str, *, nivel: str = "LEGAL_MANDATORY") -> UUID:
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (target_entity, requirement_code, name, requirement_level,
             expiration_policy, exigible_on, is_active, requires_file)
        VALUES ($1, $2, $3, $4, 'REQUIRED', 'ON_ENTITY_START', false, true)
        RETURNING id
        """,
        entidad, f"ZZ_D1_{_suf()}", f"{PREFIJO} documento", nivel)


async def _registro(conn, requisito: UUID, tipo: str, entidad: UUID, *,
                    status: str = "MISSING", vence: date | None = None) -> UUID:
    return await conn.fetchval(
        "INSERT INTO public.compliance_records "
        "(entity_id, entity_type, requirement_id, status, is_current, expiration_date, file_url) "
        "VALUES ($1, $2, $3, $4, true, $5, $6) RETURNING id",
        entidad, tipo, requisito, status, vence, None if status == "MISSING" else "zz/test.pdf")


async def _hoy(conn) -> date:
    return await conn.fetchval("SELECT public.hoy_chile()")


async def _de_la_empresa(conn, empresa: UUID):
    filas = await conn.fetch(
        f"WITH {carrier_compliance_cte()} SELECT * FROM carrier_compliance WHERE carrier_id = $1", empresa)
    assert len(filas) == 1, "una fila por empresa, siempre"
    return filas[0]


async def _de_la_entidad(conn, tipo: str, entidad: UUID):
    return await conn.fetch(
        f"WITH {entity_compliance_cte()} SELECT * FROM entity_compliance "
        "WHERE entity_type = $1 AND entity_id = $2", tipo, entidad)


# ── Review Focus ─────────────────────────────────────────────────────────────

async def test_empresa_activa_sin_registros_queda_habilitada(conexion_revertida):
    """Review Focus 1: recién creada, la siembra no corrió."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    await _sin_registros(conn, empresa)

    resumen = summary_from_row(await _de_la_empresa(conn, empresa), with_fleet=True)

    assert resumen.model_dump() == {
        "worst_state": "UP_TO_DATE",
        "own": {"overdue": 0, "expiring": 0, "missing": 0},
        "fleet": {"overdue": 0, "expiring": 0, "missing": 0},
        "can_operate": True,
        "blocking": {"own": 0, "fleet": 0},
        "requirements_met": True,
    }


async def test_conductor_con_dos_tractos_cuenta_una_vez(conexion_revertida):
    """Review Focus 2: vehicle_driver_assignments permite un conductor en dos
    tractos; sus documentos se cuentan una vez."""
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    tractos = [await _tracto(conn, empresa) for _ in range(2)]
    for tracto in tractos:
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
            "VALUES ($1, $2, 'ACTIVE', 'manual', true)", tracto, conductor)
    await _sin_registros(conn, empresa, conductor, *tractos)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor)

    fila = await _de_la_empresa(conn, empresa)
    entidad = await _de_la_entidad(conn, "DRIVER", conductor)
    pendientes = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)

    assert (fila["fleet_missing"], fila["own_missing"]) == (1, 0)
    assert [(e["missing"], e["blocking_mandatory"]) for e in entidad] == [(1, 1)]
    assert [(r["overdue"], r["expiring"], r["missing"]) for r in pendientes["rows"]
            if r["key"] == str(empresa)] == [(0, 0, 1)]


async def test_aviso_en_el_borde_del_dia_de_chile(conexion_revertida):
    """Review Focus 3. A las 22:30 de Chile el día UTC ya es el siguiente: se
    simula dejando hoy_chile() en la víspera de CURRENT_DATE (patrón de
    test_assignment_start_date_integration.py). Con error_days (10) mayor que
    los días de aviso de la regla (3): vence hoy es 'critical' y no vencido;
    venció ayer es OVERDUE y sin aviso."""
    conn = conexion_revertida
    vispera = await conn.fetchval("SELECT CURRENT_DATE - 1")
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{vispera.isoformat()}' $$")
    await conn.execute("UPDATE app.alert_thresholds SET error_days = 10 WHERE doc_type = 'documento_por_vencer'")
    empresa = await _empresa(conn)
    requisito = await _requisito(conn, "CARRIER")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, warning_days) "
        "VALUES ($1, NULL, 3)", requisito)
    otra = await _empresa(conn)
    vence_hoy = await _registro(conn, requisito, "CARRIER", empresa, status="APPROVED_MANUAL", vence=vispera)
    vencio_ayer = await _registro(conn, requisito, "CARRIER", otra, status="APPROVED_MANUAL",
                                  vence=vispera - timedelta(days=1))

    async def aviso(registro):
        return tuple(await conn.fetchrow(
            f"SELECT {document_state_sql('cr')}, {days_to_expiry_sql('cr')}, {alert_severity_sql('cr')} "
            "FROM public.compliance_records cr WHERE cr.id = $1", registro))

    assert await aviso(vence_hoy) == ("EXPIRING", 0, "critical")
    assert await aviso(vencio_ayer) == ("OVERDUE", -1, None)


async def test_un_documento_al_dia_nunca_lleva_aviso_critico(conexion_revertida):
    """Ruling T4-C. El crítico es un tramo DENTRO del por vencer: con error_days
    (10) mayor que los días de aviso de la regla (3), un documento que vence en
    7 días está fuera de la ventana de su regla (Al día) aunque esté dentro de
    error_days; no puede llevar aviso crítico."""
    conn = conexion_revertida
    await conn.execute("UPDATE app.alert_thresholds SET error_days = 10 WHERE doc_type = 'documento_por_vencer'")
    empresa = await _empresa(conn)
    requisito = await _requisito(conn, "CARRIER")
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, shipper_id, warning_days) "
        "VALUES ($1, NULL, 3)", requisito)
    hoy = await _hoy(conn)
    registro = await _registro(conn, requisito, "CARRIER", empresa, status="APPROVED_MANUAL",
                               vence=hoy + timedelta(days=7))
    fila = await conn.fetchrow(
        f"SELECT {document_state_sql('cr')} AS estado, {days_to_expiry_sql('cr')} AS dias, "
        f"{alert_severity_sql('cr')} AS aviso FROM public.compliance_records cr WHERE cr.id = $1", registro)
    assert (fila["estado"], fila["dias"], fila["aviso"]) == ("UP_TO_DATE", 7, None)


# ── Habilitación ─────────────────────────────────────────────────────────────

async def _empresa_con_un_documento(conn, *, nivel="LEGAL_MANDATORY", status="MISSING", vence=None,
                                    estado="ACTIVE"):
    empresa = await _empresa(conn, estado)
    await _sin_registros(conn, empresa)
    await _registro(conn, await _requisito(conn, "CARRIER", nivel=nivel), "CARRIER", empresa,
                    status=status, vence=vence)
    return empresa


async def test_un_obligatorio_que_falta_inhabilita(conexion_revertida):
    conn = conexion_revertida
    fila = await _de_la_empresa(conn, await _empresa_con_un_documento(conn))
    assert (fila["worst_state"], fila["own_missing"], fila["can_operate"]) == ("MISSING", 1, False)


async def test_por_vencer_no_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa_con_un_documento(conn, status="APPROVED_MANUAL",
                                              vence=await _hoy(conn) + timedelta(days=5))
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["worst_state"], fila["own_expiring"], fila["can_operate"]) == ("EXPIRING", 1, True)


async def test_un_opcional_vencido_no_inhabilita_ni_empeora_pero_cuenta(conexion_revertida):
    """Ruling A-R5 (resuelto, sigue la spec): el peor estado sale de los
    obligatorios; las cifras cuentan también los opcionales."""
    conn = conexion_revertida
    empresa = await _empresa_con_un_documento(conn, nivel="CONDITIONAL_OPTIONAL", status="APPROVED_MANUAL",
                                              vence=await _hoy(conn) - timedelta(days=5))
    fila = await _de_la_empresa(conn, empresa)
    entidad = await _de_la_entidad(conn, "CARRIER", empresa)
    assert (fila["worst_state"], fila["own_overdue"], fila["can_operate"]) == ("UP_TO_DATE", 1, True)
    assert [(e["worst_state"], e["overdue"]) for e in entidad] == [("UP_TO_DATE", 1)]


async def test_un_obligatorio_vencido_de_la_flota_activa_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=await _hoy(conn) - timedelta(days=1))
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["fleet_overdue"], fila["can_operate"]) == (1, False)


async def test_un_conductor_de_baja_no_cuenta_ni_inhabilita(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa, estado="INACTIVE")
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor)
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["fleet_missing"], fila["can_operate"]) == (0, True)


async def test_empresa_no_activa_nunca_habilitada_y_resume_lo_suyo_y_su_flota(conexion_revertida):
    """Ruling D1-R1: in_scope exige empresa activa; la no activa se resume con
    sus registros y los de su app.active_fleet, y nunca queda habilitada."""
    conn = conexion_revertida
    empresa = await _empresa(conn, "INACTIVE")
    conductor = await _conductor(conn, empresa)
    await _sin_registros(conn, empresa, conductor)
    await _registro(conn, await _requisito(conn, "CARRIER"), "CARRIER", empresa)
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=await _hoy(conn) - timedelta(days=1))

    fila = await _de_la_empresa(conn, empresa)

    assert (fila["worst_state"], fila["own_missing"], fila["fleet_overdue"], fila["can_operate"]) == \
        ("OVERDUE", 1, 1, False)


async def test_empresa_no_activa_sin_pendientes_tampoco_esta_habilitada(conexion_revertida):
    conn = conexion_revertida
    empresa = await _empresa(conn, "INACTIVE")
    await _sin_registros(conn, empresa)
    fila = await _de_la_empresa(conn, empresa)
    assert (fila["worst_state"], fila["can_operate"]) == ("UP_TO_DATE", False)


# ── Las cifras de una empresa activa son las de Pendientes ───────────────────

async def test_las_cifras_de_una_empresa_activa_son_las_de_pendientes(conexion_revertida):
    conn = conexion_revertida
    hoy = await _hoy(conn)
    empresa = await _empresa(conn)
    conductor = await _conductor(conn, empresa)
    de_baja = await _conductor(conn, empresa, estado="INACTIVE")
    tracto = await _tracto(conn, empresa)
    await _sin_registros(conn, empresa, conductor, de_baja, tracto)
    await _registro(conn, await _requisito(conn, "CARRIER"), "CARRIER", empresa)
    await _registro(conn, await _requisito(conn, "CARRIER", nivel="CONDITIONAL_OPTIONAL"), "CARRIER", empresa,
                    status="APPROVED_MANUAL", vence=hoy + timedelta(days=3))
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", conductor,
                    status="APPROVED_MANUAL", vence=hoy - timedelta(days=2))
    await _registro(conn, await _requisito(conn, "DRIVER"), "DRIVER", de_baja)
    await _registro(conn, await _requisito(conn, "ASSET"), "ASSET", tracto)

    resumen = summary_from_row(await _de_la_empresa(conn, empresa), with_fleet=True)
    pendientes = await pending_summary(group_by="carrier", pool=PoolDeUnaConexion(conn), _=None)
    fila = next(r for r in pendientes["rows"] if r["key"] == str(empresa))

    total = (resumen.own.overdue + resumen.fleet.overdue, resumen.own.expiring + resumen.fleet.expiring,
             resumen.own.missing + resumen.fleet.missing)
    assert total == (fila["overdue"], fila["expiring"], fila["missing"]) == (1, 1, 2)
