"""Cuándo se exige un documento (HU-C1, entrega 2b, F3).

La siembra (5 funciones reconcile_* + SQL_ENTIDADES_QUE_APLICAN), la lectura
(urgencia NO_EXIGIBLE, cubierto) y "Solicitar documento", contra la base en
una transacción revertida. Las funciones de siembra se cargan desde su
migración. Los nombres son SINTÉTICOS."""
from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.routers.compliance import (
    get_certification_status,
    list_pending_compliance_records,
    listar_solicitables,
    quitar_solicitud,
    solicitar_documento,
)
from app.schemas.compliance import SolicitudBody
from app.services.requirement_conditions import calcular_diferencias
from tests.conftest import USER, PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

MIGRACION = (
    Path(__file__).resolve().parents[2]
    / "supabase/migrations/20261009110000_siembra_respeta_exigible_on.sql"
)
PREFIJO = "ZZ-TEST-EXIG"


async def _cargar(conn) -> None:
    for funcion in re.findall(r"CREATE OR REPLACE FUNCTION.*?\$function\$;",
                              MIGRACION.read_text(), re.S):
        await conn.execute(funcion)


async def _hoy(conn, dia: dt.date) -> None:
    await conn.execute(
        "CREATE OR REPLACE FUNCTION public.hoy_chile() RETURNS date "
        f"LANGUAGE sql STABLE AS $$ SELECT DATE '{dia.isoformat()}' $$"
    )


def _s() -> str:
    return uuid4().hex[:8].upper()


async def _empresa(conn):
    s = _s()
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id) VALUES ($1, $2) RETURNING id",
        f"{PREFIJO} {s}", f"{PREFIJO}-{s}")


async def _conductor(conn, empresa=None, *, desde=None, estado="ACTIVE"):
    conductor = await conn.fetchval(
        "INSERT INTO public.drivers (full_name) VALUES ($1) RETURNING id", f"{PREFIJO} {_s()}")
    if empresa:
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE))",
            conductor, empresa, estado, desde)
    return conductor


async def _requisito(conn, *, entidad="CARRIER", exigible_on="ON_ENTITY_START", activo=True):
    return await conn.fetchval(
        """
        INSERT INTO public.compliance_requirements
            (requirement_code, name, target_entity, requirement_level,
             expiration_policy, exigible_on, is_active)
        VALUES ($1, $2, $3, 'LEGAL_MANDATORY', 'NONE', $4, $5)
        RETURNING id
        """,
        f"ZZ_EXIG_{_s()}", f"{PREFIJO} requisito", entidad, exigible_on, activo)


async def _registros(conn, requisito) -> int:
    return await conn.fetchval(
        "SELECT count(*) FROM public.compliance_records WHERE requirement_id = $1 AND is_current",
        requisito)


async def _fila_de_la_cola(conn, empresa, requisito, estado="todos"):
    respuesta = await list_pending_compliance_records(
        carrier_id=str(empresa), category=None, requirement_code=None, q="",
        operation_type=None, entity_id=None, limit=200, offset=0, estado=estado,
        pool=PoolDeUnaConexion(conn), _=USER)
    filas = [f for f in respuesta["rows"] if f["requirement_id"] == str(requisito)]
    return filas[0] if filas else None


# ── Siembra ─────────────────────────────────────────────────────────────────

async def test_activar_un_documento_a_pedido_no_siembra_a_nadie(conexion_revertida):
    await _cargar(conexion_revertida)
    await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    assert await _registros(conexion_revertida, requisito) == 0
    diferencias = await calcular_diferencias(PoolDeUnaConexion(conexion_revertida), str(requisito))
    assert diferencias["crear"] == []


async def test_una_entidad_nueva_no_recibe_los_documentos_a_pedido(conexion_revertida):
    await _cargar(conexion_revertida)
    a_pedido = await _requisito(conexion_revertida, entidad="DRIVER", exigible_on="ON_REQUEST")
    al_ingreso = await _requisito(conexion_revertida, entidad="DRIVER")
    conductor = await _conductor(conexion_revertida)
    tiene = {r["requirement_id"] for r in await conexion_revertida.fetch(
        "SELECT requirement_id FROM public.compliance_records WHERE entity_id = $1", conductor)}
    assert al_ingreso in tiene and a_pedido not in tiene


# ── Solicitar documento ─────────────────────────────────────────────────────

