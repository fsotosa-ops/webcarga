"""Identidad de RUT y patente (D1 §7.2): una sola forma en Python, igual a la
de la base (20260817120000_identidad_canonica.sql). La paridad caso por caso
contra Postgres está en test_identity_integration.py."""
import pytest

from app.services.document_matcher import (
    Catalog, EntityUniverse, RequirementAlias, extract_ruts, match_document, reason_of,
)
from app.utils.identity import canonical_plate, canonical_rut, plate_in_tokens

# (entrada, esperado): los mismos casos los resuelve Postgres en el test de paridad.
RUT_CASES = [
    ("12.345.678-5", "12345678-5"), ("12345678-5", "12345678-5"), ("12345678 5", "12345678-5"),
    (" 12.345.678 - 5 ", "12345678-5"), ("RUT: 12.345.678-5", "12345678-5"), ("12345678--5", "12345678-5"),
    ("10.000.013-k", "10000013-K"), ("10000013K", "10000013-K"), ("1.000.005-k", "1000005-K"),
    ("10.000.004-0", "10000004-0"), ("7.654.321-6", "7654321-6"), ("01000005K", "01000005-K"),
    ("12345678-0", None),      # DV inválido
    ("12345678-K", None),      # DV inválido con K
    ("K2345678-5", None),      # la K solo puede ser DV
    ("1234567k", None), ("123", None), ("", None), (None, None), ("0012345678-5", None),
]
PLATE_CASES = [
    ("ab-cd12", "ABCD12"), ("AB CD 12", "ABCD12"), ("abcd12", "ABCD12"), ("GBVC90\t", "GBVC90"),
    ("DT·BY52", "DTBY52"), ("ABC12", None), ("ABCD123", None), ("ñbcd12", None), ("", None), (None, None),
]


@pytest.mark.parametrize("raw, esperado", RUT_CASES)
def test_canonical_rut(raw, esperado):
    assert canonical_rut(raw) == esperado


@pytest.mark.parametrize("raw, esperado", PLATE_CASES)
def test_canonical_plate(raw, esperado):
    assert canonical_plate(raw) == esperado


def test_extract_ruts_devuelve_la_forma_canonica():
    assert extract_ruts("F30 10.000.013-k septiembre.pdf") == ["10000013-K"]
    # Con puntos y 5 dígitos de cuerpo no es un RUT para la base: tampoco aquí.
    assert extract_ruts("acta 12.345-6.pdf") == []


def test_plate_in_tokens_con_guion_o_espacio():
    assert plate_in_tokens("GLCD14", "REVISION TECNICA GLCD 14".split())
    assert plate_in_tokens("GLCD-14", ["RT", "GLCD14"])
    assert not plate_in_tokens("GLCD14", ["XGLCD145"])


def _catalog(*aliases):
    return Catalog(aliases=[RequirementAlias(*a) for a in aliases])


def test_match_document_encuentra_la_empresa_con_rut_guardado_con_puntos():
    """Review Focus 5: carriers.tax_id no es canónico por construcción (no tiene
    CHECK ni trigger, a diferencia de drivers)."""
    cands = match_document(
        file_name="Carpeta_Tributaria 10000013-K.pdf",
        catalog=_catalog(("r-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100)),
        universe=EntityUniverse(carriers=[("c1", "10.000.013-K", "ZZ Empresa")]))
    assert [(c.entity_id, c.evidence["entity"]["via"]) for c in cands] == [("c1", "RUT")]


def test_match_document_reconoce_la_patente_con_guion():
    cands = match_document(
        file_name="REVISION TECNICA GLCD-14.pdf",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100)),
        universe=EntityUniverse(assets=[("a1", "GLCD14")]))
    assert [c.entity_id for c in cands] == ["a1"]


def test_el_manifiesto_compara_el_rut_en_forma_canonica():
    cands = match_document(
        file_name="sin_senal.pdf",
        catalog=_catalog(("r-f30", "CARRIER", "F30", 100)),
        universe=EntityUniverse(carriers=[("c1", "10.000.013-K", "ZZ Empresa")]),
        manifest_row={"identificador": "10000013k", "requirement_code": ""})
    assert [c.entity_id for c in cands] == ["c1"]


def test_con_el_tipo_declarado_el_rut_del_dueno_no_canonico_igual_calza():
    c = match_document(file_name="f30 10000013k.pdf", catalog=Catalog(),
                       universe=EntityUniverse(carriers=[("c1", "10.000.013-K", "ZZ Empresa")]),
                       declared_requirement=RequirementAlias("r-f30", "CARRIER", "F30"))
    assert (c[0].entity_id, reason_of(c[0])) == ("c1", "rut")
