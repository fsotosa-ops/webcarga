"""Tests del backend RELACIONAL de Empresas EETT (app/routers/transporters.py
— TRANSPORTERS_BACKEND=relational, default). Mismo patrón de mocks que
tests/test_trip_create.py / test_trip_notes.py: pool asyncpg mockeado con
AsyncMock, dependencias de auth sobreescritas vía dependency_overrides.
"""
from datetime import date, datetime, timezone
from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_admin, require_editor
from app.db import get_pool
from app.routers.transporters import router

USER_ID = "11111111-1111-1111-1111-111111111111"
TID = "aaaaaaaa-0000-0000-0000-000000000001"


def make_client(pool, role="admin", enforce_roles=False, supabase=None):
    """enforce_roles=False (default) bypassea require_editor/require_admin —
    igual que el resto de la suite. enforce_roles=True deja correr la lógica
    real de rol (necesario para probar 403 por rol insuficiente)."""
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    user = {"sub": USER_ID, "email": "operador@webcarga.cl", "role": role}
    app.dependency_overrides[get_current_user] = lambda: user
    if not enforce_roles:
        app.dependency_overrides[require_editor] = lambda: user
        app.dependency_overrides[require_admin] = lambda: user
    return TestClient(app)


# ── LIST con filtros nuevos ────────────────────────────────────────

def test_list_includes_new_fields_and_alert_filter():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": TID, "admin_id": "100", "business_name": "Transportes Test",
        "rut": "12345678-9", "account_stage": "Operational",
        "driver_count": 2, "vehicle_count": 1, "trailer_count": 1, "tracto_count": 1,
        "has_manual_edits": False, "has_active_alerts": True,
        "in_admin": True, "clients": ["Walmart"],
        "avance_80_20": 80.0, "avance_total": 75.0,
        "compliance_pct": 60.0, "eligible": False, "insurance_ok": True,
        "blocking_reasons": ["docs_below_threshold"],
    }]
    pool.fetchval.return_value = 1

    client = make_client(pool)
    res = client.get("/api/v1/transporters", params={"alert": "docs", "eligible": "false"})

    assert res.status_code == 200
    data = res.json()["data"]
    assert data[0]["tracto_count"] == 1
    assert data[0]["in_admin"] is True
    assert data[0]["clients"] == ["Walmart"]
    assert data[0]["blocking_reasons"] == ["docs_below_threshold"]
    assert data[0]["eligible"] is False

    fetch_sql = pool.fetch.call_args.args[0]
    assert "docs_below_threshold" in fetch_sql
    assert "el.eligible" in fetch_sql


def test_list_active_filter_adds_is_active_clause():
    pool = AsyncMock()
    pool.fetch.return_value = []
    pool.fetchval.return_value = 0

    client = make_client(pool)
    res = client.get("/api/v1/transporters", params={"active": "true"})

    assert res.status_code == 200
    fetch_sql = pool.fetch.call_args.args[0]
    assert "t.is_active" in fetch_sql


# ── GET detalle: ensambla governance desde documentos ──────────────

T_ROW = {
    "id": TID, "rut": "12345678", "dv": "9", "business_name": "Transportes Test",
    "account_stage": "Operational", "contactability": None,
    "admin_internal_id": 100, "in_admin": True, "clients": ["Walmart"],
    "avance_80_20": 80.0, "avance_total": 75.0,
    "manually_edited_fields": [], "edited_at": None,
    "updated_at": datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
}
CONTACTS = [{"role": "rep_legal", "name": "Ana", "phone": "+56911112222", "email": "ana@x.cl"}]
DRIVER_ROWS = [{
    "id": "d1", "rut": "11111111", "dv": "1", "full_name": "Juan Pérez",
    "id_expiry": None, "license_expiry": None, "avance_total": None,
}]
DRIVER_DOCS_RAW = [
    {"entity_id": "d1", "doc_name": "epp", "status": "ok"},
    {"entity_id": "d1", "doc_name": "creacion_gc_driver", "status": "pendiente"},
]
VEHICLE_ROWS = [{
    "id": "v1", "plate": "ABCD12", "kind": "tracto", "type_label": None, "year": 2020,
    "circ_permit_expiry": None, "tech_inspection_expiry": None,
    "gas_emissions_expiry": None, "soap_insurance_expiry": None,
}]
VEHICLE_DOCS_RAW = [{"entity_id": "v1", "doc_name": "padron", "status": "ok"}]
TRAILER_ROWS = [{"id": "t1", "plate": "RAMP01"}]
COMPANY_DOC_ROWS = [
    {"doc_code": "rol_sii", "label": "Rol SII", "status": "ok", "expiry_date": None,
     "storage_path": None, "updated_at": None},
]
ELIGIBILITY_ROW = {"eligible": True, "compliance_pct": 92.5, "insurance_ok": True, "blocking_reasons": []}


