"""Pydantic schemas para el catálogo de requisitos y su recálculo
(app/routers/requirements.py). Ver app/services/requirement_conditions.py
para la regla de aplicabilidad que estos endpoints exponen."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from .common import ManagementType, normalize_management_types, normalize_nonempty_list


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
    # Que hace el sistema con la fecha de vencimiento de este requisito.
    # `Literal` y no `str`: un valor fuera de los tres rebota como 422 legible
    # en vez de llegar al CHECK de la base y volver como 500. La columna es
    # NOT NULL, asi que `null` explicito no significa nada — pero a diferencia
    # de `is_active` no hace falta rechazarlo aparte, porque `Literal` ya no
    # admite None y Pydantic lo corta antes.
    expiration_policy: Optional[Literal["REQUIRED", "OPTIONAL", "NONE"]] = None
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
    # A quien se le EXIGE. No es una etiqueta de presentacion: los disparadores
    # de siembra (`reconcile_new_*`) sólo siembran LEGAL_MANDATORY, así que
    # cambiar esto agrega o quita registros. Por eso pasa por la misma vista
    # previa que las condiciones.
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
            "expiration_policy", "name", "requirement_level",
        )
        return [f for f in fields if f in self.model_fields_set]


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
    expiration_policy: Literal["REQUIRED", "OPTIONAL", "NONE"] = "NONE"
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
