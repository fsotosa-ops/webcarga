from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    PROJECT_NAME: str = "Extraction API Service"
    API_VERSION: str = "v1"

    GCS_BUCKET_NAME: str
    BROWSER_HEADLESS: bool = True

    QANALYTICS_USER: str
    QANALYTICS_PASS: str
    QANALYTICS_URL: str = "https://www.qanalytics.cl/qnew/inicioQMGPS.aspx#"


settings = Settings()
