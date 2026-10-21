"""Bloque 0 del Directorio, 0.3: permisos según la decisión D-e (12/10).

Operaciones (Operador y Supervisor) da de baja y reactiva conductores y
equipos; la baja de una empresa es de Certificación (y del Propietario).
Activar una empresa nueva (ONBOARDING → ACTIVE) sigue siendo editar: el
Supervisor de Operaciones la activa desde el pre-cierre (excepción R5).
Desde el 21/10 el estado cambia con acciones (activate / deactivate /
reactivate), no por PATCH; cada una exige el permiso de su transición
(schemas/states.LIFECYCLE_TRANSITIONS). Quitar del roster es editar. Un campo
sin permiso invalida el cuerpo entero: aceptar la parte permitida dejaría al
cliente creyendo que guardó todo."""
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
    conn.fetchrow.return_value = {"full_name": "Juan", "home_location_id": "cd-1"}
    pool.fetchrow.return_value = FILA_CONDUCTOR   # tiene origen: get_driver no pide sugerencia
    return pool, conn


def pool_de_equipo():
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "asset_type": "TRACTOCAMION", "manufacture_year": None,
        "fleet_service_type_id": None, "webcarga_operation_type_id": None}
    pool.fetchrow.return_value = FILA_EQUIPO
    return pool, conn


def pool_de_empresa(monkeypatch, estado_actual: str):
    """La empresa en `estado_actual`, con RUT. El detalle que devuelve el PATCH no
    es lo que se prueba acá."""
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


# ── El estado ya no se edita por PATCH (plan 2026-10-21) ─────────────────────

@pytest.mark.parametrize("ruta,pool_de", [
    ("/api/v1/drivers/d1", "conductor"), ("/api/v1/assets/a1", "equipo"), ("/api/v1/carriers/c1", "empresa")])
def test_el_patch_rechaza_el_estado(monkeypatch, ruta, pool_de):
    """Un campo que el PATCH no conoce es un 422, no un dato que se ignora: el
    estado cambia con una acción, que pide su permiso y su motivo."""
    pool, conn = (pool_de_conductor() if pool_de == "conductor" else pool_de_equipo() if pool_de == "equipo"
                  else pool_de_empresa(monkeypatch, "ACTIVE"))
    res = cliente(SUP_CERT, pool).patch(ruta, json={"operational_status": "INACTIVE"})
    assert res.status_code == 422
    assert not conn.execute.called


# ── Las acciones: cada una exige el permiso de su transición ─────────────────

MOTIVO = {"reason_id": "00000000-0000-0000-0000-0000000000aa"}


@pytest.fixture
def transicion(monkeypatch):
    """La regla de la transición se prueba contra la base (test_lifecycle_integration);
    aquí solo quién puede llamar cada acción."""
    fake = AsyncMock(return_value={"operational_status": "X"})
    monkeypatch.setattr(carriers_router.lifecycle, "transition", fake)
    return fake


@pytest.mark.parametrize("ruta", [
    "/api/v1/drivers/d1/deactivate", "/api/v1/drivers/d1/reactivate",
    "/api/v1/assets/a1/deactivate", "/api/v1/assets/a1/reactivate"])
def test_operaciones_da_de_baja_y_reactiva_conductores_y_equipos(transicion, ruta):
    pool = pool_de_conductor()[0] if "/drivers/" in ruta else pool_de_equipo()[0]
    assert cliente(OPERADOR, pool).post(ruta, json=MOTIVO).status_code == 200
    assert transicion.await_count == 1


@pytest.mark.parametrize("ruta", ["/api/v1/drivers/d1/deactivate", "/api/v1/assets/a1/reactivate"])
def test_lectura_no_da_de_baja_ni_reactiva(transicion, ruta):
    pool = pool_de_conductor()[0] if "/drivers/" in ruta else pool_de_equipo()[0]
    assert cliente(LECTURA, pool).post(ruta, json=MOTIVO).status_code == 403
    assert not transicion.called


def test_el_operador_no_renombra():
    pool, conn = pool_de_conductor()
    res = cliente(OPERADOR, pool).patch("/api/v1/drivers/d1", json={"full_name": "Otro"})
    assert res.status_code == 403
    assert not conn.execute.called


