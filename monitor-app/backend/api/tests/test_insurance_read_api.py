"""Seguros, Entrega 1: la lectura sale de una sola regla (app.insurance_status y
app.carrier_insurance_summary) y pide el permiso de Seguros.
"""
from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from app.auth import get_current_user
from app.authz import Permission
from app.db import get_pool
from app.main import app
from tests.conftest import USER
from tests.test_toda_ruta_declara_permiso import _permisos


def _rutas_de_seguros():
    for r in app.routes:
        if not isinstance(r, APIRoute):
            continue
        if r.path.startswith(("/api/v1/policies", "/api/v1/installments")) or r.path in (
            "/api/v1/carriers/{carrier_id}/policies", "/api/v1/carriers/insurance-overview",
        ):
            yield r


# S7: ninguna lectura de Seguros alcanza con directory.read.
def test_S7_toda_lectura_de_seguros_pide_insurance_read():
    lecturas = {f"{r.path}": _permisos(r.dependant) for r in _rutas_de_seguros() if "GET" in r.methods}
    assert {"/api/v1/policies", "/api/v1/installments", "/api/v1/carriers/{carrier_id}/policies"} <= set(lecturas)
    mal = {p: perms for p, perms in lecturas.items() if perms != (Permission.INSURANCE_READ,)}
    assert mal == {}


def _client(pool):
    a = FastAPI()
    from app.routers.policies import router as policies
    from app.routers.installments import router as installments
    from app.routers.carriers import router as carriers
    for r in (policies, installments, carriers):
        a.include_router(r, prefix="/api/v1")
    a.dependency_overrides[get_pool] = lambda: pool
    a.dependency_overrides[get_current_user] = lambda: USER
    return TestClient(a)


def _sql(pool) -> str:
    return "\n".join(str(c.args[0]) for c in pool.fetch.call_args_list + pool.fetchrow.call_args_list + pool.fetchval.call_args_list)


def test_las_lecturas_salen_de_las_vistas_y_no_de_las_columnas_viejas():
    pool = AsyncMock()
    pool.fetch.return_value = []
    # Todas las cifras que piden las cinco respuestas, en cero.
    claves = ("total", "expired", "expiring_soon", "valid", "cancelled", "no_policy", "EXPIRED", "EXPIRING", "VALID",
              "NO_DATES", "CANCELLED", "UNPAID", "NO_FILE", "NO_POLICY", "OVERDUE", "DUE_30", "PAID", "ALL")
    pool.fetchrow.return_value = {k: 0 for k in claves}
    pool.fetchval.return_value = 0
    c = _client(pool)
    for url in ("/api/v1/policies?group_by=policy", "/api/v1/policies?group_by=carrier",
                "/api/v1/installments?state=OVERDUE", "/api/v1/carriers/c1/policies",
                "/api/v1/carriers/insurance-overview"):
        assert c.get(url).status_code == 200, url
    sql = _sql(pool)
    assert "app.insurance_status" in sql and "app.carrier_insurance_summary" in sql
    for viejo in ("carrier_insurance_status", "payment_status =", "expiration_alert_days", "total_installments FROM"):
        assert viejo not in sql, viejo
