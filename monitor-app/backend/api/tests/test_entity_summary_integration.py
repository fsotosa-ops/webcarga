"""Resumen de empresa, conductor y equipo para la vista rápida del Cierre (minuta
09/10, ítem 21; HU 20261011/01). Una consulta por entidad, sin URLs firmadas, con
la regla de vencimiento de services/vencimientos.py."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.routers.assets import get_asset_summary
from app.routers.carriers import get_carrier_summary
from app.routers.drivers import get_driver_summary
from tests.conftest import PoolDeUnaConexion
from tests.d1_subjects import apply_fleet_facts

pytestmark = pytest.mark.integracion


@pytest.fixture(autouse=True)
async def _hechos_de_la_flota(conexion_revertida):
    """La vista rápida (D1, Task 6) lee app.carrier_of y app.active_fleet: hasta
    la Task 10 la migración no está aplicada."""
    await apply_fleet_facts(conexion_revertida)



async def two_requirements(conn, entity_type: str) -> list[uuid.UUID]:
    rows = await conn.fetch(
        """
        SELECT r.id FROM public.compliance_requirements r
        WHERE r.target_entity = $1 AND r.expiration_policy = 'REQUIRED'
          AND r.exigible_on = 'ON_ENTITY_START'
          AND NOT EXISTS (SELECT 1 FROM public.compliance_requirement_rules x WHERE x.requirement_id = r.id)
        ORDER BY r.name LIMIT 2
        """, entity_type)
    if len(rows) < 2:
        pytest.skip(f"el catálogo no tiene dos requisitos simples para {entity_type}")
    return [r["id"] for r in rows]


async def new_carrier(conn) -> uuid.UUID:
    return await conn.fetchval(
        "INSERT INTO public.carriers (business_name, tax_id, operational_status) "
        "VALUES ($1, $2, 'ACTIVE') RETURNING id",
        f"TEST-{uuid.uuid4().hex[:8]}", f"7{uuid.uuid4().int % 10_000_000:07d}-K")


async def new_driver(conn, carrier_id: uuid.UUID | None) -> uuid.UUID:
    driver_id = await conn.fetchval(
        "INSERT INTO public.drivers (full_name, operational_status) VALUES ($1, 'ACTIVE') RETURNING id",
        f"TEST CONDUCTOR {uuid.uuid4().hex[:6]}")
    if carrier_id:
        await conn.execute(
            "INSERT INTO public.driver_assignments (driver_id, carrier_id, status, start_date) "
            "VALUES ($1, $2, 'ACTIVE', current_date - 30)", driver_id, carrier_id)
    return driver_id


async def new_asset(conn, carrier_id: uuid.UUID) -> uuid.UUID:
    asset_id = await conn.fetchval(
        "INSERT INTO public.assets (license_plate, asset_type, operational_status) "
        "VALUES ($1, 'TRACTOCAMION', 'ACTIVE') RETURNING id", f"TT{uuid.uuid4().hex[:4].upper()}")
    await conn.execute(
        "INSERT INTO public.asset_assignments (asset_id, carrier_id, status, start_date) "
        "VALUES ($1, $2, 'ACTIVE', current_date - 30)", asset_id, carrier_id)
    return asset_id


async def add_document(conn, entity_id, entity_type: str, requirement_id, expires: date) -> None:
    """La siembra ya crea el registro del requisito (MISSING); se carga el documento."""
    await conn.execute(
        """
        INSERT INTO public.compliance_records
            (entity_id, entity_type, requirement_id, status, file_url, expiration_date, is_current)
        VALUES ($1, $2, $3, 'APPROVED_MANUAL', 'test/doc.pdf', $4, true)
        ON CONFLICT (entity_id, requirement_id) DO UPDATE
            SET status = 'APPROVED_MANUAL', file_url = 'test/doc.pdf',
                expiration_date = EXCLUDED.expiration_date, is_current = true
        """, entity_id, entity_type, requirement_id, expires)


async def test_driver_summary_counts_documents_and_lists_what_needs_attention(conexion_revertida):
    conn = conexion_revertida
    carrier = await new_carrier(conn)
    driver = await new_driver(conn, carrier)
    expired_req, ok_req = await two_requirements(conn, "DRIVER")
    await add_document(conn, driver, "DRIVER", expired_req, date.today() - timedelta(days=5))
    await add_document(conn, driver, "DRIVER", ok_req, date.today() + timedelta(days=400))

    summary = await get_driver_summary(driver, pool=PoolDeUnaConexion(conn), _=None)

    assert summary["carrier"]["id"] == str(carrier)
    docs = summary["documents"]
    assert docs["expired"] >= 1 and docs["ok"] >= 1
    assert docs["attention"][0]["state"] == "expired"
    assert docs["attention"][0]["due_on"] == date.today() - timedelta(days=5)
    assert len(docs["attention"]) <= 3


async def test_driver_without_contact_has_no_phone(conexion_revertida):
    conn = conexion_revertida
    driver = await new_driver(conn, await new_carrier(conn))
    summary = await get_driver_summary(driver, pool=PoolDeUnaConexion(conn), _=None)
    assert summary["phone"] is None


async def test_driver_phone_is_the_primary_active_contact(conexion_revertida):
    conn = conexion_revertida
    driver = await new_driver(conn, await new_carrier(conn))
    await conn.execute(
        "INSERT INTO public.contacts (entity_id, entity_type, contact_role, phone, is_primary, is_active) "
        "VALUES ($1, 'DRIVER', 'PRINCIPAL', '+56911111111', true, true)", driver)
    summary = await get_driver_summary(driver, pool=PoolDeUnaConexion(conn), _=None)
    assert summary["phone"] == "+56911111111"


async def test_driver_without_carrier(conexion_revertida):
    conn = conexion_revertida
    driver = await new_driver(conn, None)
    summary = await get_driver_summary(driver, pool=PoolDeUnaConexion(conn), _=None)
    assert summary["carrier"] is None


async def test_unknown_driver_is_404(conexion_revertida):
    with pytest.raises(HTTPException) as err:
        await get_driver_summary(uuid.uuid4(), pool=PoolDeUnaConexion(conexion_revertida), _=None)
    assert err.value.status_code == 404


async def test_asset_summary_has_carrier_and_usual_driver(conexion_revertida):
    conn = conexion_revertida
    carrier = await new_carrier(conn)
    asset = await new_asset(conn, carrier)
    driver = await new_driver(conn, carrier)
    await conn.execute(
        "INSERT INTO public.vehicle_driver_assignments (asset_id, driver_id, status, source, is_manual_override) "
        "VALUES ($1, $2, 'ACTIVE', 'manual', true)", asset, driver)

    summary = await get_asset_summary(asset, pool=PoolDeUnaConexion(conn), _=None)

    assert summary["carrier"]["id"] == str(carrier)
    assert summary["usual_driver"]["id"] == str(driver)
    assert set(summary["documents"]) >= {"ok", "expiring", "expired", "missing", "attention"}


async def test_carrier_summary_counts_active_fleet(conexion_revertida):
    conn = conexion_revertida
    carrier = await new_carrier(conn)
    await new_driver(conn, carrier)
    await new_driver(conn, carrier)
    await new_asset(conn, carrier)

    summary = await get_carrier_summary(carrier, pool=PoolDeUnaConexion(conn), _=None)

    assert (summary["active_drivers"], summary["active_assets"]) == (2, 1)
    assert summary["shippers"] == []
    assert summary["primary_contact"] is None


async def test_with_several_active_tractors_the_usual_one_is_the_latest(conexion_revertida):
    """Un conductor puede tener varios tractos activos (el índice único es por tracto):
    el habitual es el de la asignación más reciente, no uno cualquiera."""
    conn = conexion_revertida
    carrier = await new_carrier(conn)
    driver = await new_driver(conn, carrier)
    older, newer = await new_asset(conn, carrier), await new_asset(conn, carrier)
    for asset, start in ((older, date.today() - timedelta(days=90)), (newer, date.today() - timedelta(days=3))):
        await conn.execute(
            "INSERT INTO public.vehicle_driver_assignments "
            "(asset_id, driver_id, status, source, is_manual_override, start_date) "
            "VALUES ($1, $2, 'ACTIVE', 'manual', true, $3)", asset, driver, start)

    for _ in range(3):
        summary = await get_driver_summary(driver, pool=PoolDeUnaConexion(conn), _=None)
        assert summary["usual_tractor"]["id"] == str(newer)
