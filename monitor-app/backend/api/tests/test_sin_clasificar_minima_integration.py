"""Cert 2a mínima (Entrega A, 14/10): criterios S1-S5 de
docs/superpowers/plans/2026-10-14-entrega-a-d2-sin-clasificar.md, contra Postgres."""
from __future__ import annotations

import io
from datetime import date, timedelta
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from app.routers.document_ingest import _ingest_files, delete_item, list_queue, restore_item
from app.services.document_matcher import MatchCandidate
from tests.conftest import USER, PoolDeUnaConexion, _usuario_real

pytestmark = pytest.mark.integracion

PREFIX = "ZZ-TEST-2A"


def _file(content: bytes, name: str = "doc.pdf") -> UploadFile:
    return UploadFile(io.BytesIO(content), filename=name, headers=Headers({"content-type": "application/pdf"}))


def _supabase():
    supabase = MagicMock()
    supabase.storage.from_.return_value.upload.return_value = None
    return supabase


async def _requirement(conn, target: str = "DRIVER") -> str:
    return await conn.fetchval(
        "INSERT INTO public.compliance_requirements (target_entity, requirement_code, name, requirement_level, "
        "expiration_policy) VALUES ($1, $2, $3, 'LEGAL_MANDATORY', 'NONE') RETURNING id::text",
        target, f"ZZ_{uuid4().hex[:8].upper()}", f"{PREFIX} requisito")


async def _upload(conn, content: bytes, **kw):
    return await _ingest_files(conn, _supabase(), carrier_id=None, files=[_file(content)], actor=USER["sub"], **kw)


