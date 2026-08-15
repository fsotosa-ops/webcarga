from unittest.mock import AsyncMock, MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import get_current_user, get_supabase, require_editor
from app.db import get_pool
from app.routers.assets import router
from tests.conftest import USER, wire_transactional_conn


def make_client(pool, supabase=None):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_pool] = lambda: pool
    app.dependency_overrides[get_current_user] = lambda: USER
    app.dependency_overrides[require_editor] = lambda: USER
    app.dependency_overrides[get_supabase] = lambda: supabase or MagicMock()
    return TestClient(app)


def test_get_asset_404_when_missing():
    pool = AsyncMock()
    pool.fetchrow.return_value = None
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 404


def test_create_asset_rejects_duplicate_plate():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = "existing"
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "TRACTOCAMION"})

    assert res.status_code == 409


def test_create_asset_uppercases_plate_and_succeeds():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None, "created_at": None,
    }
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "abcd12", "asset_type": "TRACTOCAMION"})

    assert res.status_code == 201
    insert_args = conn.fetchrow.call_args.args
    assert insert_args[1] == "ABCD12"


def test_create_asset_rejects_unknown_type():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "BICICLETA"})

    assert res.status_code == 422


def test_patch_asset_no_fields_422():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None}
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={})

    assert res.status_code == 422


def test_patch_asset_updates_manufacture_year():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {"asset_type": "TRACTOCAMION", "operational_status": "ACTIVE", "manufacture_year": None}
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
        "manufacture_year": 2019, "is_manual_override": True, "created_at": None,
        "total_requirements": 3, "last_document_update": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={"manufacture_year": 2019})

    assert res.status_code == 200
    assert res.json()["manufacture_year"] == 2019
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "manufacture_year = COALESCE($4, manufacture_year)" in update_sql


def test_create_asset_rejects_out_of_range_year():
    pool = AsyncMock()
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": "TRACTOCAMION", "manufacture_year": 1800})

    assert res.status_code == 422


def test_list_asset_compliance_records():
    pool = AsyncMock()
    pool.fetch.return_value = [{
        "id": "cr1", "requirement_id": "req1", "requirement_code": "PADRON", "name": "Padrón",
        "requirement_level": "LEGAL_MANDATORY", "requires_file": True, "status": "MISSING",
        "expiration_date": None, "file_url": None, "metadata": {}, "is_manual_override": False,
        "is_expired": False, "is_expiring_soon": False,
    }]
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1/compliance-records")

    assert res.status_code == 200
    assert res.json()[0]["requirement_code"] == "PADRON"
    sql = pool.fetch.call_args.args[0]
    assert "entity_type = 'ASSET'" in sql


def test_asset_detail_carries_its_carrier():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "HKXW55", "asset_type": "TRACTO",
        "operational_status": "ACTIVE", "manufacture_year": 2020,
        "is_manual_override": False, "created_at": None,
        "fleet_service_type_id": None, "fleet_service_type_label": None,
        "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None,
        "total_requirements": 10, "last_document_update": None,
        "carrier_id": "c1", "carrier_name": "Transportes Sur Spa",
    }
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 200
    assert res.json()["carrier_name"] == "Transportes Sur Spa"
    assert "asset_assignments" in pool.fetchrow.call_args.args[0]


def test_asset_detail_without_active_assignment():
    pool = AsyncMock()
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "SINASIG", "asset_type": None,
        "operational_status": "ACTIVE", "manufacture_year": None,
        "is_manual_override": False, "created_at": None,
        "fleet_service_type_id": None, "fleet_service_type_label": None,
        "fleet_service_type_bg_color": None, "fleet_service_type_text_color": None,
        "total_requirements": 0, "last_document_update": None,
        "carrier_id": None, "carrier_name": None,
    }
    client = make_client(pool)

    res = client.get("/api/v1/assets/a1")

    assert res.status_code == 200
    assert res.json()["carrier_id"] is None


# ── Tramo 2, Tarea 10: la app toma propiedad de la clasificacion ───────────
#
# Hasta ahora fleet_service_type_id y webcarga_operation_type_id salian SOLO de
# la ingesta de Mage: un vehiculo creado en la app nacia sin clasificar y se
# quedaba asi hasta que Mage lo alcanzara. Verificado contra produccion que la
# ingesta respeta is_manual_override (HKXW55 esta en bronze, tiene el flag, y
# es el unico sin clasificar de 120), asi que la app puede declarar la
# clasificacion sin que se la pisen.

