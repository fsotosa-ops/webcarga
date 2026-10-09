"""Permiso por campo en viajes, dentro del modelo RBAC (spec 2026-10-09 §6).

Antes era una excepción del rol `writer` (issue #1): edita los campos básicos
del Diario y ninguno de los sensibles. Ahora es un mapa campo → permiso:
básicos → trips.edit_basic (Operador de Operaciones), el resto →
trips.edit_sensitive (Supervisor). Un campo sin permiso invalida el cuerpo
completo: aceptar la parte permitida dejaría al cliente creyendo que guardó todo.
"""
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase
from app.authz import Permission, require_fields
from app.db import get_pool
from app.routers.trips import router
from app.schemas.trip import STOP_FIELD_PERMISSIONS, TRIP_FIELD_PERMISSIONS, TripPatch, TripStopPatch
from tests.conftest import usuario

OPERADOR = usuario("operations_operator", aal="aal1")
SUPERVISOR = usuario("operations_supervisor", aal="aal1")
LECTURA = usuario("reader", aal="aal1")


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None}
    pool.fetch.return_value = []
    return pool


def make_client(user):
    """No se sobrescribe el guardia: el test ejercita require() de verdad."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: make_pool()
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# ── el mapa contra el modelo ────────────────────────────────────────────────

def test_todo_campo_del_patch_tiene_permiso():
    assert set(TripPatch.model_fields) == set(TRIP_FIELD_PERMISSIONS)
    assert set(TripStopPatch.model_fields) == set(STOP_FIELD_PERMISSIONS)


def test_los_basicos_de_hoy_siguen_siendo_basicos():
    basicos = {f for f, p in TRIP_FIELD_PERMISSIONS.items() if p is Permission.TRIPS_EDIT_BASIC}
    assert basicos == {"is_active", "is_working", "is_assigned", "is_first_leg", "notes", "comments", "driver_phone"}


def test_los_sensibles_quedan_fuera_de_los_basicos():
    for campo in ("driver_name", "tractor_plate", "trailer_plate", "unassigned_reason_id", "manual_status"):
        assert TRIP_FIELD_PERMISSIONS[campo] is Permission.TRIPS_EDIT_SENSITIVE


def test_la_parada_es_toda_basica_hoy():
    """Si se agrega un campo a TripStopPatch cae como sensible y este test obliga a decidir."""
    assert set(STOP_FIELD_PERMISSIONS.values()) == {Permission.TRIPS_EDIT_BASIC}


# ── el mecanismo ────────────────────────────────────────────────────────────

def test_cuerpo_mixto_se_rechaza_entero():
    """Review Focus 5."""
    with pytest.raises(HTTPException) as err:
        require_fields(OPERADOR, ["notes", "tractor_plate"], TRIP_FIELD_PERMISSIONS)
    assert err.value.status_code == 403 and "tractor_plate" in err.value.detail and "notes" not in err.value.detail


def test_supervisor_edita_todo():
    require_fields(SUPERVISOR, list(TRIP_FIELD_PERMISSIONS), TRIP_FIELD_PERMISSIONS)


# ── por la ruta real ────────────────────────────────────────────────────────

@pytest.mark.parametrize("cuerpo", [{"is_active": False}, {"notes": "sin novedad"}, {"driver_phone": "+56900000000"}],
                         ids=["toggle", "observaciones", "telefono"])
def test_operador_edita_los_basicos(cuerpo):
    r = make_client(OPERADOR).patch("/api/v1/trips/trip-1", json=cuerpo)
    assert r.status_code != 403, r.text


@pytest.mark.parametrize("cuerpo", [{"driver_name": "Otro"}, {"tractor_plate": "XXXX11"},
                                    {"unassigned_reason_id": "algun-uuid"}],
                         ids=["conductor", "patente", "motivo"])
def test_operador_no_edita_los_sensibles(cuerpo):
    r = make_client(OPERADOR).patch("/api/v1/trips/trip-1", json=cuerpo)
    assert r.status_code == 403
    assert next(iter(cuerpo)) in r.json()["detail"]


def test_lectura_no_escribe_nada():
    assert make_client(LECTURA).patch("/api/v1/trips/trip-1", json={"notes": "hola"}).status_code == 403


def test_supervisor_edita_los_sensibles():
    r = make_client(SUPERVISOR).patch("/api/v1/trips/trip-1", json={"driver_name": "Otro"})
    assert r.status_code != 403, r.text


def test_operador_completa_los_tiempos_de_la_parada():
    c = make_client(OPERADOR)
    for campo in ("desc_inicio", "desc_fin", "arrival", "departure"):
        r = c.patch("/api/v1/trips/trip-1/stops/stop-1", json={campo: "2026-08-25 10:00"})
        assert r.status_code != 403, f"{campo}: {r.text}"


def test_lectura_no_completa_la_parada():
    r = make_client(LECTURA).patch("/api/v1/trips/trip-1/stops/stop-1", json={"desc_inicio": "2026-08-25 10:00"})
    assert r.status_code == 403
