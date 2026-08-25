"""El rol `writer` edita los campos básicos del Diario, y sólo esos.

El issue #1 describía el problema: `writer` existía en el catálogo de roles y
en la jerarquía del frontend, pero las dos capas que efectivamente deciden
—`EDITOR_ROLES` en auth.py y el guardia de cada endpoint— no lo conocían. Dos
usuarios lo tenían y recibían 403 en cualquier escritura.

El arreglo que el issue descartaba explícitamente era meterlo en
`EDITOR_ROLES`: eso le daría también los campos sensibles que su propia
descripción excluye ("edita todos los campos incluyendo los sensibles" es la
definición de `editor`, no la de `writer`). Por eso la regla es **de campo**, y
esta suite la fija por los dos lados: lo que puede y lo que no.
"""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router
from app.db import get_pool
from app.auth import get_current_user, get_supabase
from app.schemas.trip import (
    TripPatch, TripStopPatch, CAMPOS_BASICOS_DEL_DIARIO, CAMPOS_BASICOS_DE_PARADA,
)

WRITER = {"sub": "22222222-2222-2222-2222-222222222222",
          "email": "writer@webcarga.cl", "role": "writer"}
VIEWER = {"sub": "33333333-3333-3333-3333-333333333333",
          "email": "viewer@webcarga.cl", "role": "viewer"}
EDITOR = {"sub": "11111111-1111-1111-1111-111111111111",
          "email": "editor@webcarga.cl", "role": "editor"}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"
    pool.fetchrow.return_value = {"id": "trip-1", "client_name": None}
    pool.fetch.return_value = []
    return pool


