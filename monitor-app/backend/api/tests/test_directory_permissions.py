"""Bloque 0 del Directorio, 0.3: permisos según la decisión D-e (12/10).

Operaciones (Operador y Supervisor) da de baja y reactiva conductores y
equipos; la baja de una empresa es de Certificación (y del Propietario).
Activar una empresa nueva (ONBOARDING → ACTIVE) sigue siendo editar: el
Supervisor de Operaciones la activa desde el pre-cierre (excepción R5).
Quitar del roster es editar. Un campo sin permiso invalida el cuerpo entero:
aceptar la parte permitida dejaría al cliente creyendo que guardó todo."""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.authz import Permission
from app.authz.permissions import PERMISSION_META, SYSTEM_ROLES
from app.db import get_pool
from app.routers import assets as assets_router
from app.routers import carriers as carriers_router
from app.routers import drivers as drivers_router
from app.schemas.asset import ASSET_FIELD_PERMISSIONS, AssetPatchBody
from app.schemas.carrier import CARRIER_FIELD_PERMISSIONS, CarrierPatchBody
from app.schemas.driver import DRIVER_FIELD_PERMISSIONS, DriverPatchBody
from tests.conftest import usuario, wire_transactional_conn

OPERADOR = usuario("operations_operator", aal="aal1")
SUP_OPS = usuario("operations_supervisor", aal="aal1")
SUP_CERT = usuario("certification_supervisor", aal="aal1")
LECTURA = usuario("reader", aal="aal1")
ADMIN_SOLO = usuario("admin", aal="aal2")

FILA_CONDUCTOR = {
    "id": "d1", "tax_id": "1-9", "country_code": "CL", "full_name": "Juan",
    "operational_status": "INACTIVE", "is_manual_override": True, "created_at": None,
    "total_requirements": 1, "last_document_update": None,
    "home_location_id": "cd-1", "home_location_name": "CD", "home_location_shipper": None,
    "carrier_id": "c1", "carrier_name": "Acme",
}
FILA_EQUIPO = {
    "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "operational_status": "INACTIVE",
    "manufacture_year": None, "is_manual_override": True, "created_at": None,
    "total_requirements": 1, "last_document_update": None,
}


def cliente(user, pool):
    """No se sobrescribe el guardia: el test ejercita require() de verdad."""
    app = FastAPI()
    for r in (drivers_router.router, assets_router.router, carriers_router.router):
        app.include_router(r, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


def pool_de_conductor():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"full_name": "Juan", "operational_status": "ACTIVE", "home_location_id": "cd-1"}
    pool.fetchrow.return_value = FILA_CONDUCTOR   # tiene origen: get_driver no pide sugerencia
    return pool, conn


def pool_de_equipo():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None,
        "fleet_service_type_id": None, "webcarga_operation_type_id": None}
    pool.fetchrow.return_value = FILA_EQUIPO
    return pool, conn


def pool_de_empresa(monkeypatch, estado_actual: str):
    """La empresa en `estado_actual`, con RUT (activarla no choca con el 422 de
    "sin RUT"). El detalle que devuelve el PATCH no es lo que se prueba acá."""
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"updated_at": None, "business_name": "Acme", "operational_status": estado_actual,
                                  "tax_id": "1-9", "management_types": None}
    conn.fetchval.return_value = None   # sin duplicado de RUT
    monkeypatch.setattr(carriers_router, "_assemble_carrier_detail", AsyncMock(return_value={"id": "c1"}))
    return pool, conn


# ── El catálogo ──────────────────────────────────────────────────────────────

def test_fleet_status_lo_tienen_operaciones_y_el_supervisor_de_certificacion():
    por = {r.code: r.permissions for r in SYSTEM_ROLES}
    fs = Permission.DIRECTORY_FLEET_STATUS
    assert {c for c, perms in por.items() if fs in perms} == {
        "operations_operator", "operations_supervisor", "certification_supervisor"}
    # Spec §8: Administración no cambia.
    assert fs not in por["admin"]


def test_la_descripcion_de_directory_delete_dice_lo_que_cubre():
    texto = PERMISSION_META[Permission.DIRECTORY_DELETE].description
    assert "empresas" in texto and "conductores" not in texto


def test_todo_campo_del_patch_tiene_permiso():
    assert set(DriverPatchBody.model_fields) == set(DRIVER_FIELD_PERMISSIONS)
    assert set(AssetPatchBody.model_fields) == set(ASSET_FIELD_PERMISSIONS)
    assert set(CarrierPatchBody.model_fields) == set(CARRIER_FIELD_PERMISSIONS)