def test_create_asset_accepts_its_classification():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None, "created_at": None,
        "fleet_service_type_id": "t1", "webcarga_operation_type_id": "t2",
        "is_manual_override": True,
    }
    client = make_client(pool)

    res = client.post("/api/v1/assets", json={
        "license_plate": "abcd12", "asset_type": "TRACTOCAMION",
        "fleet_service_type_id": "t1", "webcarga_operation_type_id": "t2",
    })

    assert res.status_code == 201
    insert_sql = conn.fetchrow.call_args.args[0]
    assert "fleet_service_type_id" in insert_sql
    assert "webcarga_operation_type_id" in insert_sql


def test_create_asset_with_classification_protects_it_from_the_ingestion():
    """Lo que declara una persona no lo pisa Mage. Es la misma convencion que
    usa el resto del esquema, no una regla nueva."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None, "created_at": None,
        "fleet_service_type_id": "t1", "webcarga_operation_type_id": None,
        "is_manual_override": True,
    }
    client = make_client(pool)

    client.post("/api/v1/assets", json={
        "license_plate": "abcd12", "asset_type": "TRACTOCAMION",
        "fleet_service_type_id": "t1",
    })

    assert conn.fetchrow.call_args.args[5] is True   # is_manual_override


def test_create_asset_without_classification_leaves_it_to_the_ingestion():
    """El flag protege lo que declaro una persona, NADA mas. Marcarlo siempre
    dejaria a Mage sin poder clasificar los vehiculos que nadie clasifico."""
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchval.return_value = None
    conn.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None, "created_at": None,
        "fleet_service_type_id": None, "webcarga_operation_type_id": None,
        "is_manual_override": False,
    }
    client = make_client(pool)

    client.post("/api/v1/assets", json={"license_plate": "abcd12", "asset_type": "TRACTOCAMION"})

    assert conn.fetchrow.call_args.args[5] is False


def test_patch_asset_can_reclassify():
    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
        "manufacture_year": None, "fleet_service_type_id": None,
        "webcarga_operation_type_id": None,
    }
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None,
        "is_manual_override": True, "created_at": None,
        "total_requirements": 3, "last_document_update": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={"webcarga_operation_type_id": "t2"})

    assert res.status_code == 200
    # La columna nueva TIENE que venir en el SELECT previo: el bucle de
    # auditoria lee current[field] por cada campo tocado.
    select_sql = conn.fetchrow.call_args_list[0].args[0]
    assert "webcarga_operation_type_id" in select_sql
    update_sql = conn.execute.call_args_list[0].args[0]
    assert "webcarga_operation_type_id" in update_sql


def test_create_asset_rejects_the_retired_placeholder_types():
    """CAMION/FURGON/OTRO se retiran del contrato ANTES de que la base los
    prohiba. El orden importa: con el CHECK puesto y el Literal intacto, un
    POST con CAMION pasaba Pydantic y reventaba contra Postgres con un 500.
    Un 422 prueba que la validacion corta antes de llegar a la base."""
    pool = AsyncMock()
    client = make_client(pool)

    for tipo in ("CAMION", "FURGON", "OTRO"):
        res = client.post("/api/v1/assets", json={"license_plate": "ABCD12", "asset_type": tipo})
        assert res.status_code == 422, f"{tipo} deberia dar 422 de Pydantic, no {res.status_code}"


def test_patch_asset_audits_uuid_columns_without_blowing_up():
    """REGRESION (revision de rama, 2026-08-15): las columnas de clasificacion
    son uuid, asi que asyncpg devuelve uuid.UUID y json.dumps reventaba con
    TypeError — la transaccion entera se caia con un 500. Todas las columnas
    auditadas hasta ahora eran text o int, por eso nunca habia pasado.
    Escenario real: 81 de 118 vehiculos YA tienen fleet_service_type_id, asi
    que reclasificar cualquiera de ellos fallaba."""
    import uuid as _uuid

    pool = AsyncMock()
    conn = AsyncMock()
    wire_transactional_conn(pool, conn)
    conn.fetchrow.return_value = {
        "asset_type": "TRACTOCAMION", "operational_status": "ACTIVE",
        "manufacture_year": None,
        "fleet_service_type_id": _uuid.uuid4(),          # ya clasificado
        "webcarga_operation_type_id": None,
    }
    pool.fetchrow.return_value = {
        "id": "a1", "license_plate": "ABCD12", "asset_type": "TRACTOCAMION",
        "operational_status": "ACTIVE", "manufacture_year": None,
        "is_manual_override": True, "created_at": None,
        "total_requirements": 3, "last_document_update": None,
    }
    client = make_client(pool)

    res = client.patch("/api/v1/assets/a1", json={
        "fleet_service_type_id": str(_uuid.uuid4()),
    })

    assert res.status_code == 200
