from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

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
# Los grupos validos dependen del vocabulario, asi que se validan en el router
# (que conoce el `domain` de la fila), no en el schema.
# Las etapas del viaje (antes "columnas del tablero"; el tablero se retiró el 17/10):
# un conjunto cerrado, declarado una sola vez. Lo usan los estados del TMS
# (routers/config.py) y los operacionales (abajo); el frontend les da su tono en
# lib/states.ts (TRIP_STAGE_STYLE / tripStageStyle).
TRIP_STAGES = frozenset({"en_ruta", "en_local", "retornando", "pendiente_cierre_tms", "cerrado", "problema", "otro"})

GRUPOS_POR_DOMINIO = {
    # En que etapa del viaje cae un viaje con este estado.
    "OPERATIONAL_STATE": TRIP_STAGES,
    # Si el conductor trabajo sin asignacion o no trabajo (migracion 20260917000000).
    "DRIVER_REASON": {"no_trabajando", "trabajando_sin_asignacion"},
    # A quien aplica un motivo de baja o de reactivacion (services/lifecycle.py):
    # a todos, o solo a empresas, conductores o equipos (migracion 20261028090000).
    "DEACTIVATION_REASON": {"all", "carrier", "driver", "asset"},
    "REACTIVATION_REASON": {"all", "carrier", "driver", "asset"},
}


class StatusTaxonomyBody(BaseModel):
    # Sin colores: el tono sale del significado (Configuración, Parte 1). Un campo
    # que no existe es un 422, no un dato que se ignora en silencio.
    model_config = ConfigDict(extra="forbid")

    domain:     str
    label:      str
    sort_order: int = 99
    group_id:   Optional[str] = None

    @field_validator("label")
    @classmethod
    def label_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v or len(v) > 60:
            raise ValueError("label debe tener entre 1 y 60 caracteres")
        return v



class StatusTaxonomyPatch(BaseModel):
    # `sort_order` NO se puede escribir aca: se mueve con POST .../move, que es
    # atomico. Mientras un cliente pueda mandar un numero arbitrario, dos filas
    # del mismo dominio pueden terminar con el mismo y la lista queda con un
    # empate que la pantalla no sabe deshacer. Ver services/reordenamiento.py.
    model_config = ConfigDict(extra="forbid")

    label:      Optional[str] = None
    active:     Optional[bool] = None
    group_id:   Optional[str] = None

