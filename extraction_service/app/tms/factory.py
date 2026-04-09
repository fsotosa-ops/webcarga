from fastapi import HTTPException
from app.tms.qanalytics.scraper import QAnalyticsExtractor

EXTRACTORS = {
    "qanalytics": QAnalyticsExtractor(),
}

def get_tms_extractor(source_name: str):
    extractor = EXTRACTORS.get(source_name.lower())
    if not extractor:
        raise HTTPException(status_code=400, detail="TMS no soportado.")
    return extractor
