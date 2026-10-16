"""Certificación › Documentos exigidos: la ficha de un documento (Parte 2, P2.6).

La lista trae "cumplen n de m" y el detalle trae los estados y el historial de
la regla base. Las cifras se comparan contra sujetos creados por el test, en
una transacción revertida; los predicados son los de Pendientes, no una copia.
"""
from __future__ import annotations

from datetime import date, timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.requirements import (
    get_compliance_requirement,
    list_compliance_requirements,
    requirements_router,
)
from tests import d1_subjects as s
from tests.conftest import USER, PoolDeUnaConexion


def make_client(pool):
    app = FastAPI()
    app.include_router(requirements_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(app)


def test_un_id_que_no_es_uuid_es_422():
    assert make_client(AsyncMock()).get("/api/v1/compliance-requirements/SOAP").status_code == 422


async def _documento_con_tres_empresas(conn) -> str:
    """Un documento de empresa con una al día, una vencida y una que falta."""
    req = await s.requirement(conn, entity="CARRIER", policy="REQUIRED")
    hoy = await s.today(conn)
    for estado, vence in (("APPROVED", hoy + timedelta(days=200)),
                          ("APPROVED", hoy - timedelta(days=5)),
                          ("MISSING", None)):
        empresa = await s.carrier(conn)
        await s.without_seeding(conn, empresa)
        await s.record(conn, req, "CARRIER", empresa, status=estado, expires=vence)
    return req


def test_el_lote_ya_no_existe():
    """El borrador en lote se retiró (Parte 2, 16/10): una regla se escribe
    solo desde la ficha del documento."""
    client = make_client(AsyncMock())
    assert client.post("/api/v1/compliance-requirements/batch-preview", json={}).status_code in (404, 405)
    assert client.post("/api/v1/compliance-requirements/batch-update", json={}).status_code in (404, 405)


@pytest.mark.integracion
async def test_la_lista_trae_cumplen_y_exigidos(conexion_revertida):
    conn = conexion_revertida
    await s.thresholds(conn)
    req = await _documento_con_tres_empresas(conn)
    # Una empresa dada de baja no se exige ni cumple, aunque tenga su registro al día.
    baja = await s.carrier(conn, status="INACTIVE")
    await s.without_seeding(conn, baja)
    await s.record(conn, req, "CARRIER", baja, status="APPROVED",
                   expires=await s.today(conn) + timedelta(days=200))

    filas = await list_compliance_requirements(target_entity=None, pool=PoolDeUnaConexion(conn), _=USER)
    fila = next(f for f in filas if f["id"] == req)

    assert fila["cumplen"] == 1
    assert fila["exigidos"] == fila["alcance"]["alcanzadas"]
    assert all("cumplen" in f and "exigidos" in f for f in filas)


@pytest.mark.integracion
async def test_el_detalle_trae_estados_y_el_historial_de_la_regla(conexion_revertida):
    conn = conexion_revertida
    await s.thresholds(conn)
    req = await _documento_con_tres_empresas(conn)
    # Fecha del documento con aviso propio: la regla cambió una vez (de 10 a 20 días).
    await conn.execute(
        "INSERT INTO public.compliance_requirement_rules (requirement_id, vigente_desde, warning_days) "
        "VALUES ($1, '-infinity', 10), ($1, '2026-01-01', 20)", req)

    detalle = await get_compliance_requirement(requirement_id=req, pool=PoolDeUnaConexion(conn), _=USER)

    assert detalle["id"] == req
    assert detalle["cumplen"] == 1
    assert detalle["estados"] == {"vencidos": 1, "por_vencer": 0, "al_dia": 1, "falta": 1}
    assert [(r["vigente_desde"], r["warning_days"]) for r in detalle["reglas"]] == [
        (date(2026, 1, 1), 20), (None, 10)]
    assert detalle["vigencia"]["warning_days"] == 20


@pytest.mark.integracion
async def test_un_documento_que_no_existe_es_404(conexion_revertida):
    with pytest.raises(HTTPException) as error:
        await get_compliance_requirement(requirement_id=str(uuid4()),
                                         pool=PoolDeUnaConexion(conexion_revertida), _=USER)
    assert error.value.status_code == 404
