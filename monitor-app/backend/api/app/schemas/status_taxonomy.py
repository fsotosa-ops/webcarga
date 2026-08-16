from typing import Optional

from pydantic import BaseModel, field_validator

# NO hay lista de dominios validos aca, a proposito.
#
# La habia, y estaba escrita DOS VECES —este archivo y el union TaxonomyDomain
# de frontend/lib/api/config.ts—. WEBCARGA_OPERATION_TYPE existia solo del lado
# TypeScript, asi que la seccion "Tipos de operacion" devolvia 422 al listar y
# al crear: media pantalla rotulada que no funcionaba. Es la misma clase de
# defecto que el critico del Tramo 3 (el mismo concepto declarado dos veces,
# cada copia correcta por su lado).
#
# La fuente de verdad es la TABLA: un dominio existe si app.status_taxonomies
# tiene filas con ese valor. Agregar un vocabulario nuevo pasa a ser una
# migracion que siembra su primera fila, que es lo correcto — un tipo de
# vocabulario nuevo es una decision de producto, no un string suelto en un set.
# La validacion vive en app/routers/status_taxonomies.py, que si puede consultar.
VALID_GROUP_IDS = {"en_ruta", "en_local", "retornando", "cerrado", "problema", "otro"}


class StatusTaxonomyBody(BaseModel):
    domain:     str
    label:      str
    bg_color:   str = "#f3f4f6"
    text_color: str = "#374151"
    sort_order: int = 99
    group_id:   Optional[str] = None

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v


class StatusTaxonomyPatch(BaseModel):
    label:      Optional[str] = None
    bg_color:   Optional[str] = None
    text_color: Optional[str] = None
    sort_order: Optional[int] = None
    active:     Optional[bool] = None
    group_id:   Optional[str] = None

    @field_validator("group_id")
    @classmethod
    def group_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in VALID_GROUP_IDS:
            raise ValueError(f"group_id debe ser uno de {VALID_GROUP_IDS}")
        return v
