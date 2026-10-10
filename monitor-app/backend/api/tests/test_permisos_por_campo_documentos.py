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


# Revisión final RBAC, hallazgo 4: corregir la fecha es carga MIENTRAS el
# documento espera revisión. Sobre uno ya aprobado, correr la fecha es extender
# su vigencia sin que nadie revise: eso exige documents.review.
def _cliente_con_registro(user, status):
    from datetime import date
    from tests.conftest import wire_transactional_conn
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"entity_id": "d1", "entity_type": "DRIVER", "status": status,
                                  "expiration_date": date(2026, 12, 1)}
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=False), conn


def _actualizo(conn) -> bool:
    return any("UPDATE public.compliance_records" in str(c.args[0]) for c in conn.execute.call_args_list)


def test_el_operador_no_extiende_la_vigencia_de_un_documento_aprobado():
    for status in ("APPROVED", "APPROVED_MANUAL"):
        cliente, conn = _cliente_con_registro(usuario("certification_operator"), status)
        r = cliente.patch("/api/v1/compliance-records/r1", json={"expiration_date": "2027-12-01"})
        assert r.status_code == 403, (status, r.text)
        assert "aprobado" in r.json()["detail"]
        assert not _actualizo(conn)


def test_el_operador_corrige_la_fecha_de_un_documento_por_revisar():
    cliente, conn = _cliente_con_registro(usuario("certification_operator"), "PENDING_REVIEW")
    r = cliente.patch("/api/v1/compliance-records/r1", json={"expiration_date": "2027-12-01"})
    assert r.status_code != 403, r.text
    assert _actualizo(conn)


def test_el_supervisor_corrige_la_fecha_de_un_documento_aprobado():
    cliente, conn = _cliente_con_registro(usuario("certification_supervisor"), "APPROVED")
    r = cliente.patch("/api/v1/compliance-records/r1", json={"expiration_date": "2027-12-01"})
    assert r.status_code != 403, r.text
    assert _actualizo(conn)
