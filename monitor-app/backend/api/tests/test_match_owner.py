"""El reconocedor único con el TIPO DECLARADO (Pendientes, carga en lote sobre un
documento). Eran los criterios de `match_owner`, que se fundió en `match_document`
(Entrega D, 15/10): las mismas reglas, ahora con una sola implementación. Puro: sin
base, con el universo armado a mano."""
from app.services.document_matcher import (
    Catalog, EntityUniverse, MatchCandidate, RequirementAlias, classify_match, match_document, reason_of,
    resolve_collisions,
)

F30 = RequirementAlias("req-f30", "CARRIER", "F30-1")
LICENCIA = RequirementAlias("req-lic", "DRIVER", "Licencia")
REVISION = RequirementAlias("req-rt", "ASSET", "Revisión técnica")

CORDILLERA = ("c1", "76222222-1", "Transportes Cordillera SpA")
ANDES = ("c2", "76333333-7", "Transportes Andes Ltda")
ROJAS = ("d4", "12222222-5", "Rojas Pérez, Andrés")
# Dos conductores homónimos (RUT con DV válido).
JUAN_A = ("d6", "11111111-1", "Juan Pérez Soto")
JUAN_B = ("d7", "22222222-2", "Juan Pérez Soto")
TRACTO = ("a5", "AAAA11")
BBCL23 = ("a8", "BBCL23")


def _match(file_name, declared, carriers=(), drivers=(), assets=()):
    return match_document(
        file_name=file_name, catalog=Catalog(), declared_requirement=declared,
        universe=EntityUniverse(carriers=list(carriers), drivers=list(drivers), assets=list(assets)),
    )


def _top(c):
    return (c[0].entity_id, reason_of(c[0]), c[0].requirement_id)


def test_un_rut_valido_en_el_nombre_asigna_a_su_dueno():
    c = _match("F30-1 76.222.222-1 septiembre.pdf", F30, carriers=[CORDILLERA, ANDES])
    assert _top(c) == ("c1", "rut", "req-f30")
    assert classify_match(c) == "AUTO"


def test_el_rut_de_un_conductor_asigna_al_conductor():
    assert _top(_match("licencia 12222222-5.pdf", LICENCIA, drivers=[ROJAS]))[:2] == ("d4", "rut")


def test_la_patente_asigna_al_equipo():
    assert _top(_match("revision tecnica AAAA11.pdf", REVISION, assets=[TRACTO]))[:2] == ("a5", "plate")


def test_el_nombre_de_la_empresa_asigna_por_similitud():
    c = _match("f30-1 transportes cordillera spa.pdf", F30, carriers=[CORDILLERA, ANDES])
    assert _top(c)[:2] == ("c1", "name")
    assert classify_match(c) in ("AUTO", "SUGGESTED")


def test_el_tipo_declarado_solo_propone_su_familia():
    # Una licencia es de un conductor: el RUT de la empresa en el nombre no la vuelve suya.
    assert _match("licencia 76222222-1.pdf", LICENCIA, carriers=[CORDILLERA]) == []


def test_dos_homonimos_sin_rut_quedan_por_elegir():
    c = _match("licencia juan perez soto.pdf", LICENCIA, drivers=[JUAN_A, JUAN_B])
    assert {x.entity_id for x in c} == {"d6", "d7"}
    assert classify_match(c) == "AMBIGUOUS"


def test_el_rut_desempata_entre_homonimos():
    c = _match("licencia juan perez soto 22222222-2.pdf", LICENCIA, drivers=[JUAN_A, JUAN_B])
    assert _top(c)[:2] == ("d7", "rut")
    assert classify_match(c) == "AUTO"


def test_sin_rut_ni_nombre_reconocible_queda_sin_asignar():
    c = _match("scan_0042.pdf", F30, carriers=[CORDILLERA, ANDES])
    assert c == [] and classify_match(c) == "UNMATCHED"


def test_un_rut_con_digito_verificador_invalido_no_asigna():
    assert _match("F30-1 76222222-9.pdf", F30, carriers=[CORDILLERA]) == []


def test_la_patente_con_guion_o_espacio_asigna_al_equipo():
    for nombre in ("revision tecnica BBCL-23.pdf", "revision tecnica BBCL 23.pdf", "rt_bbcl23.pdf"):
        c = _match(nombre, REVISION, assets=[BBCL23])
        assert c and _top(c)[:2] == ("a8", "plate"), nombre


def test_la_patente_dentro_de_una_secuencia_mas_larga_no_asigna():
    assert _match("revision XBBCL234.pdf", REVISION, assets=[BBCL23]) == []
    assert _match("revision X-BBCL-234.pdf", REVISION, assets=[BBCL23]) == []


# ── Choque en el lote: dos archivos que van al mismo registro (P23, spec §6) ──

def _c(entity_id, confidence, via):
    return MatchCandidate("CARRIER", entity_id, "req-f30", confidence, {"entity": {"via": via}, "type": {}})


def test_en_un_choque_el_rut_gana_al_nombre_y_solo_baja_el_de_nombre():
    assert resolve_collisions([_c("c1", 0.95, "RUT"), _c("c1", 0.72, "NOMBRE_FUZZY"), None]) == {1: "outranked"}


def test_en_un_choque_de_dos_rut_bajan_los_dos():
    assert resolve_collisions([_c("c1", 0.95, "RUT"), _c("c1", 0.95, "RUT")]) == {0: "tie", 1: "tie"}


def test_en_un_choque_por_nombre_gana_solo_si_supera_el_margen():
    alto, bajo = _c("c1", 0.90, "NOMBRE_FUZZY"), _c("c1", 0.84, "NOMBRE_FUZZY")
    assert resolve_collisions([bajo, alto]) == {0: "outranked"}
    cerca = _c("c1", 0.87, "NOMBRE_FUZZY")
    assert resolve_collisions([cerca, alto]) == {0: "tie", 1: "tie"}


def test_rut_y_patente_valen_lo_mismo_en_un_choque():
    assert resolve_collisions([_c("c1", 0.95, "PATENTE"), _c("c1", 0.95, "RUT")]) == {0: "tie", 1: "tie"}


def test_archivos_a_registros_distintos_no_chocan():
    assert resolve_collisions([_c("c1", 0.95, "RUT"), _c("c2", 0.72, "NOMBRE_FUZZY")]) == {}