def make_client(user):
    """Ojo: NO se sobrescribe el guardia. El test ejercita el guardia real."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: make_pool()
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app)


# ── lo que el catálogo promete, contra lo que el modelo tiene ───────────────

def test_los_campos_basicos_existen_todos_en_el_modelo():
    """La lista no puede derivar del modelo que gobierna.

    Si alguien renombra un campo de `TripPatch` y no toca la lista, el permiso
    queda apuntando a un nombre que ya no existe: el guardia deja de proteger
    algo y nadie se entera. Esto lo convierte en un fallo de la suite."""
    del_modelo = set(TripPatch.model_fields)
    assert CAMPOS_BASICOS_DEL_DIARIO <= del_modelo, (
        "campos permitidos que el modelo no tiene: "
        f"{sorted(CAMPOS_BASICOS_DEL_DIARIO - del_modelo)}"
    )


def test_los_campos_sensibles_no_estan_en_la_lista_basica():
    """Los que el issue nombra como sensibles quedan fuera, explícitamente."""
    for campo in ("driver_name", "tractor_plate", "trailer_plate",
                  "unassigned_reason_id", "manual_status"):
        assert campo not in CAMPOS_BASICOS_DEL_DIARIO


# ── lo que writer SÍ puede ─────────────────────────────────────────────────

def test_writer_puede_editar_los_toggles():
    r = make_client(WRITER).patch("/api/v1/trips/trip-1", json={"is_active": False})
    assert r.status_code != 403, r.text


def test_writer_puede_escribir_observaciones():
    r = make_client(WRITER).patch("/api/v1/trips/trip-1", json={"notes": "sin novedad"})
    assert r.status_code != 403, r.text


def test_writer_puede_editar_el_telefono():
    r = make_client(WRITER).patch("/api/v1/trips/trip-1", json={"driver_phone": "+56900000000"})
    assert r.status_code != 403, r.text


# ── lo que writer NO puede ─────────────────────────────────────────────────

def test_writer_no_puede_cambiar_el_conductor():
    r = make_client(WRITER).patch("/api/v1/trips/trip-1", json={"driver_name": "Otro"})
    assert r.status_code == 403
    assert "driver_name" in r.json()["detail"]


def test_writer_no_puede_cambiar_la_patente():
    r = make_client(WRITER).patch("/api/v1/trips/trip-1", json={"tractor_plate": "XXXX11"})
    assert r.status_code == 403


def test_writer_no_puede_declarar_el_motivo_de_no_asignacion():
    """Cruza con facturación — lo dice el propio comentario del endpoint."""
    r = make_client(WRITER).patch("/api/v1/trips/trip-1",
                                  json={"unassigned_reason_id": "algun-uuid"})
    assert r.status_code == 403


def test_un_campo_prohibido_bloquea_todo_el_cuerpo():
    """Mezclar uno permitido con uno prohibido no cuela el prohibido."""
    r = make_client(WRITER).patch("/api/v1/trips/trip-1",
                                  json={"notes": "ok", "driver_name": "Otro"})
    assert r.status_code == 403
    assert "driver_name" in r.json()["detail"]
    assert "notes" not in r.json()["detail"]


# ── los otros dos roles no se mueven ───────────────────────────────────────

def test_viewer_sigue_sin_poder_escribir_nada():
    r = make_client(VIEWER).patch("/api/v1/trips/trip-1", json={"notes": "hola"})
    assert r.status_code == 403


def test_editor_sigue_pudiendo_editar_los_campos_sensibles():
    r = make_client(EDITOR).patch("/api/v1/trips/trip-1", json={"driver_name": "Otro"})
    assert r.status_code != 403, r.text


# ── la bitácora: es el campo "observaciones" que el rol promete ────────────

def test_writer_puede_escribir_en_la_bitacora():
    """La UI escribe las observaciones acá, no en el `notes` de TripPatch."""
    r = make_client(WRITER).post("/api/v1/trips/trip-1/notes", data={"body": "sin novedad"})
    assert r.status_code != 403, r.text


def test_viewer_no_puede_escribir_en_la_bitacora():
    r = make_client(VIEWER).post("/api/v1/trips/trip-1/notes", data={"body": "hola"})
    assert r.status_code == 403


def test_writer_no_puede_fijar_ni_resolver_una_nota():
    """Fijar y resolver cambian cómo el resto lee la nota: quedan en editor."""
    c = make_client(WRITER)
    assert c.patch("/api/v1/trips/trip-1/notes/nota-1/pin").status_code == 403
    assert c.patch("/api/v1/trips/trip-1/notes/nota-1/resolve").status_code == 403


# ── la parada: los cuatro campos que el equipo completa al operar ──────────

def test_la_lista_de_la_parada_cubre_el_modelo_entero():
    """Hoy `TripStopPatch` no tiene ningún campo sensible, y esta igualdad lo
    fija: si mañana se agrega uno, este test falla y obliga a decidir de qué
    lado cae, en vez de que el permiso se amplíe solo."""
    assert set(TripStopPatch.model_fields) == set(CAMPOS_BASICOS_DE_PARADA)


def test_writer_puede_completar_los_tiempos_de_la_parada():
    c = make_client(WRITER)
    for campo in ("desc_inicio", "desc_fin", "arrival", "departure"):
        r = c.patch("/api/v1/trips/trip-1/stops/stop-1", json={campo: "2026-08-25 10:00"})
        assert r.status_code != 403, f"{campo}: {r.text}"


def test_viewer_no_puede_completar_los_tiempos_de_la_parada():
    r = make_client(VIEWER).patch("/api/v1/trips/trip-1/stops/stop-1",
                                  json={"desc_inicio": "2026-08-25 10:00"})
    assert r.status_code == 403


# ── el mecanismo en sí ─────────────────────────────────────────────────────

def test_el_filtro_niega_un_campo_que_no_esta_en_la_lista():
    """El filtro de la parada no rechaza nada hoy, porque los cuatro campos de
    `TripStopPatch` son básicos. Se ejercita acá con un campo inventado para
    que el mecanismo no quede sin cubrir: es lo que va a correr el día que
    alguien agregue uno sensible."""
    import pytest
    from fastapi import HTTPException
    from app.routers.trips import _exigir_campos_permitidos

    with pytest.raises(HTTPException) as e:
        _exigir_campos_permitidos(WRITER, {"desc_inicio", "campo_futuro"},
                                  CAMPOS_BASICOS_DE_PARADA)
    assert e.value.status_code == 403
    assert "campo_futuro" in e.value.detail
    assert "desc_inicio" not in e.value.detail


def test_el_filtro_deja_pasar_a_editor_sin_mirar_los_campos():
    from app.routers.trips import _exigir_campos_permitidos
    _exigir_campos_permitidos(EDITOR, {"campo_futuro"}, CAMPOS_BASICOS_DE_PARADA)
