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

app = FastAPI(title="Extraction API Service", version="1.0.0")
app.include_router(router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
