"""Tests de `services/centralizer_diff.py` — pool mockeado con AsyncMock,
mismo patrón que `tests/test_transporters_relational.py` (pool.fetch con
`return_value`/`side_effect` en el orden exacto en que el código bajo test
llama a `pool.fetch`).
"""
import pytest

from app.services.centralizer_diff import compute_diff

TID = "aaaaaaaa-0000-0000-0000-000000000001"
DID = "bbbbbbbb-0000-0000-0000-000000000002"
VID = "cccccccc-0000-0000-0000-000000000003"


def _empty_parsed(**overrides):
    base = {"transporters": [], "drivers": [], "vehicles": [], "sheet_summary": {}, "parse_errors": []}
    base.update(overrides)
    return base


def _transporter_row(**overrides):
    row = {
        "documents": {}, "rut": "99999999", "dv": "9", "rut_dv_valid": True,
        "business_name": "Transportes Prueba Uno SPA",
        "avance_80_20": 80.0, "avance_total": 75.0, "clients": [],
    }
    row.update(overrides)
    return row


class FakePool:
    """AsyncMock no alcanza sola porque necesitamos que pool.fetch devuelva
    una secuencia distinta según la query — se usa side_effect en el orden
    de llamada, igual que el resto de la suite (test_transporters_relational.py)."""


# ── Transporters: los 4 casos base del brief ────────────────────────

@pytest.mark.asyncio
async def test_transporter_new_row_no_match():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    pool.fetch.return_value = []  # sin match por rut ni admin_internal_id

    parsed = _empty_parsed(transporters=[_transporter_row(rut="99999001")])
    result = await compute_diff(pool, parsed)

    assert len(result["transporters"]) == 1
    d = result["transporters"][0]
    assert d["change_type"] == "new"
    assert d["existing_id"] is None
    assert d["match_method"] is None
    assert d["entity_key"] == "99999001"


@pytest.mark.asyncio
async def test_transporter_matches_rut_identical_data_is_unchanged():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing = {
        "id": TID, "business_name": "Transportes Prueba Uno SPA", "rut": "99999002",
        "dv": "9", "account_stage": "Operational", "admin_internal_id": None,
        "manually_edited_fields": [], "baja_override": False,
    }
    pool.fetch.side_effect = [[existing], []]  # existing rows, then transporter_documents

    parsed = _empty_parsed(transporters=[_transporter_row(rut="99999002")])
    result = await compute_diff(pool, parsed)

    d = result["transporters"][0]
    assert d["change_type"] == "unchanged"
    assert d["match_method"] == "rut"
    assert d["existing_id"] == TID
    assert d["field_diffs"] == []
    assert d["conflict_reason"] is None


@pytest.mark.asyncio
async def test_transporter_matches_with_one_field_different_is_updated():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing = {
        "id": TID, "business_name": "Nombre Viejo SPA", "rut": "99999003",
        "dv": "9", "account_stage": "Operational", "admin_internal_id": None,
        "manually_edited_fields": [], "baja_override": False,
    }
    pool.fetch.side_effect = [[existing], []]

    parsed = _empty_parsed(transporters=[_transporter_row(
        rut="99999003", business_name="Nombre Nuevo SPA",
    )])
    result = await compute_diff(pool, parsed)

    d = result["transporters"][0]
    assert d["change_type"] == "updated"
    assert d["conflict_reason"] is None
    assert d["field_diffs"] == [{
        "field": "business_name", "old": "Nombre Viejo SPA",
        "new": "Nombre Nuevo SPA", "conflict": False,
    }]


@pytest.mark.asyncio
async def test_transporter_manually_edited_field_touched_is_conflict():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing = {
        "id": TID, "business_name": "Nombre Editado A Mano SPA", "rut": "99999004",
        "dv": "9", "account_stage": "Operational", "admin_internal_id": None,
        "manually_edited_fields": ["business_name"], "baja_override": False,
    }
    pool.fetch.side_effect = [[existing], []]

    parsed = _empty_parsed(transporters=[_transporter_row(
        rut="99999004", business_name="Nombre Del Excel SPA",
    )])
    result = await compute_diff(pool, parsed)

    d = result["transporters"][0]
    assert d["change_type"] == "conflict"
    assert d["conflict_reason"] == "manually_edited_field"
    assert d["field_diffs"][0]["conflict"] is True


