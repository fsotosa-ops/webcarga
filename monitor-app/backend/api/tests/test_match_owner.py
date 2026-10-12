"""match_owner: de quién es un archivo cuando el documento ya se sabe
(Pendientes, carga en lote). Pura: sin base, con dueños armados a mano."""
from app.services.document_matcher import (
    OwnerCandidate, PendingOwner, classify_owner_match, match_owner, resolve_owner_collisions,
)

CORDILLERA = PendingOwner("r1", "CARRIER", "Transportes Cordillera SpA", "76222222-1", "Transportes Cordillera SpA")
ANDES = PendingOwner("r2", "CARRIER", "Transportes Andes Ltda", "76333333-7", "Transportes Andes Ltda")
ROJAS = PendingOwner("r4", "DRIVER", "Rojas Pérez, Andrés", "12222222-5", "Transportes Cordillera SpA")
TRACTO = PendingOwner("r5", "ASSET", "AAAA11", None, "Transportes Cordillera SpA")
# Dos conductores homónimos en empresas distintas (RUT con DV válido).
JUAN_A = PendingOwner("r6", "DRIVER", "Juan Pérez Soto", "11111111-1", "Transportes Cordillera SpA")
JUAN_B = PendingOwner("r7", "DRIVER", "Juan Pérez Soto", "22222222-2", "Transportes Andes Ltda")


def test_un_rut_valido_en_el_nombre_asigna_a_su_dueno():
    c = match_owner("F30-1 76.222.222-1 septiembre.pdf", [CORDILLERA, ANDES])
    assert (c[0].record_id, c[0].reason) == ("r1", "rut")
    assert classify_owner_match(c) == "matched"


def test_el_rut_de_un_conductor_asigna_al_conductor():
    c = match_owner("licencia 12222222-5.pdf", [ROJAS])
    assert (c[0].record_id, c[0].reason) == ("r4", "rut")


def test_la_patente_asigna_al_equipo():
    c = match_owner("revision tecnica AAAA11.pdf", [TRACTO])
    assert (c[0].record_id, c[0].reason) == ("r5", "plate")


def test_el_nombre_de_la_empresa_asigna_por_similitud():
    c = match_owner("f30-1 transportes cordillera spa.pdf", [CORDILLERA, ANDES])
    assert (c[0].record_id, c[0].reason) == ("r1", "name")
    assert classify_owner_match(c) == "matched"


def test_dos_homonimos_sin_rut_quedan_por_elegir():
    c = match_owner("licencia juan perez soto.pdf", [JUAN_A, JUAN_B])
    assert {x.record_id for x in c} == {"r6", "r7"}
    assert classify_owner_match(c) == "ambiguous"


def test_el_rut_desempata_entre_homonimos():
    c = match_owner("licencia juan perez soto 22222222-2.pdf", [JUAN_A, JUAN_B])
    assert (c[0].record_id, c[0].reason) == ("r7", "rut")
    assert classify_owner_match(c) == "matched"


def test_sin_rut_ni_nombre_reconocible_queda_sin_asignar():
    c = match_owner("scan_0042.pdf", [CORDILLERA, ANDES])
    assert c == [] and classify_owner_match(c) == "unmatched"


def test_un_rut_con_digito_verificador_invalido_no_asigna():
    assert match_owner("F30-1 76222222-9.pdf", [CORDILLERA]) == []


BBCL23 = PendingOwner("r8", "ASSET", "BBCL23", None, "Transportes Cordillera SpA")


def test_la_patente_con_guion_o_espacio_asigna_al_equipo():
    for nombre in ("revision tecnica BBCL-23.pdf", "revision tecnica BBCL 23.pdf", "rt_bbcl23.pdf"):
        c = match_owner(nombre, [BBCL23])
        assert c and (c[0].record_id, c[0].reason) == ("r8", "plate"), nombre


def test_la_patente_dentro_de_una_secuencia_mas_larga_no_asigna():
    assert match_owner("revision XBBCL234.pdf", [BBCL23]) == []
    assert match_owner("revision X-BBCL-234.pdf", [BBCL23]) == []


# ── Choque en el lote: dos archivos que van al mismo registro (P23, spec §6) ──

def test_en_un_choque_el_rut_gana_al_nombre_y_solo_baja_el_de_nombre():
    rut = OwnerCandidate("r1", 0.95, "rut")
    nombre = OwnerCandidate("r1", 0.72, "name")
    assert resolve_owner_collisions([rut, nombre, None]) == {1: "outranked"}


def test_en_un_choque_de_dos_rut_bajan_los_dos():
    a, b = OwnerCandidate("r1", 0.95, "rut"), OwnerCandidate("r1", 0.95, "rut")
    assert resolve_owner_collisions([a, b]) == {0: "tie", 1: "tie"}


def test_en_un_choque_por_nombre_gana_solo_si_supera_el_margen():
    alto, bajo = OwnerCandidate("r1", 0.90, "name"), OwnerCandidate("r1", 0.84, "name")
    assert resolve_owner_collisions([bajo, alto]) == {0: "outranked"}
    cerca = OwnerCandidate("r1", 0.87, "name")
    assert resolve_owner_collisions([cerca, alto]) == {0: "tie", 1: "tie"}


def test_rut_y_patente_valen_lo_mismo_en_un_choque():
    assert resolve_owner_collisions(
        [OwnerCandidate("r5", 0.95, "plate"), OwnerCandidate("r5", 0.95, "rut")]) == {0: "tie", 1: "tie"}


def test_archivos_a_registros_distintos_no_chocan():
    assert resolve_owner_collisions([OwnerCandidate("r1", 0.95, "rut"), OwnerCandidate("r2", 0.72, "name")]) == {}
