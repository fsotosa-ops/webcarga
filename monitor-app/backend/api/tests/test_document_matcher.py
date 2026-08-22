"""Tests del motor de match documento → entidad + requisito.

El motor es una función PURA: recibe el universo de entidades y el catálogo ya
cargados, y no toca ni la DB ni el storage. Eso es deliberado — permite testear
el comportamiento real con datos reales en vez de afirmar sobre mocks.

Los nombres de archivo usados acá son los REALES observados en producción
(compliance_records ya cargados + muestra de SharePoint), no inventados.
"""
from app.services.document_matcher import (
    Catalog,
    EntityUniverse,
    RequirementAlias,
    classify_match,
    match_document,
)


# ── Fixtures del universo (mínimas, se extienden por test) ──────────────────

CARRIER_LUMILIZ = ("c-lumiliz", "76989879-4", "Transporte Lumiliz Limitada")
DRIVER_ULLOA = ("d-ulloa", "16030949-0", "Abraham Ulloa")
ASSET_GLCD14 = ("a-glcd14", "GLCD14")


def _universe(carriers=(), drivers=(), assets=(), scope=None):
    return EntityUniverse(
        carriers=list(carriers), drivers=list(drivers), assets=list(assets),
        scope_carrier_id=scope,
    )


def _catalog(*aliases):
    return Catalog(aliases=[RequirementAlias(*a) for a in aliases])


# ── La empresa ya sabida ────────────────────────────────────────────────────
#
# LA RAMA QUE FALTABA, y la que explica por que el clasificador nunca produjo
# nada: las otras cuatro exigen una senal EN EL NOMBRE del archivo -- RUT de
# empresa, patente, RUT de conductor, o nombre de conductor. El scope de empresa
# solo LIMITABA el universo y nunca aportaba evidencia.
#
# Medido en produccion antes de esta rama: 67 archivos pasaron por la cola y
# NINGUNO produjo un solo candidato, porque ningun nombre traia RUT ni patente.