@pytest.mark.asyncio
async def test_transporter_document_conflict_with_baja_override_active():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing = {
        "id": TID, "business_name": "Transportes Prueba Uno SPA", "rut": "99999005",
        "dv": "9", "account_stage": "Operational", "admin_internal_id": None,
        "manually_edited_fields": [], "baja_override": True,
    }
    doc_rows = [{"transporter_id": TID, "doc_name": "rol_sii", "status": "pendiente", "manual_override": False}]
    pool.fetch.side_effect = [[existing], doc_rows]

    parsed = _empty_parsed(transporters=[_transporter_row(
        rut="99999005", documents={"rol_sii": "ok"},
    )])
    result = await compute_diff(pool, parsed)

    d = result["transporters"][0]
    assert d["change_type"] == "conflict"
    assert d["conflict_reason"] == "baja_override_active"


@pytest.mark.asyncio
async def test_transporter_matches_by_admin_internal_id_fallback():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing = {
        "id": TID, "business_name": "Transportes Legado SPA", "rut": "88888888",
        "dv": "8", "account_stage": "Operational", "admin_internal_id": 4242,
        "manually_edited_fields": [], "baja_override": False,
    }
    # No matchea por rut (rut nuevo distinto), sí por admin_internal_id
    pool.fetch.side_effect = [[existing], []]

    parsed = _empty_parsed(transporters=[_transporter_row(
        rut="99999006", admin_internal_id=4242,
    )])
    result = await compute_diff(pool, parsed)

    d = result["transporters"][0]
    assert d["match_method"] == "legacy_id"
    assert d["existing_id"] == TID


# ── Drivers/Vehicles: huérfanos y diff normal ───────────────────────

