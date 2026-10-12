"""Configuración › Alertas de vencimiento: solo el aviso general (D1-R4, R-E3).

Las filas por documento no las lee ninguna lógica (auditoría de estados,
"Hallazgo principal"): la pantalla prometía una alerta roja que nadie
calculaba. Desde el despliegue 2 la API ni las muestra ni las deja editar;
el despliegue 3 las borra.
"""
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.db import get_pool
from app.routers.config import router as config_router
from app.services.revisiones import POR_SECCION
from app.services.vencimientos import GLOBAL_ALERT_THRESHOLD
from tests.conftest import usuario

CERT = usuario("certification_supervisor", sub="22222222-2222-2222-2222-222222222222")


def cliente(pool):
    app = FastAPI()
    app.include_router(config_router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: CERT
    return TestClient(app)


def test_get_pide_solo_la_fila_global_con_parametro():
    pool = AsyncMock()
    pool.fetch.return_value = []
    assert cliente(pool).get("/api/v1/config/alert-thresholds").status_code == 200
    sql, *args = pool.fetch.call_args.args
    assert "WHERE doc_type = $1" in sql
    assert args == [GLOBAL_ALERT_THRESHOLD]


def test_patch_de_una_fila_por_documento_responde_404_y_no_escribe():
    pool = AsyncMock()
    res = cliente(pool).patch("/api/v1/config/alert-thresholds/license_expiry", json={"warning_days": 10})
    assert res.status_code == 404
    pool.execute.assert_not_called()


@pytest.mark.parametrize("cuerpo", [{"error_days": 30}, {"error_days": 31}, {"warning_days": 5, "error_days": 5}])
def test_patch_rechaza_un_critico_que_no_es_menor_que_el_aviso(cuerpo):
    pool = AsyncMock()
    pool.fetchrow.return_value = {"doc_type": GLOBAL_ALERT_THRESHOLD, "label": "x", "warning_days": 30, "error_days": 0}
    res = cliente(pool).patch(f"/api/v1/config/alert-thresholds/{GLOBAL_ALERT_THRESHOLD}", json=cuerpo)
    assert res.status_code == 422
    pool.execute.assert_not_called()


def test_patch_del_aviso_general_con_critico_menor_escribe():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"doc_type": GLOBAL_ALERT_THRESHOLD, "label": "x", "warning_days": 30, "error_days": 0}
    res = cliente(pool).patch(f"/api/v1/config/alert-thresholds/{GLOBAL_ALERT_THRESHOLD}", json={"error_days": 7})
    assert res.status_code == 200
    assert "UPDATE app.alert_thresholds" in " ".join(str(c.args[0]) for c in pool.execute.call_args_list)


@pytest.mark.integracion
@pytest.mark.asyncio
async def test_integracion_la_revision_cuenta_solo_el_aviso_general(conexion_revertida):
    """El sujeto lo crea el test: una fila por documento nueva no entra a la
    portada de Configuración como "sin revisar"."""
    conn = conexion_revertida
    await conn.execute(
        "INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES ($1, $2, 15, 0)",
        "ZZ-TEST-D1-doc", "ZZ-TEST-D1 documento")
    filas = await conn.fetch(POR_SECCION[("certification", "expiry-alerts")].sql)
    assert [f["id"] for f in filas] == [GLOBAL_ALERT_THRESHOLD]


def test_la_meta_del_monitor_ya_no_lleva_los_umbrales():
    """R-E4 (D1, Task 16): /trips/meta devolvía todas las filas de
    app.alert_thresholds y nadie las leía. Se retiraron de la meta, y el PATCH
    de alertas ya no invalida su caché."""
    import inspect

    from app.routers import config as config_router_module
    from app.routers.trips import TripsMeta

    assert "alert_thresholds" not in TripsMeta.model_fields
    patch_src = inspect.getsource(config_router_module.patch_alert_threshold)
    assert "invalidate_trips_meta_cache" not in patch_src