def test_la_empresa_declarada_resuelve_un_documento_sin_rut_en_el_nombre():
    """El caso real que no resolvia: `Carpeta_Tributaria_Regular.pdf`.

    No trae RUT ni patente, asi que las cuatro ramas viejas dan cero. Con la
    empresa declarada -- alguien entro a su bandeja o se la asigno -- la
    entidad ya no hay que deducirla, y el tipo sale del alias como siempre.
    """
    universo = _universe(carriers=[CARRIER_LUMILIZ], scope=CARRIER_LUMILIZ[0])
    catalogo = _catalog(("req-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100))

    resultado = match_document(
        file_name="Carpeta_Tributaria_Regular.pdf", catalog=catalogo, universe=universo,
    )

    assert len(resultado) == 1
    assert resultado[0].entity_type == "CARRIER"
    assert resultado[0].entity_id == "c-lumiliz"
    assert resultado[0].requirement_id == "req-carpeta"
    assert resultado[0].evidence["entity"]["via"] == "EMPRESA_DECLARADA"


def test_sin_empresa_declarada_ese_mismo_archivo_no_resuelve():
    """La contraprueba, y el estado de hoy en la bandeja global: sin declarar
    la empresa no hay a quien proponerselo, y proponer una de 39 seria
    inventar."""
    universo = _universe(carriers=[CARRIER_LUMILIZ])
    catalogo = _catalog(("req-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100))

    assert match_document(
        file_name="Carpeta_Tributaria_Regular.pdf", catalog=catalogo, universe=universo,
    ) == []


def test_la_empresa_declarada_no_alcanza_sin_un_alias_que_calce():
    """Saber de quien es no dice QUE es. Sin alias no hay candidato: proponer
    la empresa con `requirement_id=None` seria un match a medias que la
    pantalla tendria que volver a preguntar."""
    universo = _universe(carriers=[CARRIER_LUMILIZ], scope=CARRIER_LUMILIZ[0])
    catalogo = _catalog(("req-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100))

    assert match_document(
        file_name="escaneo (3).pdf", catalog=catalogo, universe=universo,
    ) == []


def test_la_empresa_declarada_no_propone_conductores_ni_vehiculos():
    """Saber la empresa NO dice cual de sus conductores es. La rama se limita a
    requisitos de empresa a proposito -- proponer un conductor porque es el
    unico del universo seria inventar."""
    universo = _universe(
        carriers=[CARRIER_LUMILIZ], drivers=[DRIVER_ULLOA], scope=CARRIER_LUMILIZ[0],
    )
    catalogo = _catalog(("req-lic", "DRIVER", "LICENCIA DE CONDUCIR", 100))

    assert match_document(
        file_name="Licencia_de_Conducir.pdf", catalog=catalogo, universe=universo,
    ) == []


# ── Identificador fuerte: RUT en el nombre del archivo ──────────────────────

def test_encuentra_empresa_por_rut_en_el_nombre_del_archivo():
    """El único caso real con RUT en el nombre, de los 24 ya cargados."""
    candidates = match_document(
        file_name="Carpeta_Tributaria_Regular_77094744-8 -_260603_161130.pdf",
        catalog=_catalog(("r-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100)),
        universe=_universe(carriers=[("c-rios", "77094744-8", "Comercializadora del Rio")]),
    )

    assert candidates, "esperaba al menos un candidato"
    top = candidates[0]
    assert top.entity_type == "CARRIER"
    assert top.entity_id == "c-rios"
    assert top.requirement_id == "r-carpeta"
    assert top.confidence >= 0.90
    assert top.evidence["entity"]["via"] == "RUT"


def test_ignora_numeros_largos_que_no_son_rut_valido():
    """'260603' y '161130' del mismo nombre no deben leerse como RUT.

    Sin la validación de DV por módulo 11, cualquier timestamp en el nombre
    produciría un match falso.
    """
    candidates = match_document(
        file_name="Carpeta_Tributaria_Regular_77094744-8 -_260603_161130.pdf",
        catalog=_catalog(("r-carpeta", "CARRIER", "CARPETA TRIBUTARIA", 100)),
        universe=_universe(carriers=[
            ("c-rios", "77094744-8", "Comercializadora del Rio"),
            ("c-falso", "26060-3", "Empresa Inexistente"),
        ]),
    )

    assert [c.entity_id for c in candidates] == ["c-rios"]


# ── Nombre de persona con typo: el caso dominante en SharePoint ─────────────

def test_encuentra_conductor_por_nombre_aunque_venga_con_typo():
    """'Abrhama Ulloa' es un typo real de 'Abraham Ulloa' en SharePoint."""
    candidates = match_document(
        file_name="TRABAJO SEGURO- Abrhama Ulloa.jpeg",
        catalog=_catalog(("r-pts", "DRIVER", "TRABAJO SEGURO", 80)),
        universe=_universe(drivers=[DRIVER_ULLOA]),
    )

    assert candidates, "esperaba al menos un candidato"
    top = candidates[0]
    assert top.entity_type == "DRIVER"
    assert top.entity_id == "d-ulloa"
    assert top.requirement_id == "r-pts"
    assert top.evidence["entity"]["via"] == "NOMBRE_FUZZY"
    # Alta para pre-llenar y que un humano confirme, pero por debajo del umbral
    # de auto-commit: un typo nunca debe aplicarse solo.
    assert 0.60 <= top.confidence < 0.90


def test_encuentra_conductor_por_rut_en_el_nombre_del_archivo():
    """El bug que tapa esta ronda: el RUT del conductor en el nombre lo
    sacaba del match difuso (el `continue` de la rama de nombre) y nada más
    abajo lo recogía. 'LICENCIA_<nombre>.pdf' daba AUTO; agregarle el RUT
    ('LICENCIA_<nombre>_<rut>.pdf') lo degradaba a UNMATCHED."""
    candidates = match_document(
        file_name="LICENCIA_Abraham_Ulloa_16030949-0.pdf",
        catalog=_catalog(("r-licencia", "DRIVER", "LICENCIA", 100)),
        universe=_universe(drivers=[DRIVER_ULLOA]),
    )

    assert candidates, "esperaba al menos un candidato"
    top = candidates[0]
    assert top.entity_type == "DRIVER"
    assert top.entity_id == "d-ulloa"
    assert top.requirement_id == "r-licencia"
    assert top.confidence >= 0.90
    assert top.evidence["entity"]["via"] == "RUT"
    assert classify_match(candidates) == "AUTO"


def test_alias_mas_especifico_le_gana_al_que_es_substring():
    """'EPP' está contenido en 'USO Y MANTENCION EPP'.

    Sin prioridad, el archivo de capacitación se cargaría como entrega de EPP.
    Ambos son requisitos reales y distintos del catálogo.
    """
    candidates = match_document(
        file_name="USO Y MANTENCION EPP- Abraham Ulloa.jpeg",
        catalog=_catalog(
            ("r-capacitacion", "DRIVER", "USO Y MANTENCION EPP", 100),
            ("r-entrega", "DRIVER", "EPP", 10),
        ),
        universe=_universe(drivers=[DRIVER_ULLOA]),
    )

    assert candidates[0].requirement_id == "r-capacitacion"


# ── Patente: diccionario cerrado, no reconocimiento ────────────────────────

def test_encuentra_vehiculo_por_patente_en_el_nombre():
    candidates = match_document(
        file_name="REVISION TECNICA GLCD14.pdf",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100)),
        universe=_universe(assets=[ASSET_GLCD14]),
    )

    assert candidates, "esperaba al menos un candidato"
    top = candidates[0]
    assert top.entity_type == "ASSET"
    assert top.entity_id == "a-glcd14"
    assert top.requirement_id == "r-rt"
    assert top.confidence >= 0.90
    assert top.evidence["entity"]["via"] == "PATENTE"


def test_no_inventa_vehiculo_para_una_patente_desconocida():
    """El match es contra un diccionario cerrado de patentes existentes."""
    candidates = match_document(
        file_name="REVISION TECNICA ZZZZ99.pdf",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100)),
        universe=_universe(assets=[ASSET_GLCD14]),
    )

    assert candidates == []


# ── Sin señal: nunca se descarta, queda para asignación manual ─────────────

def test_archivo_sin_ninguna_senal_no_produce_candidatos():
    """'WhatsApp Image ...' y 'IMG_4905.PNG' son masivos en los datos reales."""
    candidates = match_document(
        file_name="WhatsApp Image 2026-07-29 at 3.51.10 PM.jpeg",
        catalog=_catalog(("r-pts", "DRIVER", "TRABAJO SEGURO", 80)),
        universe=_universe(drivers=[DRIVER_ULLOA], assets=[ASSET_GLCD14]),
    )

    assert candidates == []


# ── Clasificación: qué se auto-aplica y qué pasa por revisión ───────────────

def test_un_identificador_fuerte_y_un_solo_candidato_se_auto_aplica():
    candidates = match_document(
        file_name="REVISION TECNICA GLCD14.pdf",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100)),
        universe=_universe(assets=[ASSET_GLCD14]),
    )

    assert classify_match(candidates) == "AUTO"


def test_sin_candidatos_queda_para_asignacion_manual():
    assert classify_match([]) == "UNMATCHED"


def test_un_typo_se_sugiere_pero_no_se_auto_aplica():
    candidates = match_document(
        file_name="TRABAJO SEGURO- Abrhama Ulloa.jpeg",
        catalog=_catalog(("r-pts", "DRIVER", "TRABAJO SEGURO", 80)),
        universe=_universe(drivers=[DRIVER_ULLOA]),
    )

    assert classify_match(candidates) == "SUGGESTED"


def test_dos_personas_con_el_mismo_nombre_de_pila_quedan_ambiguas():
    """'ANEXO 3 Felipe.jpeg' es un archivo real: solo trae el nombre de pila."""
    candidates = match_document(
        file_name="ANEXO 3 Felipe.jpeg",
        catalog=_catalog(("r-anexo", "DRIVER", "ANEXO 3", 80)),
        universe=_universe(drivers=[
            ("d-felipe-soto", "16393523-6", "Felipe"),
            ("d-felipe-rojas", "11111111-1", "Felipe"),
        ]),
    )

    assert len(candidates) == 2
    assert classify_match(candidates) == "AMBIGUOUS"


# ── Manifiesto: determinístico y única fuente de la fecha de vencimiento ────

def test_el_manifiesto_manda_sobre_el_nombre_del_archivo():
    """Si el operador declaró a quién pertenece el archivo, eso gana.

    Es el caso que rescata a los 'IMG_4905.PNG': el nombre no dice nada, pero
    la planilla sí.
    """
    candidates = match_document(
        file_name="IMG_4905.PNG",
        catalog=_catalog(("r-rt", "ASSET", "REVISION TECNICA", 100, "REVISION_TECNICA")),
        universe=_universe(assets=[ASSET_GLCD14]),
        manifest_row={"identificador": "GLCD14", "requirement_code": "REVISION_TECNICA"},
    )

    assert candidates, "el manifiesto debería resolver un archivo sin señal"
    top = candidates[0]
    assert top.entity_type == "ASSET"
    assert top.entity_id == "a-glcd14"
    assert top.requirement_id == "r-rt"
    assert top.confidence == 1.0
    assert top.evidence["entity"]["via"] == "MANIFEST"
    assert classify_match(candidates) == "AUTO"
