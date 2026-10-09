"""Pydantic schemas para el catálogo de requisitos y su recálculo
(app/routers/requirements.py). Ver app/services/requirement_conditions.py
para la regla de aplicabilidad que estos endpoints exponen."""
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator, model_validator

from .common import ManagementType, normalize_management_types, normalize_nonempty_list


# Desde cuándo se exige un documento (HU-C1, entrega 2b). La regla la evalúan
# la siembra (`reconcile_*`, `SQL_ENTIDADES_QUE_APLICAN`) y la lectura
# (`exigible_sql` en services/vencimientos.py).
ExigibleOn = Literal["ON_ENTITY_START", "MONTH_AFTER_START", "ON_ENTITY_END", "ON_REQUEST"]


class VigenciaBody(BaseModel):
    """Cómo vence un tipo de documento: el tipo y sus parámetros.

    La forma la valida Pydantic (tipos y rangos). La COHERENCIA —qué
    parámetros pide cada tipo— la hace cumplir la base
    (`validar_vigencia_de_requisito`), y su mensaje vuelve como 422: así hay
    una sola definición, la que también protege una escritura que no pase por
    la API."""
    politica: Literal["NONE", "REQUIRED", "OPTIONAL", "ISSUE_PLUS_MONTHS", "CALENDAR_PERIOD"]
    validity_months: Optional[int] = Field(None, gt=0)
    frequency_months: Optional[int] = Field(None, gt=0)
    cutoff_day: Optional[int] = Field(None, ge=1, le=31)
    period_offset_months: Optional[int] = Field(None, ge=0)
    # None = rige el aviso general de Configuración › Alertas.
    warning_days: Optional[int] = Field(None, ge=0)
    grace_days: int = Field(0, ge=0)


class RequirementConditionsPatchBody(BaseModel):
    """Todo opcional: se puede tocar la vigencia sin tocar las condiciones.

    `[]` es una forma legítima de decir "sin restricción" (vuelve la
    condición a NULL) — no una omisión. Por eso `sent_fields()` NO mira si el
    valor final quedó en `None`: usa `model_fields_set`, que registra qué
    claves llegaron en el body, independientemente de en qué se normalicen.
    Con eso "no lo mandaron" (ausente del body) y "lo mandaron vacío"
    (normalizado a NULL) dejan de compartir la misma representación — la
    trampa de null-con-dos-significados que ya apareció dos veces en este
    módulo (D#, ver Ronda de arreglo 1).

    `is_active` es la excepción a propósito: la columna es NOT NULL, así que
    ahí `null` explícito no es "sacar la restricción" — no significa nada, y
    se rechaza con 422 en vez de dejar que reviente como 500 en la base
    (Ronda de arreglo 2)."""
    is_active: Optional[bool] = None
    applies_to_fleet_service_type_ids: Optional[list[str]] = None
    applies_to_management_types: Optional[list[ManagementType]] = None
    # Cómo vence: el tipo y sus parámetros, juntos. No hay un campo suelto para
    # `expiration_policy`: el tipo sin sus parámetros es una regla a medias, y
    # dos caminos para escribir la misma columna son dos verdades.
    vigencia: Optional[VigenciaBody] = None
    # Desde cuándo se exige. Cambiarlo puede agregar o quitar pendientes (un
    # documento "solo cuando se solicita" no se siembra), así que, como las
    # condiciones, se aplica con POST /recalc y su vista previa.
    exigible_on: Optional[ExigibleOn] = None
    # El nombre VISIBLE del documento. Renombrarlo es inocuo: ninguna tabla
    # guarda copia -- `compliance_records` referencia por id y todas las
    # pantallas hacen JOIN vivo contra `req.name` --, asi que el cambio se ve
    # al instante en todo el modulo.
    #
    # `requirement_code` NO esta acá y no debe estarlo: es la llave que usan
    # los alias de nombre de archivo (`requirement_filename_aliases`), el
    # motor de match (`document_matcher`) y el catalogo de vencimientos.
    # Renombrarlo dejaria al clasificador sin poder resolver ese documento.
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    # Cuan obligatorio es: lo leen la ficha (`pending_mandatory`) y el
    # semaforo del Diario, que cuentan solo LEGAL_MANDATORY. NO decide la
    # siembra: desde 20260816010000 los disparadores (`reconcile_new_*`) leen
    # `is_active` y las condiciones `applies_to_*`, no el nivel.
    requirement_level: Optional[Literal["LEGAL_MANDATORY", "CONDITIONAL_OPTIONAL"]] = None

    # mode="after", no "before": para cuando estos corren, Pydantic ya
    # validó cada elemento contra su tipo declarado (list[str] /
    # list[ManagementType]) y devolvió un 422 legible si no matcheaba. Con
    # "before" reciben la lista cruda sin tipar — `normalize_nonempty_list`
    # crasheaba con `TypeError` (500, no 422) ante una lista de tipos
    # mixtos, porque `sorted()` no sabe comparar `int` con `str` (Ronda de
    # arreglo 2, hallazgo real).
    @field_validator("applies_to_management_types", mode="after")
    @classmethod
    def _normalize_management(cls, v):
        return normalize_management_types(v)

    @field_validator("applies_to_fleet_service_type_ids", mode="after")
    @classmethod
    def _normalize_fleet_service_types(cls, v):
        # No tiene CHECK de cardinalidad en la base: un [] silencioso se
        # guardaría tal cual y dejaría la regla sin matchear ningún asset.
        return normalize_nonempty_list(v)

    @model_validator(mode="after")
    def _is_active_rejects_explicit_null(self):
        # Mismo mecanismo que permite [] -> NULL en los otros dos campos
        # (model_fields_set, no "value is None") aplicado al caso donde NULL
        # es un valor inexistente para la columna, no una instrucción válida.
        # Sin esto, `{"is_active": null}` llega a
        # `SET is_active = $2` con None y explota como not_null_violation
        # (500) en vez de un 422 legible.
        if "is_active" in self.model_fields_set and self.is_active is None:
            raise ValueError(
                "is_active no admite null explícito: la columna no permite NULL"
            )
        return self

    def sent_fields(self) -> list[str]:
        fields = (
            "is_active", "applies_to_fleet_service_type_ids", "applies_to_management_types",
            "name", "requirement_level", "exigible_on", "vigencia",
        )
        return [f for f in fields if f in self.model_fields_set]


