from fastapi import HTTPException

from app.tms.base import BaseTMSExtractor
from app.tms.qanalytics.scraper import QAnalyticsExtractor
from app.tms.sodimac.scraper import SodimacExtractor
from app.tms.wingsuite.scraper import WingsuiteExtractor


# Registro canónico: source → instancia del adapter.
# Cuando un TMS gane soporte para más de un producto, reemplazar por
# `(source, product) → adapter` y actualizar `get_adapter`.
EXTRACTORS: dict[str, BaseTMSExtractor] = {
    "qanalytics": QAnalyticsExtractor(),
    "wingsuite": WingsuiteExtractor(),
    "sodimac": SodimacExtractor(),
}


def list_sources() -> list[dict]:
    """Catálogo público: qué TMS hay y qué productos expone cada uno."""
    return [
        {"source": name, "products": [ext.PRODUCT_NAME]}
        for name, ext in EXTRACTORS.items()
    ]


def _get_by_source(source_name: str) -> BaseTMSExtractor:
    """Lookup por `source` únicamente. Helper interno de `get_adapter`."""
    extractor = EXTRACTORS.get(source_name.lower())
    if not extractor:
        available = ", ".join(sorted(EXTRACTORS.keys()))
        raise HTTPException(
            status_code=400,
            detail=f"TMS '{source_name}' no soportado. Disponibles: {available}",
        )
    return extractor


def get_adapter(source: str, product: str) -> BaseTMSExtractor:
    """Resuelve un extractor validando source + product.

    El endpoint unificado `POST /jobs` usa esto: garantiza que el pipeline no
    puede pedir un producto que el TMS no expone (ej. `qanalytics/invoices`
    cuando qanalytics solo expone `trips`).
    """
    extractor = _get_by_source(source)
    if extractor.PRODUCT_NAME.lower() != product.lower():
        raise HTTPException(
            status_code=400,
            detail=(
                f"Producto '{product}' no disponible para TMS '{source}'. "
                f"Disponibles: [{extractor.PRODUCT_NAME}]"
            ),
        )
    return extractor