def test_get_profile_assembles_governance_from_documents():
    pool = AsyncMock()
    pool.fetchrow.side_effect = [T_ROW, ELIGIBILITY_ROW]
    pool.fetch.side_effect = [
        CONTACTS, DRIVER_ROWS, VEHICLE_ROWS, TRAILER_ROWS,
        DRIVER_DOCS_RAW, VEHICLE_DOCS_RAW, COMPANY_DOC_ROWS,
    ]

    client = make_client(pool)
    res = client.get(f"/api/v1/transporters/{TID}")

    assert res.status_code == 200
    data = res.json()
    assert data["rut"] == "12345678-9"
    assert data["in_admin"] is True
    assert data["drivers"][0]["governance"]["epp"] == "ok"
    # creacion_gc_driver (clave de gobernanza == doc_code, auditoría 2026-07-10)
    assert data["drivers"][0]["governance"]["creacion_gc_driver"] == "pendiente"
    assert data["vehicles"][0]["governance"]["padron"] == "ok"
    assert data["trailers"][0]["plate"] == "RAMP01"
    assert any(d["doc_code"] == "rol_sii" and d["status"] == "ok" for d in data["documents"])
    assert data["eligibility"]["eligible"] is True
    assert data["eligibility"]["compliance_pct"] == 92.5
    assert data["documents"][0]["doc_code"] == "rol_sii"


def test_get_profile_missing_is_404():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)
    res = client.get(f"/api/v1/transporters/{TID}")
    assert res.status_code == 404


# ── PATCH: optimistic locking ───────────────────────────────────────

def test_patch_stale_expected_updated_at_is_409():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"updated_at": datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)}
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}", json={
        "business_name": "Nuevo Nombre",
        "expected_updated_at": "2026-06-01T00:00:00Z",
    })
    assert res.status_code == 409
    # no debe haber llegado a ejecutar el UPDATE
    assert not any("UPDATE app.transporters SET" in str(c) for c in pool.execute.call_args_list)


def test_patch_matching_expected_updated_at_succeeds():
    pool = AsyncMock()
    updated_at = datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc)
    pool.fetchrow.side_effect = [{"updated_at": updated_at}, T_ROW, ELIGIBILITY_ROW]
    pool.fetch.side_effect = [
        CONTACTS, DRIVER_ROWS, VEHICLE_ROWS, TRAILER_ROWS,
        DRIVER_DOCS_RAW, VEHICLE_DOCS_RAW, COMPANY_DOC_ROWS,
    ]
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}", json={
        "business_name": "Nuevo Nombre",
        "expected_updated_at": updated_at.isoformat(),
    })
    assert res.status_code == 200


def test_patch_no_fields_is_422():
    pool = AsyncMock()
    pool.fetchrow.return_value = {"updated_at": None}
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}", json={})
    assert res.status_code == 422


# ── Transferencias: requieren admin ─────────────────────────────────

def test_transfer_driver_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post(
        f"/api/v1/transporters/{TID}/drivers/d1/transfer",
        json={"to_transporter_id": "bbbbbbbb-0000-0000-0000-000000000002"},
    )
    assert res.status_code == 403
    pool.fetchrow.assert_not_called()


