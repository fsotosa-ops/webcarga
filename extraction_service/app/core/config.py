from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    PROJECT_NAME: str = "Extraction API Service"
    API_VERSION: str = "v1"

    GCS_BUCKET_NAME: str
    BROWSER_HEADLESS: bool = True

    QANALYTICS_USER: str
    QANALYTICS_PASS: str
    QANALYTICS_URL: str = "https://www.qanalytics.cl/qnew/inicioQMGPS.aspx#"

    WINGSUITE_USER: str
    WINGSUITE_PASS: str
    WINGSUITE_URL: str = "https://suite.wing.cl/web/core/inicio_sesion.php"

    SODIMAC_USER: str
    SODIMAC_PASS: str
    SODIMAC_URL: str = "https://tms.falabella.supply/login"

    # Cap de jobs concurrentes por instancia. En Cloud Run la instancia se
    # marca "libre" cuando sale el 202, pero el scraper sigue corriendo en
    # background — sin este cap dos browsers de TMS distintos colisionan por
    # memoria/CPU en la misma instancia. 1 = serial (matches concurrency=1
    # del servicio); subir solo si la instancia tiene RAM/CPU de sobra.
    MAX_CONCURRENT_JOBS: int = 1
    # Hard cap por job — si un scraper se cuelga (login atorado, XHR que
    # nunca llega, redirect loop), el job muere en FAILED y el semáforo se
    # libera. Evita que un job zombie bloquee la instancia para siempre.
    JOB_TIMEOUT_MS: int = 600_000

    # DSN de Postgres (Supabase) para el job_store compartido — mismo
    # proyecto que usa monitor-app/backend/api. Ver
    # docs/superpowers/specs/2026-07-31-extraction-service-hardening-design.md.
    database_url: str

    # Tope de espera en cola antes de reclamar un slot (MAX_CONCURRENT_JOBS
    # ya ocupado por otros jobs). Distinto de JOB_TIMEOUT_MS: ese envuelve
    # SOLO el scraping en sí, este envuelve el tiempo en 'queued'. Separarlos
    # permite distinguir "contención" de "el scraper se colgó" en el error.
    QUEUE_TIMEOUT_MS: int = 300_000


settings = Settings()
