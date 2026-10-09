"""Permiso por campo en un documento (RBAC): declarar o corregir la fecha de
vencimiento es parte de cargar (se hace incluso antes de tener el escaneo);
aprobar o rechazar es revisar. Mismo patrón que los viajes."""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.db import get_pool
from app.routers.compliance import router
from app.schemas.compliance import COMPLIANCE_RECORD_FIELD_PERMISSIONS, ComplianceRecordPatchBody
from tests.conftest import usuario


def _cliente(user):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: AsyncMock()
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False)


def test_todo_campo_tiene_permiso():
    assert set(ComplianceRecordPatchBody.model_fields) == set(COMPLIANCE_RECORD_FIELD_PERMISSIONS)


def test_el_operador_corrige_la_fecha():
    r = _cliente(usuario("certification_operator")).patch(
        "/api/v1/compliance-records/r1", json={"expiration_date": "2027-01-01"})
    assert r.status_code != 403, r.text


def test_el_operador_no_aprueba():
    r = _cliente(usuario("certification_operator")).patch(
        "/api/v1/compliance-records/r1", json={"status": "APPROVED_MANUAL"})
    assert r.status_code == 403 and "status" in r.json()["detail"]


def test_el_supervisor_aprueba():
    r = _cliente(usuario("certification_supervisor")).patch(
        "/api/v1/compliance-records/r1", json={"status": "APPROVED_MANUAL"})
    assert r.status_code != 403, r.text
