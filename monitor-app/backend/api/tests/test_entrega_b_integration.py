"""Entrega B (docs/superpowers/plans/2026-10-14-entrega-b-panel-documentos-d3.md): el panel único
de documentos, "Pedir a Certificación" y las correcciones del maestro. Criterios P1-P5 y D1-D5."""
from __future__ import annotations

import uuid
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.services import certification_requests as requests_svc
from app.services import identity_corrections as identity
from app.services.entity_documents import entity_documents
from app.services.entity_summary import document_summary
from tests import d1_subjects as s
from tests.conftest import _usuario_real

pytestmark = pytest.mark.integracion


def _supabase():
    sb = MagicMock()
    sb.storage.from_.return_value.create_signed_url.return_value = {"signedURL": "https://x"}
    return sb


async def _driver_with_documents(conn):
    """Un conductor con un documento al día, uno vencido y uno que falta."""
    carrier = await s.carrier(conn)
    driver = await s.driver(conn, carrier)
    await s.without_seeding(conn, driver)
    today = await s.today(conn)
    req_ok, req_overdue, req_missing = [await s.requirement(conn, entity="DRIVER") for _ in range(3)]
    await s.record(conn, req_ok, "DRIVER", driver, status="APPROVED", expires=today + timedelta(days=200))
    await s.record(conn, req_overdue, "DRIVER", driver, status="APPROVED", expires=today - timedelta(days=3))
    await s.record(conn, req_missing, "DRIVER", driver, status="MISSING")
    return driver, req_ok, req_overdue, req_missing


async def test_p1_p2_panel_rows_and_quick_view_use_the_same_state(conexion_revertida):
    conn = conexion_revertida
    driver, req_ok, req_overdue, req_missing = await _driver_with_documents(conn)

    panel = await entity_documents(conn, _supabase(), "DRIVER", driver)
    by_requirement = {str(r["requirement_id"]): r["document_state"] for r in panel["rows"]}
    assert by_requirement == {req_ok: "UP_TO_DATE", req_overdue: "OVERDUE", req_missing: "MISSING"}

    quick = await document_summary(conn, uuid.UUID(driver), "DRIVER")
    assert (quick["ok"], quick["expired"], quick["missing"], quick["expiring"]) == (
        panel["summary"]["up_to_date"], panel["summary"]["overdue"],
        panel["summary"]["missing"], panel["summary"]["expiring"]) == (1, 1, 1, 0)


