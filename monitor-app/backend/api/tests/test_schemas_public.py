import pytest
from pydantic import ValidationError

from app.schemas.carrier import CarrierCreateBody, CarrierPatchBody
from app.schemas.driver import DriverCreateBody
from app.schemas.asset import AssetCreateBody
from app.schemas.contact import ContactCreateBody
from app.schemas.compliance import ComplianceRecordPatchBody
from app.schemas.insurance import InsurancePolicyCreateBody


def test_carrier_create_normalizes_name_and_tax_id():
    body = CarrierCreateBody(tax_id=" 77123456-9 ", business_name="transportes acme spa")

    assert body.tax_id == "77123456-9"
    assert body.business_name == "Transportes Acme Spa"
    assert body.country_code == "CL"
    assert body.operational_status == "ACTIVE"


def test_carrier_create_rejects_invalid_operational_status():
    with pytest.raises(ValidationError):
        CarrierCreateBody(tax_id="1-9", business_name="X", operational_status="LIMBO")


def test_carrier_create_accepts_legacy_inactive():
    """Valor real verificado contra Supabase: 208/246 carriers están en
    LEGACY_INACTIVE, no 'INACTIVE' (ver schemas/carrier.py)."""
    body = CarrierCreateBody(tax_id="1-9", business_name="X", operational_status="LEGACY_INACTIVE")
    assert body.operational_status == "LEGACY_INACTIVE"


def test_carrier_patch_sent_fields_tracks_only_provided():
    patch = CarrierPatchBody(business_name="Nuevo Nombre")

    assert patch.sent_fields() == ["business_name"]
    assert CarrierPatchBody().sent_fields() == []


def test_carrier_create_accepts_management_types():
    """D7/D9: el tipo de gestión que se declara en el alta. Es un conjunto —
    marcar las dos ES el caso mixto, no hay un tercer valor 'AMBAS'."""
    body = CarrierCreateBody(
        tax_id="1-9", business_name="X", management_types=["TRACTOREO"],
    )
    assert body.management_types == ["TRACTOREO"]


def test_carrier_create_normalizes_management_types_order():
    """El CHECK de la base acepta cualquier orden, así que sin normalizar dos
    filas equivalentes no son iguales por `=`. Se ordena al escribir."""
    body = CarrierCreateBody(
        tax_id="1-9", business_name="X",
        management_types=["EQUIPO_COMPLETO", "TRACTOREO"],
    )
    assert body.management_types == ["TRACTOREO", "EQUIPO_COMPLETO"]


def test_carrier_create_management_types_empty_is_none():
    """NULL y [] no pueden significar los dos 'no declarado': la base rechaza
    el arreglo vacío, así que se normaliza antes de llegar."""
    body = CarrierCreateBody(tax_id="1-9", business_name="X", management_types=[])
    assert body.management_types is None


def test_carrier_create_management_types_dedupes():
    body = CarrierCreateBody(
        tax_id="1-9", business_name="X",
        management_types=["TRACTOREO", "TRACTOREO"],
    )
    assert body.management_types == ["TRACTOREO"]


def test_carrier_create_rejects_unknown_management_type():
    with pytest.raises(ValidationError):
        CarrierCreateBody(tax_id="1-9", business_name="X", management_types=["SIDER"])


def test_carrier_create_rejects_management_type_label():
    """Se guardan códigos, no las etiquetas del catálogo: esas se renombraron
    dos veces en dos días (20260803060000, 20260804000000)."""
    with pytest.raises(ValidationError):
        CarrierCreateBody(tax_id="1-9", business_name="X", management_types=["Tractoreo"])


def test_carrier_patch_sent_fields_includes_management_types():
    patch = CarrierPatchBody(management_types=["EQUIPO_COMPLETO"])
    assert patch.sent_fields() == ["management_types"]


def test_driver_create_normalizes_full_name():
    body = DriverCreateBody(tax_id="12345678-k", full_name="juan perez")

    assert body.full_name == "Juan Perez"
    assert body.tax_id == "12345678-K"


def test_asset_create_uppercases_plate():
    body = AssetCreateBody(license_plate="abcd12", asset_type="TRACTOCAMION")

    assert body.license_plate == "ABCD12"


def test_asset_create_rejects_unknown_type():
    with pytest.raises(ValidationError):
        AssetCreateBody(license_plate="ABCD12", asset_type="BICICLETA")


def test_contact_create_uppercases_role():
    body = ContactCreateBody(entity_id="c1", entity_type="CARRIER", contact_role="legal_rep")

    assert body.contact_role == "LEGAL_REP"


def test_contact_create_rejects_invalid_entity_type():
    with pytest.raises(ValidationError):
        ContactCreateBody(entity_id="c1", entity_type="SHIPPER", contact_role="LEGAL_REP")


def test_compliance_record_patch_accepts_known_status():
    body = ComplianceRecordPatchBody(status="APPROVED_MANUAL")
    assert body.status == "APPROVED_MANUAL"


def test_compliance_record_patch_rejects_unknown_status():
    with pytest.raises(ValidationError):
        ComplianceRecordPatchBody(status="NOT_A_REAL_STATUS")


def test_insurance_policy_create_defaults_alert_days():
    body = InsurancePolicyCreateBody(carrier_id="c1", insurance_company="HDI")
    assert body.expiration_alert_days == 30
