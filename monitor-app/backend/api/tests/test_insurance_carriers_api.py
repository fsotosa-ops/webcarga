"""Seguros por empresa (17/10): la lista por empresa y el detalle de una empresa (E2, E3).

El veredicto y la alerta salen de la misma vista (`app.carrier_insurance_summary`); el
detalle trae las pólizas con sus cuotas en una consulta.
"""
from __future__ import annotations

from datetime import timedelta
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from tests.conftest import USER
from tests.test_insurance_status_integration import _policy, _today
from tests.test_insurance_verdict_integration import _cuota, _empresa

ACTOR = "11111111-1111-1111-1111-111111111111"


# ── Servicio, contra la copia local ───────────────────────────────────────────

async def test_E2_la_lista_trae_el_veredicto_y_la_alerta_de_la_vista(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    await _policy(conn, c, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=3))
    resp = await insurance.carrier_overview(conn)
    fila = next(r for r in resp["data"] if r["carrier_id"] == c)
    vista = await conn.fetchrow(
        "SELECT insurance_verdict, insurance_alert FROM app.carrier_insurance_summary WHERE carrier_id = $1", c)
    assert (fila["insurance_verdict"], fila["insurance_alert"]) == (vista["insurance_verdict"], vista["insurance_alert"])
    assert fila["carrier_name"] == "Veredicto Test SpA" and fila["carrier_tax_id"]
    assert resp["facets"]["EXPIRED"] >= 1 and resp["facets"]["total"] == len(resp["data"])


async def test_E3_el_detalle_trae_las_polizas_con_sus_cuotas_y_la_renovada_solo_con_deuda(conexion_revertida):
    from app.services import insurance

    conn = conexion_revertida
    hoy = await _today(conn)
    c = await _empresa(conn)
    pagada = await _policy(conn, c, valid_from=hoy - timedelta(days=800), valid_to=hoy - timedelta(days=400))
    await _cuota(conn, pagada, 1, hoy - timedelta(days=500), paid=True)
    sucesora_1 = await _policy(conn, c, valid_from=hoy - timedelta(days=400), valid_to=hoy - timedelta(days=30))
    await insurance.link_renewal(conn, pagada, sucesora_1, actor=ACTOR)
    await _cuota(conn, sucesora_1, 1, hoy - timedelta(days=60))
    vigente = await _policy(conn, c, valid_from=hoy - timedelta(days=30), valid_to=hoy + timedelta(days=335))
    await insurance.link_renewal(conn, sucesora_1, vigente, actor=ACTOR)
    await _cuota(conn, vigente, 1, hoy + timedelta(days=10))

    detalle = await insurance.carrier_insurance(conn, c)
    assert detalle["summary"]["insurance_verdict"] == "OVERDUE"
    ids = {p["id"]: p for p in detalle["policies"]}
    assert set(ids) == {sucesora_1, vigente}  # la renovada sin deuda no aparece
    assert [i["installment_number"] for i in ids[vigente]["installments"]] == [1]
    assert ids[sucesora_1]["policy_state"] == "RENEWED"


async def test_E3_una_empresa_que_no_existe_no_tiene_detalle(conexion_revertida):
    from app.services import insurance

    assert await insurance.carrier_insurance(conexion_revertida, "00000000-0000-0000-0000-000000000000") is None


# ── Router ────────────────────────────────────────────────────────────────────

def _client():
    a = FastAPI()
    from app.routers.insurance import router as insurance_router
    from app.routers.policies import router as policies
    from app.routers.carriers import router as carriers
    for r in (insurance_router, policies, carriers):
        a.include_router(r, prefix="/api/v1")
    a.dependency_overrides[get_pool] = lambda: AsyncMock()
    a.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(a)


def test_E3_el_detalle_de_una_empresa_que_no_existe_responde_404():
    with patch("app.services.insurance.carrier_insurance", AsyncMock(return_value=None)):
        assert _client().get("/api/v1/insurance/carriers/00000000-0000-0000-0000-000000000000").status_code == 404


def test_lo_reemplazado_ya_no_existe():
    from app.services import insurance
    for viejo in ("list_carriers", "carrier_policies", "CARRIER_STATES"):
        assert not hasattr(insurance, viejo), viejo
    # /policies es siempre la lista por póliza: un `group_by` viejo en un enlace se ignora.
    with patch("app.services.insurance.list_policies", AsyncMock(return_value={"data": []})) as por_poliza:
        assert _client().get("/api/v1/policies?group_by=carrier").status_code == 200
    por_poliza.assert_awaited_once()
    assert _client().get("/api/v1/carriers/c1/policies").status_code in (404, 405)


async def test_E3_una_inactiva_sin_polizas_existe_pero_no_tiene_veredicto(conexion_revertida):
    """La ficha de empresa la abre igual: sin veredicto y sin pólizas, no un 404."""
    from app.services import insurance

    c = await _empresa(conexion_revertida, status="INACTIVE")
    assert await insurance.carrier_insurance(conexion_revertida, c) == {"summary": None, "policies": []}