@pytest.mark.asyncio
async def test_driver_orphan_transporter_rut_no_match_goes_to_parse_errors():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    # rut no está en la hoja Empresas de este upload NI existe ya en la base
    # (lookup de preexistentes devuelve vacío) -> huérfano real.
    pool.fetch.return_value = []

    parsed = _empty_parsed(
        transporters=[],  # hoja Empresas vacía / sin match
        drivers=[{
            "documents": {}, "rut": "11111111", "dv": "1", "rut_dv_valid": True,
            "transporter_rut": "99999999", "full_name": "Juan Pérez",
            "id_expiry": None, "license_expiry": None, "avance_total": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    assert result["drivers"] == []
    assert len(result["parse_errors"]) == 1
    assert result["parse_errors"][0]["sheet"] == "Conductores"
    assert result["parse_errors"][0]["identifier"] == "11111111"


@pytest.mark.asyncio
async def test_driver_matches_preexisting_transporter_not_in_this_upload():
    """Upload parcial: el conductor referencia una empresa que ya existe en
    la base (`app.transporters`) pero que la hoja Empresas de ESTE archivo
    no trae — no debe quedar huérfano, y `transporter_id_by_rut` debe traer
    el id resuelto para que el apply pueda fijar el FK del conductor."""
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [{"rut": "99999999", "id": TID}],  # lookup de preexistentes por rut
        [],  # drivers existentes: el conductor es nuevo
    ]

    parsed = _empty_parsed(
        transporters=[],  # la empresa NO viene en este archivo
        drivers=[{
            "documents": {}, "rut": "11111111", "dv": "1", "rut_dv_valid": True,
            "transporter_rut": "99999999", "full_name": "Juan Pérez",
            "id_expiry": None, "license_expiry": None, "avance_total": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    assert result["parse_errors"] == []
    assert len(result["drivers"]) == 1
    assert result["drivers"][0]["change_type"] == "new"
    assert result["transporter_id_by_rut"] == {"99999999": TID}


@pytest.mark.asyncio
async def test_driver_matches_and_diffs_full_name():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing_driver = {
        "id": DID, "rut": "22222222", "dv": "2", "full_name": "Nombre Viejo",
        "id_expiry": None, "license_expiry": None, "avance_total": None,
        "manually_edited_fields": [], "baja_override": False, "transporter_id": TID,
    }
    pool.fetch.side_effect = [
        [],  # transporters existing (no match, es una empresa "new")
        [existing_driver],  # drivers existing
        [],  # driver_documents
    ]

    parsed = _empty_parsed(
        transporters=[_transporter_row(rut="99999999")],
        drivers=[{
            "documents": {}, "rut": "22222222", "dv": "2", "rut_dv_valid": True,
            "transporter_rut": "99999999", "full_name": "Nombre Nuevo",
            "id_expiry": None, "license_expiry": None, "avance_total": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    assert result["parse_errors"] == []
    d = result["drivers"][0]
    assert d["change_type"] == "updated"
    assert d["match_method"] == "rut"
    assert d["existing_id"] == DID
    assert {"field": "full_name", "old": "Nombre Viejo", "new": "Nombre Nuevo", "conflict": False} in d["field_diffs"]


@pytest.mark.asyncio
async def test_driver_new_company_in_same_batch_resolves_without_db_row():
    """Un conductor de una empresa NUEVA (no existe todavía en la DB) debe
    poder resolver su asignación contra la fila de Empresas del mismo
    upload, sin quedar huérfano."""
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    pool.fetch.side_effect = [
        [],  # transporters existing: la empresa es nueva, sin match
        [],  # drivers existing: el conductor también es nuevo
    ]

    parsed = _empty_parsed(
        transporters=[_transporter_row(rut="99999010")],
        drivers=[{
            "documents": {}, "rut": "33333333", "dv": "3", "rut_dv_valid": True,
            "transporter_rut": "99999010", "full_name": "Conductor Nuevo",
            "id_expiry": None, "license_expiry": None, "avance_total": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    assert result["parse_errors"] == []
    assert len(result["drivers"]) == 1
    assert result["drivers"][0]["change_type"] == "new"


@pytest.mark.asyncio
async def test_vehicle_matches_by_plate_and_diffs_year():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    existing_vehicle = {
        "id": VID, "plate": "ABCD12", "kind": "tracto", "type_label": "TRACTOCAMION",
        "year": 2018, "circ_permit_expiry": None, "tech_inspection_expiry": None,
        "gas_emissions_expiry": None, "soap_insurance_expiry": None,
        "manually_edited_fields": [], "baja_override": False, "transporter_id": TID,
    }
    pool.fetch.side_effect = [
        [],  # transporters existing
        [existing_vehicle],  # vehicles existing
        [],  # vehicle_documents
    ]

    parsed = _empty_parsed(
        transporters=[_transporter_row(rut="99999011")],
        vehicles=[{
            "documents": {}, "transporter_rut": "99999011", "kind": "tracto",
            "type_label": "TRACTOCAMION", "plate": "ABCD12", "year": 2024,
            "circ_permit_expiry": None, "tech_inspection_expiry": None,
            "gas_emissions_expiry": None, "soap_insurance_expiry": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    d = result["vehicles"][0]
    assert d["change_type"] == "updated"
    assert d["match_method"] == "plate"
    assert d["entity_key"] == "ABCD12"
    assert {"field": "year", "old": 2018, "new": 2024, "conflict": False} in d["field_diffs"]


@pytest.mark.asyncio
async def test_vehicle_orphan_no_transporter_match():
    from unittest.mock import AsyncMock
    pool = AsyncMock()
    pool.fetch.return_value = []  # lookup de preexistentes: tampoco existe ya

    parsed = _empty_parsed(
        transporters=[],
        vehicles=[{
            "documents": {}, "transporter_rut": "77777777", "kind": "rampla",
            "type_label": "RAMPLA", "plate": "ZZZZ99", "year": 2020,
            "circ_permit_expiry": None, "tech_inspection_expiry": None,
            "gas_emissions_expiry": None, "soap_insurance_expiry": None,
        }],
    )
    result = await compute_diff(pool, parsed)

    assert result["vehicles"] == []
    assert len(result["parse_errors"]) == 1
    assert result["parse_errors"][0]["sheet"] == "Vehiculos_Equipos"
    assert result["parse_errors"][0]["identifier"] == "ZZZZ99"
