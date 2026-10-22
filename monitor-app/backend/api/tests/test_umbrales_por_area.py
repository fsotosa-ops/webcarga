"""Cada umbral de vencimiento lo edita su área (Configuración, Parte 1, P1.4).

`documento_por_vencer` es de Certificación; `poliza_por_vencer`, de Seguros
(existía en la base desde Seguros E1 sin pantalla, y `insurance.configure`
existía sin sección). Un registro, `vencimientos.UMBRALES`, dice qué permiso
edita cada uno y dónde queda su revisión."""
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.config import router as config_router
from app.services.vencimientos import GLOBAL_ALERT_THRESHOLD, POLIZA_POR_VENCER, UMBRALES
from tests.conftest import usuario

CERT = usuario("certification_supervisor", sub="22222222-2222-2222-2222-222222222222")
SEG = usuario("insurance_supervisor", sub="33333333-3333-3333-3333-333333333333")


def cliente(pool, quien):
    # Los guardados de Configuración van en una transacción (menor diferido 3): la
    # conexión simulada es el mismo pool simulado, salvo que el test ya la haya armado.
    from unittest.mock import AsyncMock as _AsyncMock
    from tests.conftest import wire_transactional_conn as _wire
    if isinstance(getattr(pool, 'acquire', None), _AsyncMock):
        _wire(pool, pool)
    app = FastAPI()
    app.include_router(config_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: quien
    return TestClient(app)


def _fila(doc_type):
    return {"doc_type": doc_type, "label": "x", "warning_days": 30, "error_days": 0}


def test_seguros_edita_poliza_por_vencer_y_queda_revisado_en_su_area():
    pool = AsyncMock()
    pool.fetchrow.return_value = _fila(POLIZA_POR_VENCER)
    with patch("app.routers.config.registrar_revision", new=AsyncMock()) as revision:
        res = cliente(pool, SEG).patch(f"/api/v1/config/alert-thresholds/{POLIZA_POR_VENCER}", json={"warning_days": 45})
    assert res.status_code == 200
    assert revision.await_args.args[1:4] == ("insurance", "expiry-alerts", POLIZA_POR_VENCER)


def test_certificacion_no_edita_el_umbral_de_seguros():
    pool = AsyncMock()
    pool.fetchrow.return_value = _fila(POLIZA_POR_VENCER)
    res = cliente(pool, CERT).patch(f"/api/v1/config/alert-thresholds/{POLIZA_POR_VENCER}", json={"warning_days": 45})
    assert res.status_code == 403
    pool.execute.assert_not_called()


def test_el_aviso_de_documentos_sigue_siendo_de_certificacion():
    pool = AsyncMock()
    pool.fetchrow.return_value = _fila(GLOBAL_ALERT_THRESHOLD)
    assert cliente(pool, SEG).patch(
        f"/api/v1/config/alert-thresholds/{GLOBAL_ALERT_THRESHOLD}", json={"warning_days": 45}).status_code == 403


def test_un_umbral_fuera_del_registro_responde_404():
    pool = AsyncMock()
    assert cliente(pool, CERT).patch(
        "/api/v1/config/alert-thresholds/license_expiry", json={"warning_days": 10}).status_code == 404
    pool.execute.assert_not_called()


def test_get_devuelve_los_umbrales_del_registro():
    pool = AsyncMock()
    pool.fetch.return_value = []
    assert cliente(pool, CERT).get("/api/v1/config/alert-thresholds").status_code == 200
    sql, *args = pool.fetch.call_args.args
    assert "doc_type = ANY($1" in sql
    assert sorted(args[0]) == sorted(UMBRALES)


def test_seguros_es_una_seccion_revisable_con_su_permiso():
    from app.services.revisiones import POR_SECCION
    seccion = POR_SECCION[("insurance", "expiry-alerts")]
    assert seccion.permiso.value == "insurance.configure"
    assert POLIZA_POR_VENCER in seccion.sql
