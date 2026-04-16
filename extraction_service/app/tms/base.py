from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Optional


def build_path(
    *,
    source: str,
    product: str,
    client: str,
    timestamp: int,
    date_from: Optional[date],
    date_to: Optional[date],
    extension: str = ".xls",
) -> str:
    """
    Construye el path para artefactos de extracción en local y GCS.

    Resultado:
        tms/{source}/{product}/{client}/{client}_{YYYYMMDD}_{YYYYMMDD}_{timestamp}{ext}

    Ejemplo:
        tms/qanalytics/monitor-trips/walmart/walmart_20260413_20260413_1744584396.xls

    Convenciones:
      - `tms/{source}/{product}/` → prefijo fijo que identifica origen y tipo de dato.
      - `{client}/` → carpeta por cliente para trazabilidad y filtrado.
      - `{client}_{from}_{to}` → rango de datos extraídos.
      - `_{timestamp}` → Unix epoch de la corrida. Garantiza unicidad incluso con
        múltiples extracciones el mismo día.

    Esta función es la única fuente de verdad: el scraper la usa para el path
    local, el runner la usa para el blob de GCS.

    Fallback None → today: para TMS sin filtro de rango (ej. sodimac) donde
    `date_from`/`date_to` llegan en None, usamos `date.today()` como placeholder
    estable dentro de una misma corrida — el timestamp de la corrida garantiza
    unicidad aunque la misma extracción se repita el mismo día.
    """
    fmt = "%Y%m%d"
    today = date.today()
    df = date_from or today
    dt = date_to or today
    return (
        f"tms/{source}/{product}/{client}/"
        f"{client}_{df.strftime(fmt)}_{dt.strftime(fmt)}"
        f"_{timestamp}{extension}"
    )


@dataclass
class ExtractionArtifact:
    """Artefacto local devuelto por un extractor TMS tras una corrida exitosa."""

    local_path: str
    source: str
    product: str
    client_name: str
    timestamp: int
    # Opcionales: los adapters cuyo TMS no soporta filtro de rango (ej. sodimac,
    # donde la UI no expone date pickers) pueden devolver None. El runner usa
    # `today` como fallback al construir el filename via `build_path`.
    date_from: Optional[date]
    date_to: Optional[date]


class BaseTMSExtractor(ABC):
    # Cada implementación debe declarar su nombre canónico — debe coincidir
    # con la key en `app.tms.factory.EXTRACTORS`.
    SOURCE_NAME: str = ""
    # Producto de datos que extrae este extractor (ej: monitor-trips, invoices).
    PRODUCT_NAME: str = ""

    @abstractmethod
    async def extract(
        self,
        *,
        client_name: str,
        date_from: Optional[date],
        date_to: Optional[date],
        timeout_ms: int,
    ) -> ExtractionArtifact:
        """Ejecuta la extracción y devuelve el artefacto local.

        `date_from`/`date_to` son Optional para soportar TMS sin filtro de rango.
        Los adapters que los requieren deben validarlos y levantar ValueError
        explícito si llegan en None.
        """
