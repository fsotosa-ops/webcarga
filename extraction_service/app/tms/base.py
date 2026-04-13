from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date


def hive_path(
    *,
    source: str,
    product: str,
    client: str,
    extracted_at: date,
    date_from: date,
    date_to: date,
    extension: str = ".xls",
) -> str:
    """
    Construye un path Hive-style para los artefactos de extracción.

    Resultado:
        tms/{source}/{product}/client={client}/extracted_at={YYYY-MM-DD}/from={YYYY-MM-DD}_to={YYYY-MM-DD}{ext}

    Por qué Hive-style:
      - Tools como Spark, BigQuery, Athena, DuckDB descubren automáticamente
        las particiones `key=value` y las exponen como columnas. Cero parser custom.
      - `tms/` es el prefijo raíz del datalake en Cloud Storage.
      - `{source}` identifica el TMS (ej: qanalytics).
      - `{product}` identifica el producto de datos (ej: monitor-trips, invoices).
      - `extracted_at` particiona por fecha de corrida → re-extraer las mismas
        fechas en otro día crea una nueva partición y conserva historial
        (útil para datos tardíos / correcciones del proveedor / auditoría).
      - El filename final encodea el RANGO de los datos (`from`/`to`) que es
        ortogonal a la fecha de extracción.

    Esta función es la única fuente de verdad: el scraper la usa para el path
    local, el runner la usa para el blob de GCS. Si cambian los segmentos, se
    cambian acá una sola vez.
    """
    return (
        f"tms/{source}/"
        f"{product}/"
        f"client={client}/"
        f"extracted_at={extracted_at.isoformat()}/"
        f"from={date_from.isoformat()}_to={date_to.isoformat()}{extension}"
    )


@dataclass
class ExtractionArtifact:
    """Artefacto local devuelto por un extractor TMS tras una corrida exitosa."""

    local_path: str
    source: str
    product: str
    client_name: str
    extracted_at: date
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