async def test_solicitar_crea_el_pendiente_como_decision_humana(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    usuario = await _usuario_real(conexion_revertida)
    cuerpo = SolicitudBody(requirement_id=str(requisito), entity_type="CARRIER", entity_id=str(empresa))

    await solicitar_documento(cuerpo, pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    await solicitar_documento(cuerpo, pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    fila = await _fila_de_la_cola(conexion_revertida, empresa, requisito)
    assert fila["a_pedido"] is True

    filas = await conexion_revertida.fetch(
        "SELECT status, is_manual_override FROM public.compliance_records "
        "WHERE requirement_id = $1 AND is_current", requisito)
    assert [(f["status"], f["is_manual_override"]) for f in filas] == [("MISSING", True)]
    # Recalcular no apaga lo que alguien pidió.
    diferencias = await calcular_diferencias(PoolDeUnaConexion(conexion_revertida), str(requisito))
    assert diferencias["quitar"] == []


@pytest.mark.parametrize("exigible_on,activo", [("ON_ENTITY_START", True), ("ON_REQUEST", False)])
async def test_solo_se_solicita_un_documento_a_pedido_y_vigente(conexion_revertida, exigible_on, activo):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, exigible_on=exigible_on, activo=activo)
    with pytest.raises(HTTPException) as error:
        await solicitar_documento(
            SolicitudBody(requirement_id=str(requisito), entity_type="CARRIER", entity_id=str(empresa)),
            pool=PoolDeUnaConexion(conexion_revertida), user=await _usuario_real(conexion_revertida))
    assert error.value.status_code == 409


async def test_quitar_una_solicitud_sin_archivo(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    usuario = await _usuario_real(conexion_revertida)
    fila = await solicitar_documento(
        SolicitudBody(requirement_id=str(requisito), entity_type="CARRIER", entity_id=str(empresa)),
        pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    await quitar_solicitud(fila["id"], pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert await _registros(conexion_revertida, requisito) == 0


async def test_no_se_quita_una_solicitud_con_archivo(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    usuario = await _usuario_real(conexion_revertida)
    fila = await solicitar_documento(
        SolicitudBody(requirement_id=str(requisito), entity_type="CARRIER", entity_id=str(empresa)),
        pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    await conexion_revertida.execute(
        "UPDATE public.compliance_records SET file_url = 'carrier/x/doc.pdf' WHERE id = $1::uuid",
        fila["id"])
    with pytest.raises(HTTPException) as error:
        await quitar_solicitud(fila["id"], pool=PoolDeUnaConexion(conexion_revertida), user=usuario)
    assert error.value.status_code == 409


async def test_la_lista_de_solicitables_trae_solo_los_a_pedido_sin_pedir(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    a_pedido = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    otro = await _requisito(conexion_revertida, exigible_on="ON_REQUEST")
    await _requisito(conexion_revertida)
    usuario = await _usuario_real(conexion_revertida)
    await solicitar_documento(
        SolicitudBody(requirement_id=str(otro), entity_type="CARRIER", entity_id=str(empresa)),
        pool=PoolDeUnaConexion(conexion_revertida), user=usuario)

    lista = await listar_solicitables(
        entity_type="CARRIER", entity_id=str(empresa),
        pool=PoolDeUnaConexion(conexion_revertida), _=USER)
    ids = {f["id"] for f in lista}
    assert str(a_pedido) in ids and str(otro) not in ids


# ── Aún no se exige (I5) ────────────────────────────────────────────────────

async def test_el_mes_del_ingreso_no_es_falta_ni_al_dia(conexion_revertida):
    await _cargar(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 10, 20))
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, entidad="DRIVER", exigible_on="MONTH_AFTER_START")
    await _conductor(conexion_revertida, empresa, desde=dt.date(2026, 10, 7))

    fila = await _fila_de_la_cola(conexion_revertida, empresa, requisito)
    assert fila["urgencia"] == "NO_EXIGIBLE"
    assert fila["exigible_desde"] == dt.date(2026, 11, 1)
    assert await _fila_de_la_cola(conexion_revertida, empresa, requisito, "falta") is None
    assert await _fila_de_la_cola(conexion_revertida, empresa, requisito, "al_dia") is None


async def test_el_mes_siguiente_ya_es_falta(conexion_revertida):
    await _cargar(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 11, 1))
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, entidad="DRIVER", exigible_on="MONTH_AFTER_START")
    await _conductor(conexion_revertida, empresa, desde=dt.date(2026, 10, 7))
    assert (await _fila_de_la_cola(conexion_revertida, empresa, requisito))["urgencia"] == "FALTA"


async def test_lo_que_aun_no_se_exige_no_cuenta_como_cubierto(conexion_revertida):
    await _cargar(conexion_revertida)
    await _hoy(conexion_revertida, dt.date(2026, 10, 20))
    empresa = await _empresa(conexion_revertida)
    await _requisito(conexion_revertida, entidad="DRIVER", exigible_on="MONTH_AFTER_START")
    conductor = await _conductor(conexion_revertida, empresa, desde=dt.date(2026, 10, 7))
    nombre = await conexion_revertida.fetchval(
        "SELECT full_name FROM public.drivers WHERE id = $1", conductor)

    estado = await get_certification_status(
        group="driver", scope="active", carrier_id=None, q=nombre, limit=5,
        pool=PoolDeUnaConexion(conexion_revertida), _=USER)
    fila = next(f for f in estado["rows"] if f["entity_id"] == str(conductor))
    total = fila["total_count"]
    assert fila["satisfied_count"] + fila["pending_count"] == total - 1


# ── Al término: a quién se le atribuye ──────────────────────────────────────

async def test_el_finiquito_aparece_en_la_empresa_que_el_conductor_dejo(conexion_revertida):
    await _cargar(conexion_revertida)
    empresa = await _empresa(conexion_revertida)
    requisito = await _requisito(conexion_revertida, entidad="DRIVER", exigible_on="ON_ENTITY_END")
    await _conductor(conexion_revertida, empresa, estado="INACTIVE")
    fila = await _fila_de_la_cola(conexion_revertida, empresa, requisito)
    assert fila is not None and fila["urgencia"] == "FALTA"
