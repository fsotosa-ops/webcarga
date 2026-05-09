from fastapi import HTTPException

from app.tms.base import BaseTMSExtractor
from app.tms.qanalytics.cumplimiento_citas import QAnalyticsCumplimientoCitasExtractor
from app.tms.qanalytics.cumplimiento_sap import QAnalyticsCumplimientoExtractor
from app.tms.qanalytics.scraper import QAnalyticsExtractor
from app.tms.sodimac.scraper import SodimacExtractor
from app.tms.wingsuite.scraper import WingsuiteExtractor

# Registro canónico: (source, product) → instancia del adapter.
EXTRACTORS: dict[tuple[str, str], BaseTMSExtractor] = {
    ("qanalytics", "trips"): QAnalyticsExtractor(),
    ("qanalytics", "cumplimiento-sap"): QAnalyticsCumplimientoExtractor(),
    ("qanalytics", "cumplimiento-citas"): QAnalyticsCumplimientoCitasExtractor(),
    ("wingsuite", "trips"): WingsuiteExtractor(),
    ("sodimac", "trips"): SodimacExtractor(),
}


def list_sources() -> list[dict]:
    """Catálogo público: qué TMS hay y qué productos expone cada uno."""
    sources: dict[str, list[str]] = {}
    for source, product in EXTRACTORS:
        sources.setdefault(source, []).append(product)
    return [{"source": s, "products": ps} for s, ps in sources.items()]


def get_adapter(source: str, product: str) -> BaseTMSExtractor:
    """Resuelve un extractor validando (source, product).

    Retorna 400 si el combo no está registrado, listando los disponibles.
    """
    key = (source.lower(), product.lower())
    extractor = EXTRACTORS.get(key)
    if not extractor:
        available = ", ".join(f"{s}/{p}" for s, p in sorted(EXTRACTORS))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Combo '{source}/{product}' no soportado. "
                f"Disponibles: {available}"
            ),
        )
    return extractor