# ── Conductores y equipos ────────────────────────────────────────────────────

def test_el_operador_da_de_baja_a_un_conductor():
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch("/api/v1/drivers/d1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 200
    assert conn.execute.called


def test_el_operador_no_renombra():
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch("/api/v1/drivers/d1", json={"full_name": "Otro"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_un_cuerpo_mixto_del_operador_se_rechaza_entero_y_no_escribe():
    """Review Focus 1."""
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch(
        "/api/v1/drivers/d1", json={"operational_status": "INACTIVE", "full_name": "Otro"})
    assert res.status_code == 403 and "full_name" in res.json()["detail"]
    assert not conn.execute.called


def test_un_cuerpo_mixto_pasa_con_los_dos_permisos():
    """El Supervisor de Operaciones tiene editar y dar de baja: el mismo cuerpo
    mixto que se le rechaza al Operador se le acepta (R8: los dos permisos)."""
    pool, conn = pool_de_conductor()
    res = cliente(SUP_OPS, pool).patch(
        "/api/v1/drivers/d1", json={"operational_status": "INACTIVE", "full_name": "Otro"})
    assert res.status_code == 200
    assert conn.execute.called


def test_lectura_no_da_de_baja():
    pool, conn = pool_de_conductor()
    res = cliente(LECTURA, pool).patch("/api/v1/drivers/d1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_el_operador_da_de_baja_un_equipo_y_no_edita_el_resto():
    pool, _ = pool_de_equipo()
    assert cliente(OPERADOR, pool).patch("/api/v1/assets/a1", json={"operational_status": "INACTIVE"}).status_code == 200
    pool, conn = pool_de_equipo()
    assert cliente(OPERADOR, pool).patch("/api/v1/assets/a1", json={"manufacture_year": 2019}).status_code == 403
    assert not conn.execute.called


# ── Empresas ─────────────────────────────────────────────────────────────────

def test_el_supervisor_de_operaciones_activa_una_empresa_nueva(monkeypatch):
    """Excepción R5 (decisión del usuario, 12/10): ONBOARDING → ACTIVE es
    editar; el Supervisor de Operaciones activa desde el pre-cierre."""
    pool, conn = pool_de_empresa(monkeypatch, "ONBOARDING")
    res = cliente(SUP_OPS, pool).patch("/api/v1/carriers/c1", json={"operational_status": "ACTIVE"})
    assert res.status_code == 200
    assert conn.execute.called


@pytest.mark.parametrize("actual,nuevo", [("ACTIVE", "INACTIVE"), ("INACTIVE", "ACTIVE")])
def test_el_supervisor_de_operaciones_no_da_de_baja_ni_reactiva_una_empresa(monkeypatch, actual, nuevo):
    pool, conn = pool_de_empresa(monkeypatch, actual)
    res = cliente(SUP_OPS, pool).patch("/api/v1/carriers/c1", json={"operational_status": nuevo})
    assert res.status_code == 403
    assert not conn.execute.called


def test_un_cuerpo_mixto_de_baja_de_empresa_se_rechaza_entero(monkeypatch):
    pool, conn = pool_de_empresa(monkeypatch, "ACTIVE")
    res = cliente(SUP_OPS, pool).patch(
        "/api/v1/carriers/c1", json={"operational_status": "INACTIVE", "business_name": "Otra"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_el_operador_no_activa_una_empresa_nueva(monkeypatch):
    """La excepción es de editar, no de dar de baja: el Operador no edita empresas."""
    pool, conn = pool_de_empresa(monkeypatch, "ONBOARDING")
    res = cliente(OPERADOR, pool).patch("/api/v1/carriers/c1", json={"operational_status": "ACTIVE"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_el_supervisor_de_certificacion_da_de_baja_una_empresa(monkeypatch):
    pool, conn = pool_de_empresa(monkeypatch, "ACTIVE")
    res = cliente(SUP_CERT, pool).patch("/api/v1/carriers/c1", json={"operational_status": "INACTIVE"})
    assert res.status_code == 200
    assert conn.execute.called


# ── Quitar del roster y conductor habitual ───────────────────────────────────

@pytest.mark.parametrize("ruta", [
    "/api/v1/carriers/c1/drivers/d1", "/api/v1/carriers/c1/assets/a1", "/api/v1/assets/a1/driver-assignment"])
def test_quitar_es_editar(ruta):
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 1"
    assert cliente(SUP_OPS, pool).delete(ruta).status_code == 200
    assert cliente(OPERADOR, pool).delete(ruta).status_code == 403
