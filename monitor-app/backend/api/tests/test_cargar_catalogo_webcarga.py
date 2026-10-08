"""La carga del catálogo de WebCarga (HU-C1, entrega 2b, F6).

La traducción se prueba contra la PLANILLA REAL que mandó WebCarga
(monitor-app/bugs/20261006/Tabla_Resumen_General_IANSA.xlsx): un test contra
una planilla inventada no vería una fila que no encaja."""
from __future__ import annotations

from pathlib import Path

import pytest

from scripts.cargar_catalogo_webcarga import (
    COINCIDENCIAS_DUDOSAS,
    Coincidencia,
    Propuesta,
    leer_planilla,
    traducir,
)
from app.services.catalogo import codigo_desde_nombre

PLANILLA = Path(__file__).resolve().parents[3] / "bugs/20261006/Tabla_Resumen_General_IANSA.xlsx"
CODIGOS_EXISTENTES = {
    "CARRIER": {"ANEXO_REPLEG", "CARPETA_TRIBUTARIA", "CERT_MUTUAL", "CONTRATO_WEBCARGA",
                "COPIA_CI_REPLEGAL", "CUENTA_BANCARIA", "F30_MULTAS", "F30_1", "F43",
                "POLITICA_SEGURIDAD", "INSURANCE_POLICY", "PTS_CONTRATISTA", "REGLAMENTO_INTERNO",
                "ROLL_SII", "SEGURO_EETT", "SEGURO_RC_EMPRESA"},
    "DRIVER": {"ANEXO_GC_CONDUCTOR", "CAPACITACION_EPP", "CERT_ANTECEDENTES", "CONTRATO_TRABAJO",
               "CONTROL_MENSUAL_COL_T", "COPIA_CI_CONDUCTOR", "DAS_ODI", "ENTREGA_EPP",
               "HOJA_DE_VIDA", "LICENCIA_CONDUCIR", "PLAN_EMERGENCIA", "PTS_CONDUCTOR"},
    "ASSET": {"CERTIFICADO_GPS", "GASES_CONTAMINANTES", "MANTENCION_FRIO", "PADRON",
              "PERMISO_CIRCULACION", "POLIZA_RC", "RESOLUCION_SANITARIA", "REVISION_TECNICA",
              "SEGURO_CARGA", "SOAP"},
}


@pytest.fixture(scope="module")
def resultado():
    return [traducir(f) for f in leer_planilla(PLANILLA)]


def _propuestas(resultado):
    return [r for r in resultado if isinstance(r, Propuesta)]


def test_lee_las_96_filas(resultado):
    assert len(resultado) == 96


def test_cada_fila_queda_resuelta(resultado):
    """Nueva, coincide con una existente, o es una coincidencia dudosa que no
    se crea para no duplicar. Ninguna queda sin decidir."""
    propuestas = _propuestas(resultado)
    coincidencias = [r for r in resultado if isinstance(r, Coincidencia)]
    assert len(propuestas) + len(coincidencias) == 96
    assert sum(c.dudosa for c in coincidencias) == len(COINCIDENCIAS_DUDOSAS) == 2


def test_ningun_codigo_choca(resultado):
    """Review Focus 5: ni entre los nuevos ni con el catálogo vivo."""
    codigos = [(p.cuerpo.target_entity, codigo_desde_nombre(p.cuerpo.name)) for p in _propuestas(resultado)]
    assert len(codigos) == len(set(codigos))
    for entidad, codigo in codigos:
        assert codigo not in CODIGOS_EXISTENTES[entidad], codigo
        # Un código es una llave para siempre: sin "_" colgando del corte a 60.
        assert not codigo.endswith("_"), codigo


def test_los_coincidentes_apuntan_a_codigos_que_existen(resultado):
    for r in resultado:
        if isinstance(r, Coincidencia):
            assert r.codigo in CODIGOS_EXISTENTES[r.entidad], r.codigo