def test_transfer_driver_succeeds_for_admin():
    pool = AsyncMock()
    dest_id = "bbbbbbbb-0000-0000-0000-000000000002"
    pool.fetchrow.return_value = {"id": "assign-1"}
    pool.fetchval.return_value = dest_id
    client = make_client(pool, role="admin", enforce_roles=True)
    res = client.post(
        f"/api/v1/transporters/{TID}/drivers/d1/transfer",
        json={"to_transporter_id": dest_id},
    )
    assert res.status_code == 200
    assert res.json()["to_transporter_id"] == dest_id
    audit_calls = [c for c in pool.execute.call_args_list if "app.audit_log" in c.args[0]]
    assert audit_calls and "transfer" in audit_calls[0].args[0]


def test_transfer_vehicle_requires_admin():
    pool = AsyncMock()
    client = make_client(pool, role="editor", enforce_roles=True)
    res = client.post(
        f"/api/v1/transporters/{TID}/vehicles/v1/transfer",
        json={"to_transporter_id": "bbbbbbbb-0000-0000-0000-000000000002"},
    )
    assert res.status_code == 403


# ── Documentos: upload rechaza mime no permitido ────────────────────

def test_upload_document_file_rejects_bad_mime():
    pool = AsyncMock()
    pool.fetchval.side_effect = [TID, "rol_sii"]  # _resolve_entity, catalog check
    pool.fetchrow.return_value = {
        "id": "doc1", "entity_type": "transporter", "entity_id": TID, "doc_code": "rol_sii",
        "status": None, "expiry_date": None, "file_url": None, "storage_path": None,
        "notes": None, "manual_override": True, "updated_at": None,
    }
    client = make_client(pool)
    res = client.post(
        f"/api/v1/transporters/{TID}/documents/rol_sii/file",
        files={"file": ("virus.exe", b"MZ", "application/x-msdownload")},
    )
    assert res.status_code == 422


def test_patch_document_invalid_doc_code_is_422():
    pool = AsyncMock()
    pool.fetchval.side_effect = [TID, None]  # _resolve_entity ok, catalog check falla
    client = make_client(pool)
    res = client.patch(
        f"/api/v1/transporters/{TID}/documents/no-existe",
        json={"status": "ok"},
    )
    assert res.status_code == 422


# ── Documentos: repunte a tablas angostas (Checkpoint B Task 3) ────
# Estos tests existen para que un futuro desfase de schema como el que
# motivó este task (helpers apuntando a app.compliance_documents, dropeada
# en Checkpoint A) se detecte en CI vía el mock, sin depender de Supabase
# real — verifican explícitamente el nombre de tabla en la query ejecutada.

def test_patch_transporter_document_uses_transporter_documents_table():
    pool = AsyncMock()
    pool.fetchval.side_effect = [TID, "rol_sii"]  # _resolve_entity, catalog check
    pool.fetchrow.return_value = {
        "transporter_id": TID, "doc_name": "rol_sii", "status": "ok",
        "expiry_date": None, "storage_path": None, "notes": None, "updated_at": None,
    }
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}/documents/rol_sii", json={"status": "ok"})
    assert res.status_code == 200
    assert res.json()["doc_code"] == "rol_sii"
    insert_sql = pool.fetchrow.call_args.args[0]
    assert "app.transporter_documents" in insert_sql
    assert "app.compliance_documents" not in insert_sql


def test_patch_driver_document_uses_driver_documents_table():
    pool = AsyncMock()
    pool.fetchval.side_effect = ["d1", "epp"]  # _resolve_entity, catalog check
    pool.fetchrow.return_value = {
        "driver_id": "d1", "doc_name": "epp", "status": "ok",
        "expiry_date": None, "storage_path": None, "notes": None, "updated_at": None,
    }
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}/drivers/d1/documents/epp", json={"status": "ok"})
    assert res.status_code == 200
    insert_sql = pool.fetchrow.call_args.args[0]
    assert "app.driver_documents" in insert_sql
    assert "app.driver_assignments" not in insert_sql


