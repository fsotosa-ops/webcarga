"""Pydantic schemas para public.compliance_records (H2.2/H2.4 —
routers/compliance.py). Status y valores tomados del CHECK constraint real
de la tabla (init_compliance_engine.sql)."""
from datetime import date
from typing import Literal, Optional

from pydantic import BaseModel
from ..authz.permissions import Permission

from .common import ManagementType

ComplianceStatus = Literal[
    "MISSING", "PENDING_REVIEW", "APPROVED_MANUAL", "APPROVED",
    "REJECTED", "EXPIRED", "ARCHIVED",
]


# Los cinco tipos que admite la base (HU-C1, entrega 2). Las RESPUESTAS los
# aceptan todos: si conocieran solo tres, el primer requisito con un tipo nuevo
# tiraria 500 en /pending y en el catalogo. La ENTRADA (schemas/requirement.py)
# sigue en tres hasta que el alta y la edicion manden sus parametros (F5).
PoliticaVencimiento = Literal[
    "NONE", "REQUIRED", "OPTIONAL", "ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD"
]


class ComplianceRecordPatchBody(BaseModel):
    """Override manual de un compliance_record (ej. un admin aprueba a mano
    sin subir archivo). El upload de archivo real usa un endpoint separado
    (H2.4) que fuerza status='APPROVED_MANUAL', no este PATCH libre."""
    status: Optional[ComplianceStatus] = None
    expiration_date: Optional[date] = None


# Permiso por campo (RBAC): la fecha se declara al cargar —incluso antes de
# tener el escaneo—; aprobar o rechazar es revisar.
COMPLIANCE_RECORD_FIELD_PERMISSIONS: dict[str, Permission] = {
    "status": Permission.DOCUMENTS_REVIEW,
    "expiration_date": Permission.DOCUMENTS_UPLOAD,
}

# Sobre un documento ya aprobado, correr la fecha es extender su vigencia sin
# que nadie revise: ahí la fecha deja de ser carga y exige documents.review
# (revisión final RBAC, hallazgo 4).
ESTADOS_APROBADOS: frozenset[str] = frozenset({"APPROVED", "APPROVED_MANUAL"})


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
    urgencia: Literal["VENCIDO", "POR_VENCER", "FALTA", "AL_DIA", "NO_EXIGIBLE"]
    # Desde cuándo se exige, si todavía no (MONTH_AFTER_START).
    exigible_desde: Optional[date] = None
    # El vencimiento calculado según su tipo y la regla de cada cliente
    # (HU-C1, entrega 2b). `falta_dato_de_vigencia`: está cargado pero sin la
    # emisión o el período que su tipo necesita.
    vence_el: Optional[date] = None
    falta_dato_de_vigencia: bool = False
    issue_date: Optional[date] = None
    period_start: Optional[date] = None
    # Existe porque alguien lo solicitó (exigible_on = ON_REQUEST).
    a_pedido: bool = False
    # Que hace su requisito con la fecha de vencimiento. El renglon de carga lo
    # necesita para pedir la fecha ANTES de subir: sin el, o pregunta siempre,
    # o no pregunta nunca y /file rechaza con 422 el archivo ya subido.
    expiration_policy: PoliticaVencimiento


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
    # Lo que todavía no se exige (HU-C1, entrega 2b): ni falta ni al día.
    no_exigible: int = 0


class ComplianceSummarySubject(ComplianceSummaryCounts):
    """Una cabecera de la ficha de empresa: la empresa misma, o uno de sus
    conductores o vehiculos, con sus cuatro cifras — sin las filas de
    detalle. La ficha pide esto al llegar; el detalle de un sujeto se pide
    aparte, solo cuando alguien lo despliega (GET /pending?entity_id=...)."""
    entity_type: str
    entity_id: str
    subject_name: Optional[str] = None
    # Que es el vehiculo. Nulos para CARRIER y DRIVER -no es "desconocido",
    # es que la pregunta no aplica-, y `fleet_service_type_*` tambien es nulo
    # para un tractocamion: el subtipo de carroceria solo lo llevan las
    # ramplas. La ficha dibuja un badge por campo presente, asi que un nulo
    # simplemente no pinta nada; no hay valor de relleno que inventar.
    asset_type: Optional[str] = None
    fleet_service_type_label: Optional[str] = None
    fleet_service_type_bg_color: Optional[str] = None
    fleet_service_type_text_color: Optional[str] = None


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


class ReglaDeVigencia(BaseModel):
    """La regla base VIGENTE de un tipo de documento (HU-C1, entrega 2b)."""
    validity_months: Optional[int] = None
    frequency_months: Optional[int] = None
    cutoff_day: Optional[int] = None
    period_offset_months: Optional[int] = None
    warning_days: Optional[int] = None
    grace_days: int = 0


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
    # Reemplazó a has_expiration (retirado en HU-C1), un booleano que cargaba
    # tres significados: por eso la carga rechazaba con 422 documentos cuya
    # fecha la pantalla nunca pedía.
    expiration_policy: PoliticaVencimiento
    # Los parámetros de la regla base vigente; None si el tipo no tiene regla
    # (no vence, o fecha del documento con el aviso general).
    vigencia: Optional[ReglaDeVigencia] = None
    # Si la regla ya cambió alguna vez estando en uso: entonces un cambio más
    # "rige desde hoy" y la pantalla lo dice.
    tiene_versiones: bool = False
    exigible_on: Literal["ON_ENTITY_START", "MONTH_AFTER_START", "ON_ENTITY_END", "ON_REQUEST"]
    is_active: bool
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None
    alcance: Alcance
    # Cómo se reconoce el documento en el nombre del archivo. Sin este campo
    # FastAPI lo descartaba de la respuesta y "Se reconoce como" mostraba "—"
    # en todas las filas, aunque la consulta lo traía.
    aliases: list[str] = []


class SolicitudBody(BaseModel):
    """Pedir un documento "solo cuando se solicita" a una entidad (HU-C1,
    entrega 2b): trabajo en altura, soldador, guardias…"""
    requirement_id: str
    entity_type: Literal["CARRIER", "DRIVER", "ASSET"]
    entity_id: str