async def test_p3_asking_twice_keeps_one_open_request(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    driver, _, req_overdue, _ = await _driver_with_documents(conn)

    first = await requests_svc.create(conn, entity_type="DRIVER", entity_id=driver, requirement_id=req_overdue,
                                      note=None, trip_id=None, closure_date=None, actor=actor)
    second = await requests_svc.create(conn, entity_type="DRIVER", entity_id=driver, requirement_id=req_overdue,
                                       note="otra vez", trip_id=None, closure_date=None, actor=actor)

    assert first["created"] and not second["created"] and first["id"] == second["id"]
    assert await conn.fetchval(
        "SELECT count(*) FROM app.certification_requests WHERE entity_id = $1 AND status = 'OPEN'", driver) == 1
    panel = await entity_documents(conn, _supabase(), "DRIVER", driver)
    assert [str(r["open_request_id"]) for r in panel["rows"] if str(r["requirement_id"]) == req_overdue] == [first["id"]]


async def test_p5_a_request_leaves_the_queue_when_the_document_is_up_to_date(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    driver, _, req_overdue, _ = await _driver_with_documents(conn)
    made = await requests_svc.create(conn, entity_type="DRIVER", entity_id=driver, requirement_id=req_overdue,
                                     note=None, trip_id=None, closure_date=None, actor=actor)
    assert made["id"] in {r["id"] for r in await requests_svc.list_open(conn)}

    today = await s.today(conn)
    await conn.execute(
        "UPDATE public.compliance_records SET expiration_date = $3 WHERE entity_id = $1 AND requirement_id = $2",
        driver, req_overdue, today + timedelta(days=300))

    assert made["id"] not in {r["id"] for r in await requests_svc.list_open(conn)}
    # Pedirlo de nuevo cierra el viejo y abre otro.
    again = await requests_svc.create(conn, entity_type="DRIVER", entity_id=driver, requirement_id=req_overdue,
                                      note=None, trip_id=None, closure_date=None, actor=actor)
    assert again["created"] and again["id"] != made["id"]


async def test_d1_d2_correcting_a_rut_needs_a_reason_audits_and_rejects_duplicates(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await s.carrier(conn)
    driver, other = await s.driver(conn, carrier), await s.driver(conn, carrier)
    base = 40_000_000 + uuid.uuid4().int % 1_000_000

    def rut(n: int) -> str:
        from app.utils.identity import rut_check_digit
        return f"{n}-{rut_check_digit(str(n))}"

    with pytest.raises(HTTPException) as no_reason:
        await identity.correct_driver_rut(conn, driver, rut(base), "  ", actor=actor)
    assert no_reason.value.status_code == 422

    assert await identity.correct_driver_rut(conn, driver, rut(base).replace("-", ""), "estaba mal tipeado",
                                             actor=actor) == rut(base)
    audit = await conn.fetchrow(
        "SELECT new_value FROM public.audit_log WHERE entity_id = $1 AND action = 'identity_correction' "
        "ORDER BY occurred_at DESC LIMIT 1", driver)
    assert "estaba mal tipeado" in audit["new_value"]

    with pytest.raises(HTTPException) as dup:
        await identity.correct_driver_rut(conn, other, rut(base), "otro motivo", actor=actor)
    assert dup.value.status_code == 409


async def test_d3_a_trip_with_the_old_plate_resolves_to_the_same_asset(conexion_revertida):
    conn = conexion_revertida
    actor = (await _usuario_real(conn))["sub"]
    carrier = await s.carrier(conn)
    asset = await s.asset(conn, carrier)
    old = await conn.fetchval("SELECT license_plate FROM public.assets WHERE id = $1", asset)
    new = f"ZZ{uuid.uuid4().hex[:4].upper()}"

    await identity.correct_asset_plate(conn, asset, new, "cambio de patente", actor=actor)

    trip = await conn.fetchval(
        "INSERT INTO app.trips (id, planning_date, source_system, source_system_trip_id, trip_status, is_active, "
        "is_assigned, fleet) VALUES (gen_random_uuid(), public.hoy_chile(), 'qanalytics', $1, 'RUTA', true, true, "
        "jsonb_build_object('tractor_plate', $2::text)) RETURNING id", f"ZZ-B-{uuid.uuid4().hex[:8]}", old)
    await conn.execute("SELECT app.resolve_trip_fleet(ARRAY[$1::uuid])", trip)

    assert str(await conn.fetchval(
        "SELECT tractor_asset_id FROM app.trip_fleet_links WHERE trip_id = $1", trip)) == asset


async def test_d4_the_carrier_rut_duplicate_is_checked_in_canonical_form(conexion_revertida):
    from app.routers.carriers import patch_carrier
    from app.schemas.carrier import CarrierPatchBody
    from tests.conftest import PoolDeUnaConexion

    conn = conexion_revertida
    user = await _usuario_real(conn)
    from app.utils.identity import rut_check_digit
    n = 70_000_000 + uuid.uuid4().int % 1_000_000
    canon = f"{n}-{rut_check_digit(str(n))}"
    first = await s.carrier(conn)
    await conn.execute("UPDATE public.carriers SET tax_id = $2 WHERE id = $1", first, canon)
    second = await s.carrier(conn)
    dotted = f"{n:,}".replace(",", ".") + "-" + rut_check_digit(str(n))

    with pytest.raises(HTTPException) as exc:
        await patch_carrier(second, CarrierPatchBody(tax_id=dotted), PoolDeUnaConexion(conn), _supabase(),
                            {**user, "permissions": ["directory.edit", "directory.read"]})
    assert exc.value.status_code == 409