class CambioDeRequisito(BaseModel):
    """Un documento del borrador y lo que se le cambia. El `patch` es el MISMO
    cuerpo del PATCH de uno: los dos caminos escriben con la misma función
    (services/edicion_catalogo.py)."""
    # UUID y no str: un id mal formado es un 422 al validar, no un 500 de la base.
    requirement_id: UUID
    patch: RequirementConditionsPatchBody


class LoteDeCambios(BaseModel):
    """El borrador de la tabla de Configuración (HU-C1, entrega 2c). Se ensaya
    entero ("Ver efecto") y se publica entero, o no se publica."""
    # El tope cubre el catálogo completo (96 de la planilla + los propios)
    # y acota cuánto se siembra en una sola transacción.
    cambios: list[CambioDeRequisito] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def _sin_repetidos(self):
        ids = [c.requirement_id for c in self.cambios]
        if len(ids) != len(set(ids)):
            # Dos cambios al mismo documento se pisarían en un orden que nadie
            # eligió.
            raise ValueError("Un documento aparece dos veces en el lote")
        return self


class RequirementCreateBody(BaseModel):
    """Un tipo de documento nuevo en el catalogo.

    NACE APAGADO, y no es un detalle de implementacion: `reconcile_new_requirement()`
    siembra un `compliance_record` por cada entidad que califique, y hoy hay
    5.121 registros -- uno de conductor agrega 87 de un saque, uno de vehiculo
    hasta 124. Insertarlo vigente seria una escritura masiva disparada por un
    formulario de alta.

    Apagado no le aplica a nadie, asi que se le definen condiciones con calma y
    la siembra ocurre al activarlo, por el MISMO camino que ya usa cambiar una
    condicion: guardar la regla y aplicarla son dos decisiones distintas.

    `requirement_code` NO se recibe: se deriva del nombre. Es la llave del
    motor de match y de los alias, y dejarla escribir invita a que dos
    documentos compartan codigo o a que alguien la cambie despues.
    """
    name: str = Field(min_length=1, max_length=255)
    target_entity: Literal["CARRIER", "DRIVER", "ASSET"]
    requirement_level: Literal["LEGAL_MANDATORY", "CONDITIONAL_OPTIONAL"] = "LEGAL_MANDATORY"
    # Nace sin vencimiento salvo que se diga otra cosa: el mismo default que
    # "Nuevo documento" mostraba antes de la entrega 2b.
    vigencia: VigenciaBody = Field(default_factory=lambda: VigenciaBody(politica="NONE"))
    exigible_on: ExigibleOn = "ON_ENTITY_START"
    # Acota el requisito a un generador de carga. La siembra de empresas ya lo
    # respeta (`req.shipper_id IS NULL` para los generales), asi que "lo que
    # Sodimac pide y Walmart no" ya esta en el modelo -- faltaba exponerlo.
    shipper_id: Optional[str] = None


class RequirementAliasBody(BaseModel):
    """Una forma de escribir este documento en el nombre de un archivo.

    Sin alias, un documento nuevo nace INVISIBLE para el clasificador: el motor
    resuelve el tipo buscando alias dentro del nombre normalizado. Es
    literalmente el caso de "CARNET REPRESENTANTE LEGAL.pdf", que no resuelve
    porque el catalogo tiene CEDULA, CI y COPIA CI, pero no CARNET.
    """
    alias: str = Field(min_length=2, max_length=120)
    # Resuelve el solapamiento por substring: 'USO Y MANTENCION EPP' (100) le
    # gana a 'EPP' (10), que esta contenido en el.
    priority: int = 0


class RecalcPreview(BaseModel):
    crear: int
    quitar: int
    bloqueados: int


class RecalcResult(BaseModel):
    creados: int
    quitados: int
    bloqueados: int