@pytest.mark.parametrize("nombre,corte", [
    ("Certificado de deuda de Tesorería General de la República", 10),
    ("Nómina de trabajadores activos en el periodo", 5),
    ("Liquidación de sueldo mensual firmada o con transferencia electrónica", 10),
    ("Certificado de Pago de Cotizaciones Previsionales", 15),
])
def test_los_cortes_mensuales_son_los_de_la_planilla(resultado, nombre, corte):
    p = next(p for p in _propuestas(resultado) if p.cuerpo.name == nombre)
    v = p.cuerpo.vigencia
    assert (v.politica, v.cutoff_day, v.period_offset_months, v.frequency_months, v.warning_days) == (
        "CALENDAR_PERIOD", corte, 1, 1, 5)


def test_anual_y_bienal_son_plazos_desde_la_emision(resultado):
    p = next(p for p in _propuestas(resultado) if p.cuerpo.name == "Matriz de Riesgos IPER")
    assert (p.cuerpo.vigencia.politica, p.cuerpo.vigencia.validity_months) == ("ISSUE_PLUS_MONTHS", 12)
    p = next(p for p in _propuestas(resultado) if p.cuerpo.name.startswith("Acta de constitución del Comité"))
    assert p.cuerpo.vigencia.validity_months == 24


def test_cuando_se_carga_se_traduce(resultado):
    por_nombre = {p.cuerpo.name: p.cuerpo for p in _propuestas(resultado)}
    assert por_nombre["Finiquito del Trabajador"].exigible_on == "ON_ENTITY_END"
    assert por_nombre["Certificado de Pago de Cotizaciones Previsionales"].exigible_on == "MONTH_AFTER_START"
    assert por_nombre["Mapa de riesgos"].exigible_on == "ON_REQUEST"
    assert por_nombre["Certificado de vigencia de la sociedad"].exigible_on == "ON_ENTITY_START"


def test_las_especialidades_son_a_pedido_y_el_epp_lleva_su_especialidad(resultado):
    por_nombre = {p.cuerpo.name: p.cuerpo for p in _propuestas(resultado)}
    for nombre in ("Certificación de soldador (soldadura al arco, tig/mig)",
                   "Curso de esposas/bastón", "Licencia de conducir de operador D",
                   "Entrega de EPP específicos (trabajo en altura)",
                   "Entrega de EPP específicos (manipulación de alimentos)"):
        assert por_nombre[nombre].exigible_on == "ON_REQUEST", nombre
    # Lo general de un conductor sigue siendo al ingreso.
    assert por_nombre["Inducción planta seguridad"].exigible_on == "ON_ENTITY_START"


def test_todo_nace_apagado_y_obligatorio(resultado):
    for p in _propuestas(resultado):
        assert p.cuerpo.requirement_level == "LEGAL_MANDATORY"


def test_las_dudas_se_listan(resultado):
    dudas = [p.duda for p in _propuestas(resultado) if p.duda]
    assert any("Resolución jornada excepcional" in d for d in dudas)
    assert any("Cronograma" in d for d in dudas)


@pytest.mark.integracion
async def test_aplicar_crea_los_nuevos_apagados_y_sin_sembrar(conexion_revertida, resultado):
    """Contra la base, en una transacción revertida: entran los 75, apagados,
    con su regla si su tipo la pide, y no siembran un solo pendiente."""
    from scripts.cargar_catalogo_webcarga import aplicar

    antes = await conexion_revertida.fetchval("SELECT count(*) FROM public.compliance_records")
    creados = await aplicar(conexion_revertida, resultado)

    assert creados == len(_propuestas(resultado)) == 75
    codigos = [codigo_desde_nombre(p.cuerpo.name) for p in _propuestas(resultado)]
    filas = await conexion_revertida.fetch(
        """
        SELECT req.is_active, req.expiration_policy,
               EXISTS (SELECT 1 FROM public.compliance_requirement_rules r
                       WHERE r.requirement_id = req.id AND r.shipper_id IS NULL) AS tiene_regla
        FROM public.compliance_requirements req WHERE req.requirement_code = ANY($1::text[])
        """, codigos)
    assert len(filas) == 75
    assert not any(f["is_active"] for f in filas)
    assert all(f["tiene_regla"] for f in filas
               if f["expiration_policy"] in ("ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD"))
    assert await conexion_revertida.fetchval("SELECT count(*) FROM public.compliance_records") == antes