def test_el_operador_no_edita_un_equipo():
    pool, conn = pool_de_equipo()
    assert cliente(OPERADOR, pool).patch("/api/v1/assets/a1", json={"manufacture_year": 2019}).status_code == 403
    assert not conn.execute.called


def test_el_supervisor_de_operaciones_activa_una_empresa_nueva(monkeypatch, transicion):
    """Excepción R5 (decisión del usuario, 12/10): activar una empresa nueva es
    editar; el Supervisor de Operaciones la activa desde el pre-cierre."""
    pool, _ = pool_de_empresa(monkeypatch, "ONBOARDING")
    assert cliente(SUP_OPS, pool).post("/api/v1/carriers/c1/activate", json={}).status_code == 200
    assert transicion.await_args.kwargs["action"] == "activate"


def test_el_operador_no_activa_una_empresa_nueva(monkeypatch, transicion):
    """La excepción es de editar: el Operador no edita empresas."""
    pool, _ = pool_de_empresa(monkeypatch, "ONBOARDING")
    assert cliente(OPERADOR, pool).post("/api/v1/carriers/c1/activate", json={}).status_code == 403
    assert not transicion.called


@pytest.mark.parametrize("accion,cuerpo", [("deactivate", MOTIVO), ("reactivate", MOTIVO)])
def test_el_supervisor_de_operaciones_no_da_de_baja_ni_reactiva_una_empresa(monkeypatch, transicion, accion, cuerpo):
    pool, _ = pool_de_empresa(monkeypatch, "ACTIVE")
    assert cliente(SUP_OPS, pool).post(f"/api/v1/carriers/c1/{accion}", json=cuerpo).status_code == 403
    assert not transicion.called


@pytest.mark.parametrize("accion", ["deactivate", "reactivate"])
def test_certificacion_da_de_baja_y_reactiva_una_empresa(monkeypatch, transicion, accion):
    pool, _ = pool_de_empresa(monkeypatch, "ACTIVE")
    assert cliente(SUP_CERT, pool).post(f"/api/v1/carriers/c1/{accion}", json=MOTIVO).status_code == 200
    assert transicion.await_args.kwargs["action"] == accion


@pytest.mark.parametrize("ruta", [
    "/api/v1/carriers/c1/deactivate", "/api/v1/carriers/c1/reactivate", "/api/v1/drivers/d1/deactivate"])
def test_dar_de_baja_o_reactivar_sin_motivo_es_422(monkeypatch, transicion, ruta):
    pool, _ = pool_de_empresa(monkeypatch, "ACTIVE")
    assert cliente(SUP_CERT, pool).post(ruta, json={}).status_code == 422
    assert not transicion.called


# ── Quitar del roster y conductor habitual ───────────────────────────────────

@pytest.mark.parametrize("ruta", [
    "/api/v1/carriers/c1/drivers/d1", "/api/v1/carriers/c1/assets/a1", "/api/v1/assets/a1/driver-assignment"])
def test_quitar_es_editar(ruta):
    pool, conn = AsyncMock(), AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.execute.return_value = "UPDATE 1"
    assert cliente(SUP_OPS, pool).delete(ruta).status_code == 200
    assert cliente(OPERADOR, pool).delete(ruta).status_code == 403


# ── Onboarding (21/10): activar sin la carpeta completa es de Certificación ─────

def test_activar_como_excepcion_es_de_certificacion(monkeypatch, transicion):
    """Con motivo es una excepción: la decide quien es dueño de la documentación
    (directory.delete). El Supervisor de Operaciones activa solo si la empresa cumple."""
    pool, _ = pool_de_empresa(monkeypatch, "ONBOARDING")
    excepcion = {"reason_id": "00000000-0000-0000-0000-0000000000bb"}
    assert cliente(SUP_OPS, pool).post("/api/v1/carriers/c1/activate", json=excepcion).status_code == 403
    assert not transicion.called
    assert cliente(SUP_CERT, pool).post("/api/v1/carriers/c1/activate", json=excepcion).status_code == 200
    assert transicion.await_args.kwargs["reason_id"] == excepcion["reason_id"]
