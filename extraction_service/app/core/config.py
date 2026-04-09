import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    PROJECT_NAME: str = "Extraction API Service"
    API_VERSION: str = "v1"
    
    GCS_BUCKET_NAME: str = os.getenv("GCS_BUCKET_NAME", "webcarga-datalake")
    
    QANALYTICS_USER: str = os.getenv("QANALYTICS_USER", "76376879-1")
    QANALYTICS_PASS: str = os.getenv("QANALYTICS_PASS", "q8791")
    QANALYTICS_URL: str = os.getenv("QANALYTICS_URL", "https://www.qanalytics.cl/qnew/inicioQMGPS.aspx#")

settings = Settings()