def test_patch_vehicle_document_uses_vehicle_documents_table():
    pool = AsyncMock()
    pool.fetchval.side_effect = ["v1", "padron"]  # _resolve_entity, catalog check
    pool.fetchrow.return_value = {
        "vehicle_id": "v1", "doc_name": "padron", "status": "ok",
        "expiry_date": None, "storage_path": None, "notes": None, "updated_at": None,
    }
    client = make_client(pool)
    res = client.patch(f"/api/v1/transporters/{TID}/vehicles/v1/documents/padron", json={"status": "ok"})
    assert res.status_code == 200
    insert_sql = pool.fetchrow.call_args.args[0]
    assert "app.vehicle_documents" in insert_sql
    assert "app.vehicle_assignments" not in insert_sql


def test_upload_driver_document_file_uses_driver_documents_table_and_logs_replacement():
    pool = AsyncMock()
    pool.fetchval.side_effect = ["d1", "epp"]  # _resolve_entity, catalog check (inside _upsert_document)
    pool.fetchrow.side_effect = [
        {"status": "ok", "expiry_date": None, "storage_path": "driver/d1/epp/old_x.pdf"},  # current
        {"driver_id": "d1", "doc_name": "epp", "status": "ok", "expiry_date": None,
         "storage_path": "driver/d1/epp/new_x.pdf", "notes": None, "updated_at": None},  # upsert RETURNING
    ]
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    client = make_client(pool, supabase=supabase)

    res = client.post(
        f"/api/v1/transporters/{TID}/drivers/d1/documents/epp/file",
        files={"file": ("licencia.pdf", b"contenido", "application/pdf")},
    )

    assert res.status_code == 200
    current_lookup_sql = pool.fetchrow.call_args_list[0].args[0]
    upsert_sql = pool.fetchrow.call_args_list[1].args[0]
    assert "app.driver_documents" in current_lookup_sql
    assert "app.driver_documents" in upsert_sql
    # Reemplazo de archivo existente → debe loguear en audit_log (Task 2)
    audit_calls = [c for c in pool.execute.call_args_list if "app.audit_log" in c.args[0]]
    assert audit_calls and "document_replace" in audit_calls[0].args[0]


def test_list_vehicle_document_files_queries_audit_log_with_correct_entity_type():
    pool = AsyncMock()
    pool.fetchval.return_value = "v1"  # _resolve_entity
    pool.fetch.return_value = []
    client = make_client(pool)

    res = client.get(f"/api/v1/transporters/{TID}/vehicles/v1/documents/padron/files")

    assert res.status_code == 200
    assert res.json() == []
    fetch_call = pool.fetch.call_args
    assert "app.audit_log" in fetch_call.args[0]
    assert fetch_call.args[1] == "vehicle"
    assert fetch_call.args[2] == "v1"
    assert fetch_call.args[3] == "padron"


# ── Compliance alerts summary: incluye ineligible_transporters ─────

def test_compliance_alerts_summary_includes_ineligible_transporters():
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [{"doc_type": "id_expiry", "warning_days": 30}],
        [{"rut": "22222222", "dv": "2", "id_expiry": date(2026, 6, 1), "license_expiry": None}],
        [{"plate": "ZZZZ99", "circ_permit_expiry": None, "tech_inspection_expiry": None,
          "gas_emissions_expiry": None, "soap_insurance_expiry": None}],
        [{"rut": "12345678-9", "blocking_reasons": ["docs_below_threshold"]}],
    ]
    client = make_client(pool)
    res = client.get("/api/v1/transporters/compliance-alerts/summary")

    assert res.status_code == 200
    data = res.json()
    assert data["ineligible_transporters"] == {"12345678-9": ["docs_below_threshold"]}
    assert data["total_expired"] == 1
    assert "22222222-2" in data["driver_ruts"]
    assert data["driver_ruts"]["22222222-2"] == "expired"


def test_transporters_require_auth():
    pool = AsyncMock()
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    client = TestClient(app)
    res = client.get("/api/v1/transporters")
    assert res.status_code in (401, 403)
