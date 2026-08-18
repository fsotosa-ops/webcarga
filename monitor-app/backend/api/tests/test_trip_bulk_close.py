"""Selección masiva en el Diario para cerrar/finalizar varios viajes de una
(pedido explícito del usuario, 2026-08-02) — mismo mecanismo que ya usa
IndicatorSwitches por viaje individual (is_active/is_working=false,
protegido de que Mage lo pise vía manually_edited_fields), en lote."""
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.trips import router
from tests.conftest import wire_transactional_conn

USER = {
    "sub": "11111111-1111-1111-1111-111111111111",
    "email": "operador@webcarga.cl",
    "role": "editor",
}

# unassigned_reason_id pasó a ser obligatorio (2026-08-18): el cierre en lote
# no declara nada si no dice por qué. Cualquier string sirve acá — estos
# tests mockean el pool, no ejercitan el FK real contra status_taxonomies.
REASON_ID = "22222222-2222-2222-2222-222222222222"


def make_client(pool):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: MagicMock()
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    return TestClient(app)


def test_bulk_close_422_when_no_trip_ids():
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": []})
    assert res.status_code == 422


def test_bulk_close_422_when_no_unassigned_reason():
    """El motivo pasó a ser obligatorio: apagar un viaje sin decir por qué
    no declara nada (regla 2 de Pablo, "el acusete de operaciones")."""
    pool = AsyncMock()
    client = make_client(pool)
    res = client.patch("/api/v1/trips/bulk-close", json={"trip_ids": ["t1"]})
    assert res.status_code == 422


def test_bulk_close_422_when_reason_does_not_exist_or_is_wrong_domain():
    """Importante 3 + 6: `app.trips.unassigned_reason_id` tiene dos
    escritores con catálogos distintos (GestionPanel.tsx usa DRIVER_REASON,
    bulk-close usa TRIP_UNASSIGNED_REASON) y la FK no restringe el dominio.
    Un id que no existe en absoluto O que existe pero es de otro dominio
    tiene que dar 422 de negocio ANTES de escribir nada — no un 500 por FK
    después de dejar la nota/audit_log con "None"."""
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    pool.fetchrow.return_value = None  # ni existe, ni es del dominio correcto
    client = make_client(pool)

    res = client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1"], "unassigned_reason_id": REASON_ID},
    )

    assert res.status_code == 422
    pool.execute.assert_not_called()


def test_bulk_close_404_when_a_trip_is_missing():
    pool = AsyncMock()
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    client = make_client(pool)
    res = client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1", "t2"], "unassigned_reason_id": REASON_ID},
    )
    assert res.status_code == 404
    assert "t2" in res.json()["detail"]


def test_bulk_close_sets_is_active_and_is_working_false_for_all_selected():
    """El UPDATE corre sobre `conn` (dentro de la transacción que también
    envuelve log_change) — ver `wire_transactional_conn` en conftest para el
    wiring de `pool.acquire()`/`conn.transaction()`."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [
        {"id": "t1", "manually_edited_fields": []},
        {"id": "t2", "manually_edited_fields": []},
    ]
    pool.fetchrow.return_value = {"label": "Sin camión disponible"}
    client = make_client(pool)

    res = client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1", "t2"], "unassigned_reason_id": REASON_ID},
    )

    assert res.status_code == 200
    assert res.json() == {"ok": True, "closed": 2}
    update = next(c for c in conn.execute.call_args_list if c.args[0].strip().startswith("UPDATE app.trips"))
    sql = update.args[0]
    assert "is_active = false" in sql
    assert "is_working = false" in sql
    assert "unassigned_reason_id" in sql
    assert "manually_edited_fields" in sql
    assert update.args[1] == ["t1", "t2"]
    assert update.args[3] == REASON_ID


def test_bulk_close_logs_a_system_note_per_trip():
    """La nota va sobre `pool`, no sobre `conn`: `_log_system_note` corre
    deliberadamente FUERA de la transacción del UPDATE/log_change (es
    best-effort y se traga sus propios errores)."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    pool.fetchrow.return_value = {"label": "Sin camión disponible"}
    client = make_client(pool)

    client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1"], "unassigned_reason_id": REASON_ID},
    )

    note_calls = [c for c in pool.execute.call_args_list if "app.trip_notes" in c.args[0]]
    assert len(note_calls) == 1
    assert "No asignado por WebCarga" in note_calls[0].args[3]
    assert "Sin camión disponible" in note_calls[0].args[3]


def test_bulk_close_logs_to_audit_log_per_trip():
    """Spec §6.3: la declaración se cruza con facturación — no alcanza con
    la bitácora best-effort de _log_system_note, tiene que quedar también en
    public.audit_log vía log_change. La llamada va sobre `conn` (misma
    transacción que el UPDATE, ver `test_bulk_close_sets_is_active_...`),
    no sobre `pool`."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    pool.fetchrow.return_value = {"label": "Sin camión disponible"}
    client = make_client(pool)

    client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1"], "unassigned_reason_id": REASON_ID},
    )

    audit_calls = [c for c in conn.execute.call_args_list if "public.audit_log" in c.args[0]]
    assert len(audit_calls) == 1
    assert audit_calls[0].args[4] == "no_asignado_por_webcarga"
    assert audit_calls[0].args[5] == "unassigned_reason_id"


def test_bulk_close_route_does_not_collide_with_single_trip_patch():
    """Regresión: /bulk-close debe matchear como ruta literal, no como
    PATCH /{trip_id} con trip_id='bulk-close' — se declaró antes en el
    router justamente por esto."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    pool.fetch.return_value = [{"id": "t1", "manually_edited_fields": []}]
    pool.fetchrow.return_value = {"label": "Sin camión disponible"}
    client = make_client(pool)

    res = client.patch(
        "/api/v1/trips/bulk-close",
        json={"trip_ids": ["t1"], "unassigned_reason_id": REASON_ID},
    )

    assert res.status_code == 200
    assert "closed" in res.json()
