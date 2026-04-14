import logging
import sys

from pythonjsonlogger import jsonlogger
from fastapi import FastAPI

from app.api.routes import router


def setup_logging():
    handler = logging.StreamHandler(sys.stdout)
    formatter = jsonlogger.JsonFormatter(
        "%(asctime)s %(name)s %(levelname)s %(message)s",
        rename_fields={"asctime": "timestamp", "levelname": "severity"},
    )
    handler.setFormatter(formatter)
    logging.root.handlers = [handler]
    logging.root.setLevel(logging.INFO)


setup_logging()


API_DESCRIPTION = """
Servicio de extracción de datos desde TMS (Transport Management Systems)
heterogéneos hacia un datalake único en GCS. Expone un contrato unificado
— `POST /jobs` con `{source, product, ...}` — que abstrae la mecánica
específica de cada TMS (Playwright, XHR interception, CSV/XLS export)
detrás de un job asíncrono.

### Flujo típico

1. `GET /sources` — descubrir combinaciones `(source, product)` disponibles.
2. `POST /jobs` — disparar una extracción (202 + `job_id`).
3. `GET /jobs/{job_id}` — poll hasta `status=done`, leer `result.gcs_uri`.

### Convenciones

- Fechas en formato ISO `YYYY-MM-DD`.
- Timeouts en milisegundos.
- Artefactos subidos a `gs://sandbox-webcarga/tms/{source}/{product}/...`.
"""

TAGS_METADATA = [
    {
        "name": "Jobs",
        "description": (
            "Ciclo de vida de una extracción: crear, consultar estado, "
            "recuperar resultado. Recurso principal del API."
        ),
    },
    {
        "name": "Catalog",
        "description": "Descubrimiento de TMS y productos soportados.",
    },
    {
        "name": "Ops",
        "description": "Health checks y métricas operacionales.",
    },
]

app = FastAPI(
    title="Extraction API Service",
    version="1.0.0",
    summary="API unificada para extraer datos de TMS hacia GCS.",
    description=API_DESCRIPTION,
    contact={"name": "Webcarga", "email": "felipe@sumadots.com"},
    openapi_tags=TAGS_METADATA,
)
app.include_router(router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
