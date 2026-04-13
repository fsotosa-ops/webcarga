from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date


def build_path(
    *,
    source: str,
    product: str,
    client: str,
    timestamp: int,
    date_from: date,
    date_to: date,
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
    """
    fmt = "%Y%m%d"
    return (
        f"tms/{source}/{product}/{client}/"
        f"{client}_{date_from.strftime(fmt)}_{date_to.strftime(fmt)}"
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
    date_from: date
    date_to: date


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
        date_from: date,
        date_to: date,
        timeout_ms: int,
    ) -> ExtractionArtifact:
        """Ejecuta la extracción y devuelve el artefacto local."""