async def test_s1_discarding_keeps_the_row_and_restoring_brings_it_back(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    monkeypatch.setattr("app.routers.document_ingest.match_document", lambda **kw: [])
    user = await _usuario_real(conn)
    _, items, _, _ = await _upload(conn, uuid4().bytes)
    item = items[0]["id"]

    await delete_item(item, reason="ilegible", pool=PoolDeUnaConexion(conn), user=user)
    row = await conn.fetchrow(
        "SELECT match_status, storage_path, discard_reason, discarded_by FROM public.document_ingest_items WHERE id = $1",
        item)
    assert (row["match_status"], row["discard_reason"]) == ("DISCARDED", "ilegible")
    assert row["storage_path"] and str(row["discarded_by"]) == user["sub"]
    discarded = await list_queue(status="discarded", pool=PoolDeUnaConexion(conn), _=None)
    assert item in {r["id"] for r in discarded["rows"]}

    assert await restore_item(item, pool=PoolDeUnaConexion(conn), user=user) == {"match_status": "UNMATCHED"}
    pending = await list_queue(pool=PoolDeUnaConexion(conn), _=None)
    assert item in {r["id"] for r in pending["rows"]}


async def test_s2_an_identical_file_is_reported_and_not_queued_again(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    monkeypatch.setattr("app.routers.document_ingest.match_document", lambda **kw: [])
    content = uuid4().bytes
    _, first, _, _ = await _upload(conn, content)

    _, items, _, duplicates = await _upload(conn, content)

    assert items == []
    assert [(d["existing_item_id"], d["existing_status"]) for d in duplicates] == [(first[0]["id"], "UNMATCHED")]


async def test_s3_renewal_replaces_only_a_document_that_expires_later(conexion_revertida):
    from app.routers.document_ingest import classify_batch
    from app.schemas.document_ingest import ClassifyBatchBody

    conn = conexion_revertida
    user = await _usuario_real(conn)
    requirement = await conn.fetchval(
        "INSERT INTO public.compliance_requirements (target_entity, requirement_code, name, requirement_level, "
        "expiration_policy) VALUES ('CARRIER', $1, $2, 'LEGAL_MANDATORY', 'REQUIRED') RETURNING id::text",
        f"ZZ_{uuid4().hex[:8].upper()}", f"{PREFIX} con vencimiento")
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id::text",
        f"{PREFIX} Empresa {uuid4().hex[:6]}")
    today = await conn.fetchval("SELECT public.hoy_chile()")
    current_until = today + timedelta(days=60)
    await conn.execute(
        "INSERT INTO public.compliance_records (entity_type, entity_id, requirement_id, status, is_current, "
        "file_url, expiration_date) VALUES ('CARRIER', $1, $2, 'APPROVED', true, 'x/actual.pdf', $3) "
        "ON CONFLICT DO NOTHING", carrier, requirement, current_until)
    await conn.execute(
        "UPDATE public.compliance_records SET file_url = 'x/actual.pdf', expiration_date = $3, status = 'APPROVED' "
        "WHERE entity_id = $1 AND requirement_id = $2 AND is_current", carrier, requirement, current_until)

    async def classify(expires: date):
        _, items, _, _ = await _ingest_files(conn, _supabase(), carrier_id=carrier, files=[_file(uuid4().bytes)],
                                             actor=user["sub"])
        return await classify_batch(
            ClassifyBatchBody(item_ids=[items[0]["id"]], entity_type="CARRIER", entity_id=carrier,
                              requirement_id=requirement, expiration_date=expires),
            pool=PoolDeUnaConexion(conn), user=user)

    with pytest.raises(HTTPException) as exc:
        await classify(current_until - timedelta(days=1))
    assert exc.value.status_code == 409 and "solo se reemplaza por uno que vence después" in exc.value.detail

    result = await classify(current_until + timedelta(days=365))
    assert len(result["applied"]) == 1
    assert await conn.fetchval(
        "SELECT expiration_date FROM public.compliance_records WHERE entity_id = $1 AND requirement_id = $2 "
        "AND is_current", carrier, requirement) == current_until + timedelta(days=365)


async def test_s4_the_item_brings_the_carrier_of_the_suggested_driver(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    carrier = await conn.fetchval(
        "INSERT INTO public.carriers (business_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Empresa {uuid4().hex[:6]}")
    driver = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"{PREFIX} Conductor {uuid4().hex[:6]}")
    await conn.execute(
        "INSERT INTO public.driver_assignments (driver_id, carrier_id, status) VALUES ($1, $2, 'ACTIVE')",
        driver, carrier)
    candidate = MatchCandidate(entity_type="DRIVER", entity_id=str(driver), requirement_id=await _requirement(conn),
                               confidence=0.95, evidence={})
    monkeypatch.setattr("app.routers.document_ingest.match_document", lambda **kw: [candidate])

    _, items, _, _ = await _upload(conn, uuid4().bytes)

    assert await conn.fetchval(
        "SELECT carrier_id FROM public.document_ingest_items WHERE id = $1", items[0]["id"]) == carrier


async def test_s5_a_file_sent_from_pending_keeps_its_declared_type(conexion_revertida, monkeypatch):
    conn = conexion_revertida
    monkeypatch.setattr("app.routers.document_ingest.match_document", lambda **kw: [])
    requirement = await _requirement(conn)

    _, items, _, _ = await _upload(conn, uuid4().bytes, requirement_id=requirement)

    row = await conn.fetchrow(
        "SELECT requirement_id::text, entity_id FROM public.document_ingest_items WHERE id = $1", items[0]["id"])
    assert (row["requirement_id"], row["entity_id"]) == (requirement, None)


async def test_s5_the_declared_type_can_come_as_code_and_entity(conexion_revertida):
    """Pendientes habla en códigos: el código + la entidad resuelven el requisito general."""
    from app.routers.document_ingest import _declared_requirement

    conn = conexion_revertida
    code = f"ZZ_{uuid4().hex[:8].upper()}"
    general = await conn.fetchval(
        "INSERT INTO public.compliance_requirements (target_entity, requirement_code, name, requirement_level, "
        "expiration_policy) VALUES ('DRIVER', $1, $2, 'LEGAL_MANDATORY', 'NONE') RETURNING id::text",
        code, f"{PREFIX} general")

    assert await _declared_requirement(conn, None, code, "DRIVER") == general
    with pytest.raises(HTTPException) as exc:
        await _declared_requirement(conn, None, "ZZ_NO_EXISTE", "DRIVER")
    assert exc.value.status_code == 422
