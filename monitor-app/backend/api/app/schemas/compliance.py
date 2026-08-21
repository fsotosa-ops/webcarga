"""Pydantic schemas para public.compliance_records (H2.2/H2.4 —
routers/compliance.py). Status y valores tomados del CHECK constraint real
de la tabla (init_compliance_engine.sql)."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel

from .common import ManagementType

ComplianceStatus = Literal[
    "MISSING", "PENDING_REVIEW", "APPROVED_MANUAL", "APPROVED",
    "REJECTED", "EXPIRED", "ARCHIVED",
]


class ComplianceRecordPatchBody(BaseModel):
    """Override manual de un compliance_record (ej. un admin aprueba a mano
    sin subir archivo). El upload de archivo real usa un endpoint separado
    (H2.4) que fuerza status='APPROVED_MANUAL', no este PATCH libre."""
    status: Optional[ComplianceStatus] = None
    expiration_date: Optional[date] = None


class ReassignBody(BaseModel):
    """Corrige un documento cargado en el lugar equivocado (HU-03).

    O bien se indica el destino —otro requisito, de la misma entidad o de
    otra— o bien `to_tray`, que lo devuelve a la bandeja de sin clasificar.
    El archivo NUNCA se copia ni se borra: viaja el mismo storage_path.
    """
    target_entity_type: Optional[Literal["CARRIER", "DRIVER", "ASSET"]] = None
    target_entity_id: Optional[str] = None
    target_requirement_id: Optional[str] = None
    to_tray: bool = False


class PendingComplianceRow(BaseModel):
    """Módulo Documentos (sábana) — un compliance_record pendiente por fila,
    con la empresa/sujeto ya resueltos. Ver GET /compliance-records/pending."""
    id: str
    carrier_id: str
    carrier_name: str
    carrier_tax_id: str
    carrier_operation_types: list[str]
    certification_type: Literal["BASICA", "ADICIONAL"]
    category: Literal["EMPRESA", "CHOFER", "EQUIPO"]
    entity_type: str
    entity_id: str
    subject_name: Optional[str] = None
    requirement_id: str
    requirement_code: str
    document_name: str
    status: ComplianceStatus
    expiration_date: Optional[date] = None
    # Si hay un archivo cargado. Es un HECHO (`file_url IS NOT NULL`), no una
    # lectura de `status`: la ficha de empresa decide con esto si ofrece
    # "Ver", y deducirlo del estado escondia el archivo de todo lo vencido.
    tiene_archivo: bool
    # Por que esta pendiente, o si no lo esta. Cuatro valores excluyentes que
    # el SQL ya resuelve: el frontend no vuelve a decidirlo comparando
    # fechas, que es como dos superficies del mismo dato terminan
    # discrepando. 'AL_DIA' se sumo en la ronda de arreglo 1 de la ficha de
    # empresa (Task 4): con estado='falta' (el default de siempre) esta rama
    # nunca se alcanzaba, asi que el valor no hacia falta; con
    # estado='todos' si, y sin el una fila cubierta salia 'FALTA' igual que
    # una que de verdad falta.
    urgencia: Literal["VENCIDO", "POR_VENCER", "FALTA", "AL_DIA"]
    # Que hace su requisito con la fecha de vencimiento. El renglon de carga lo
    # necesita para pedir la fecha ANTES de subir: sin el, o pregunta siempre,
    # o no pregunta nunca y /file rechaza con 422 el archivo ya subido.
    expiration_policy: Literal["REQUIRED", "OPTIONAL", "NONE"]


class PendingComplianceListResponse(BaseModel):
    total: int
    rows: list[PendingComplianceRow]


class ComplianceSummaryCounts(BaseModel):
    """La misma particion que `urgencia` ya resuelve por fila, sumada.

    `falta` agrupa las dos ramas VENCIDO y FALTA del CASE de `urgencia`: son
    "lo que falta" para la ficha (`avanceDelSujeto` en el frontend ya conto
    asi, sin nombrarlo aparte). `por_vencer` queda solo porque la ficha lo
    muestra en su propio casillero. Con esta particion, al_dia + por_vencer +
    falta == todos siempre — es lo que el test de integracion verifica contra
    Postgres real."""
    todos: int
    al_dia: int
    por_vencer: int
    falta: int


class ComplianceSummarySubject(ComplianceSummaryCounts):
    """Una cabecera de la ficha de empresa: la empresa misma, o uno de sus
    conductores o vehiculos, con sus cuatro cifras — sin las filas de
    detalle. La ficha pide esto al llegar; el detalle de un sujeto se pide
    aparte, solo cuando alguien lo despliega (GET /pending?entity_id=...)."""
    entity_type: str
    entity_id: str
    subject_name: Optional[str] = None


class ComplianceSummaryResponse(BaseModel):
    """GET /compliance-records/summary — reemplaza el fetch de 457 filas de
    detalle que la ficha de empresa hacia solo para dibujar nueve cabeceras
    plegadas con sus conteos (medido en dev: 57.183 bytes)."""
    totales: ComplianceSummaryCounts
    sujetos: list[ComplianceSummarySubject]
    # False si SUMMARY_LIMIT corto la CTE antes del GROUP BY (hallazgo 3 de
    # la revision final): las cuatro cifras -y las de cada sujeto- se
    # calcularon sobre una lista recortada y no hay que mostrarlas como si
    # fueran exactas. No es solo un adorno de UI: reemplaza a la guarda
    # `completa` que existia en la version anterior de este endpoint
    # (/pending con `total` de `count(*) OVER()`) y que se borro creyendo que
    # el resumen nunca podia venir truncado.
    completo: bool
    # Tipo de Operacion (Tractoreo/Equipo Completo) agregado de la flota
    # activa de la empresa (Ronda 85). No es una fila de detalle -es un
    # escalar por empresa- asi que viaja aca en vez de obligar a la ficha a
    # desplegar el sujeto CARRIER solo para conocerlo.
    carrier_operation_types: list[str]


class Alcance(BaseModel):
    """A cuántas entidades alcanza la condición de un requisito, sobre el
    universo de su tipo de entidad: "36 de 118 vehículos".

    Los dos números viajan juntos porque separados no dicen nada: "36" sin el
    universo no distingue una regla acotada de una general. `alcanzadas`
    cuenta la CONDICIÓN, no la vigencia — un requisito apagado sigue
    informando a cuántos alcanzaría si se encendiera, que es justo lo que
    alguien mira antes de encenderlo."""
    alcanzadas: int
    universo:   int


class RequirementOption(BaseModel):
    """Una fila del catálogo de tipos de documento. La consume el desplegable
    de clasificación de la bandeja de sin clasificar, y —desde el Tramo 3—
    la pantalla de condiciones configurables (Task 5), que necesita saber el
    estado ACTUAL de cada requisito (vigente o no, a qué está restringido)
    para dibujarlo, no solo su nombre y nivel."""
    id: str
    target_entity: Literal["CARRIER", "DRIVER", "ASSET"]
    requirement_code: str
    name: str
    requirement_level: Literal["LEGAL_MANDATORY", "SHIPPER_REQUIRED", "CONDITIONAL_OPTIONAL"]
    has_expiration: bool
    # Reemplaza a `has_expiration` como fuente de verdad. Aquel es un booleano
    # que cargaba tres significados, y por eso la carga rechazaba con 422
    # documentos cuya fecha la pantalla nunca pedia.
    expiration_policy: Literal["REQUIRED", "OPTIONAL", "NONE"]
    is_active: bool
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None
    alcance: Alcance
