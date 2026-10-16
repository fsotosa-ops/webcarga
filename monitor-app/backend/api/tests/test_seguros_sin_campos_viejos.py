"""S15 (Seguros E2, contracción): nadie lee los estados guardados ni la API vieja.

Las columnas status, payment_status, total_installments, expiration_alert_days y
paid_at, la vista materializada y GET /carriers/insurance-overview se retiran.
Esta guarda falla si alguien los vuelve a usar (las migraciones viejas quedan
fuera: son historia)."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parents[3]
CARPETAS = [RAIZ / "backend/api/app", RAIZ / "frontend/app", RAIZ / "frontend/components", RAIZ / "frontend/lib", RAIZ / "frontend/hooks"]
VIEJOS = re.compile(r"payment_status|policy_health|worst_policy_health|total_installments|expiration_alert_days|"
                    r"insurance-overview|carrier_insurance_status|refresh_insurance_view|(?<![A-Za-z])_legacy_")


def test_S15_nadie_lee_lo_viejo_de_seguros():
    hallazgos = []
    for carpeta in CARPETAS:
        for ruta in carpeta.rglob("*"):
            if ruta.suffix not in (".py", ".ts", ".tsx") or "node_modules" in ruta.parts or ".test." in ruta.name:
                continue
            for n, linea in enumerate(ruta.read_text().splitlines(), start=1):
                if VIEJOS.search(linea):
                    hallazgos.append(f"{ruta.relative_to(RAIZ)}:{n}: {linea.strip()}")
    assert hallazgos == [], "\n".join(hallazgos)


def test_los_cuerpos_de_poliza_rechazan_campos_que_ya_no_existen():
    import pytest
    from pydantic import ValidationError
    from app.schemas.insurance import InsurancePolicyCreateBody, InsurancePolicyPatchBody

    with pytest.raises(ValidationError):
        InsurancePolicyCreateBody(carrier_id="c1", insurance_company="HDI", expiration_alert_days=45)
    with pytest.raises(ValidationError):
        InsurancePolicyPatchBody(status="CANCELLED")


def test_pagar_con_un_id_que_no_es_uuid_responde_422_y_no_500():
    from unittest.mock import AsyncMock
    from fastapi import FastAPI
    from app.auth import get_current_user
    from app.db import get_pool
    from app.routers.installments import router
    from tests.conftest import USER

    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: AsyncMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    res = TestClient(app).post("/api/v1/installments/pay", json={"ids": ["abc"], "paid_on": "2026-10-15"})
    assert res.status_code == 422
