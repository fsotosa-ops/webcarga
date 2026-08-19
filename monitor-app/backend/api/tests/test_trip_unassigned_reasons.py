from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.trips import router
from app.db import get_pool
from app.auth import get_current_user, get_supabase, require_editor

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}


def make_pool():
    pool = AsyncMock()
    pool.fetchval.return_value = "trip-1"  # SELECT id FROM app.trips (exists check)
    pool.fetchrow.return_value = {"id": "trip-1", "stops": "[]"}
    return pool


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)



# ── Mock de /trips/meta por CONTENIDO, no por posición ───────────────────────
#
# Estos tests usaban un side_effect posicional (`[[], [], [], [], filas, []]`) y
# índices fijos en call_args_list. Cada consulta nueva en el endpoint corría
# todos los índices y los rompía sin que el comportamiento bajo prueba hubiera
# cambiado — pasó al agregar `last_run_at` por TMS (Ronda 126). Despachar por un
# fragmento del SQL deja los tests atados a lo que de verdad afirman.

def meta_fetch(por_consulta: dict):
    """side_effect de pool.fetch que devuelve según un fragmento del SQL."""
    def _fetch(query, *args, **kwargs):
        for fragmento, filas in por_consulta.items():
            if fragmento in query:
                return filas
        return []
    return _fetch


def consulta_con(pool, fragmento: str) -> str:
    """La consulta realmente ejecutada que contiene ese fragmento."""
    for c in pool.fetch.call_args_list:
        if fragmento in c.args[0]:
            return c.args[0]
    raise AssertionError(f"ninguna consulta de /meta contiene {fragmento!r}")


def test_meta_exposes_active_unassigned_reasons_ordered_by_sort_order():
    pool = make_pool()
    pool.fetch.side_effect = meta_fetch({
        "DRIVER_REASON": [
            {"id": "pana", "label": "Pana"}, {"id": "sin_conductor", "label": "Sin conductor"},
        ],
    })
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/trips/meta")

    assert res.status_code == 200
    body = res.json()
    assert body["unassigned_reasons"] == [
        {"id": "pana", "label": "Pana"}, {"id": "sin_conductor", "label": "Sin conductor"},
    ]
    reasons_query = consulta_con(pool, "DRIVER_REASON")
    assert "app.status_taxonomies" in reasons_query
    assert "active = true" in reasons_query


def test_patch_trip_persists_unassigned_reason_id():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"unassigned_reason_id": "pana"})
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "unassigned_reason_id = $" in update.args[0]
    assert "pana" in update.args


def test_patch_trip_clears_unassigned_reason_id_with_empty_string():
    pool = make_pool()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/trip-1", json={"unassigned_reason_id": ""})
    assert res.status_code == 200
    update = next(c for c in pool.execute.call_args_list
                  if c.args[0].startswith("UPDATE app.trips SET"))
    assert "unassigned_reason_id = $" in update.args[0]
    assert None in update.args


def test_meta_reads_operational_states_and_unassigned_reasons_from_status_taxonomies():
    """Verifies GET /trips/meta reads from app.status_taxonomies (Tarea 4)."""
    pool = AsyncMock()
    pool.fetch.side_effect = meta_fetch({
        "OPERATIONAL_STATE": [
            {"id": "uuid-1", "label": "En bodega", "bg_color": "#fff", "text_color": "#000", "group": "otro"},
        ],
        "DRIVER_REASON": [{"id": "uuid-2", "label": "Documentación vencida"}],
    })
    pool.fetchrow.return_value = None  # monitor_alert_rules (optional)
    client = make_client(pool)

    res = client.get("/api/v1/trips/meta")

    assert res.status_code == 200
    body = res.json()
    assert body["operational_states"][0]["label"] == "En bodega"
    assert body["unassigned_reasons"][0]["label"] == "Documentación vencida"

    # Verify the queries read from app.status_taxonomies (not old tables)
    op_query = consulta_con(pool, "OPERATIONAL_STATE")
    reason_query = consulta_con(pool, "DRIVER_REASON")

    assert "app.status_taxonomies" in op_query, f"Expected app.status_taxonomies in op_query, got: {op_query}"
    assert "OPERATIONAL_STATE" in op_query, f"Expected OPERATIONAL_STATE domain filter in op_query, got: {op_query}"
    assert "app.status_taxonomies" in reason_query, f"Expected app.status_taxonomies in reason_query, got: {reason_query}"
    assert "DRIVER_REASON" in reason_query, f"Expected DRIVER_REASON domain filter in reason_query, got: {reason_query}"


def test_meta_exposes_clients_from_trips_with_normalized_shipper_join():
    """Bug 5.2: Cliente en la barra principal debe ser dinámico (solo
    shippers con viajes reales), no el catálogo completo de
    public.shippers — y debe normalizar lower(trim(...)) igual que el
    filtro de cliente (bug 5.1), no comparar exacto."""
    pool = AsyncMock()
    pool.fetch.side_effect = meta_fetch({
        "public.shippers": [{"id": "s1", "name": "Walmart"}, {"id": "s2", "name": "Sodimac"}],
    })
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/trips/meta")

    assert res.status_code == 200
    body = res.json()
    assert body["clients"] == [{"id": "s1", "name": "Walmart"}, {"id": "s2", "name": "Sodimac"}]

    clients_query = consulta_con(pool, "public.shippers")
    assert "lower(trim(sh.name)) = lower(trim(t.client_name))" in clients_query
    assert "sh.status = 'ACTIVE'" in clients_query
    assert "DISTINCT" in clients_query
