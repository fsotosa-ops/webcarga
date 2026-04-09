#!/bin/bash

# Nombre del directorio principal
PROJECT_DIR="extraction_service"

echo "Creando estructura de directorios..."
mkdir -p $PROJECT_DIR/app/core
mkdir -p $PROJECT_DIR/app/api
mkdir -p $PROJECT_DIR/app/tms/qanalytics
mkdir -p $PROJECT_DIR/app/utils

touch $PROJECT_DIR/app/__init__.py
touch $PROJECT_DIR/app/core/__init__.py
touch $PROJECT_DIR/app/api/__init__.py
touch $PROJECT_DIR/app/tms/__init__.py
touch $PROJECT_DIR/app/tms/qanalytics/__init__.py
touch $PROJECT_DIR/app/utils/__init__.py

echo "# Extraction Service API" > $PROJECT_DIR/README.md

echo "Escribiendo pyproject.toml (Forzando Python >= 3.11)..."
cat << 'EOF' > $PROJECT_DIR/pyproject.toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"

[project]
name = "extraction-service"
version = "1.0.0"
description = "API robusta para orquestar scraping y extracciones de TMS"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi==0.104.1",
    "uvicorn==0.24.0.post1",
    "pydantic==2.5.2",
    "pydantic-settings==2.1.0",
    "playwright==1.40.0",
    "google-cloud-storage==2.13.0"
]

[project.optional-dependencies]
dev = [
    "pytest",
    "black",
    "flake8"
]
EOF

echo "Escribiendo archivo .gitignore..."
cat << 'EOF' > $PROJECT_DIR/.gitignore
venv/
.venv/
__pycache__/
*.pyc
.env
*.json
.DS_Store
*.egg-info/
build/
dist/
EOF

echo "Escribiendo Dockerfile adaptado estrictamente a Python 3.11..."
cat << 'EOF' > $PROJECT_DIR/Dockerfile
FROM python:3.11-slim-bookworm

WORKDIR /app

# Copiar el proyecto completo
COPY . .

# Instalar el proyecto y sus dependencias (esto instala playwright)
RUN pip install --no-cache-dir .

# Instalar dependencias de sistema operativo para Chromium
RUN playwright install --with-deps chromium

ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port $PORT"]
EOF

echo "Escribiendo app/core/config.py..."
cat << 'EOF' > $PROJECT_DIR/app/core/config.py
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
EOF

echo "Escribiendo app/api/schemas.py..."
cat << 'EOF' > $PROJECT_DIR/app/api/schemas.py
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional

class ExtractionRequest(BaseModel):
    client_name: str = Field(..., description="Nombre del cliente para la extracción")
    timeout_ms: Optional[int] = Field(90000, description="Tiempo máximo en milisegundos")
    extra_params: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Parámetros adicionales")
EOF

echo "Escribiendo app/utils/gcs_client.py..."
cat << 'EOF' > $PROJECT_DIR/app/utils/gcs_client.py
from google.cloud import storage
import logging

logger = logging.getLogger(__name__)

def upload_file_to_gcs(local_file_path: str, bucket_name: str, destination_blob_name: str) -> str:
    try:
        storage_client = storage.Client()
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(destination_blob_name)
        
        blob.upload_from_filename(local_file_path)
        logger.info(f"Archivo {local_file_path} subido a gs://{bucket_name}/{destination_blob_name}")
        return f"gs://{bucket_name}/{destination_blob_name}"
    except Exception as e:
        logger.error(f"Error al subir archivo a GCS: {str(e)}")
        raise
EOF

echo "Escribiendo app/tms/base.py..."
cat << 'EOF' > $PROJECT_DIR/app/tms/base.py
from abc import ABC, abstractmethod
from typing import Dict, Any

class BaseTMSExtractor(ABC):
    @abstractmethod
    async def extract(self, client_name: str, timeout_ms: int, extra_params: Dict[str, Any]) -> str:
        pass
EOF

echo "Escribiendo app/tms/qanalytics/scraper.py..."
cat << 'EOF' > $PROJECT_DIR/app/tms/qanalytics/scraper.py
import os
import logging
from datetime import datetime
from tempfile import NamedTemporaryFile
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError

from app.tms.base import BaseTMSExtractor
from app.core.config import settings
from app.utils.gcs_client import upload_file_to_gcs

logger = logging.getLogger(__name__)

class QAnalyticsExtractor(BaseTMSExtractor):
    
    async def extract(self, client_name: str, timeout_ms: int, extra_params: dict) -> str:
        logger.info(f"Iniciando extracción QAnalytics - Cliente: {client_name}")
        
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True, args=["--disable-dev-shm-usage", "--no-sandbox"])
            context = await browser.new_context(accept_downloads=True)
            page = await context.new_page()
            
            try:
                await page.goto(settings.QANALYTICS_URL, timeout=timeout_ms)
                await page.click('#Transporte')
                await page.fill("input[name='UsuarioT']", settings.QANALYTICS_USER)
                await page.fill("input[name='ContrasenaT']", settings.QANALYTICS_PASS)
                await page.fill("input[name='ClienteT']", client_name)
                await page.click('#BtnTransporte')
                
                await page.click('a.dropdown-toggle.NavQA >> text="Módulo Distribución"')
                await page.click('a[href="gestion_planificacion_programados_dist_transporte_walmart.aspx"]')
                await page.locator('#chkAuto').click()
                await page.click('.col-xs-1 > center > .btn')
                await page.locator('#btn_buscar').click()
                await page.click('.col-xs-1 > center > .btn')

                await page.wait_for_load_state('domcontentloaded')

                async with page.expect_download(timeout=timeout_ms) as download_info:
                    await page.click('.col-xs-1 > center > .btn')
                    download = await download_info.value
                    
                    original_filename = download.suggested_filename
                    base_name = os.path.splitext(original_filename)[0]
                    normalized_filename = f"{base_name.lower().replace(' ', '_')}.csv"
                    timestamp = int(datetime.now().timestamp())
                    
                    blob_name = f"prod/operations/tms/qanalytics/{client_name.lower()}/{timestamp}_{client_name}_{normalized_filename}"
                    
                    with NamedTemporaryFile(delete=False) as temp_file:
                        await download.save_as(temp_file.name)
                        temp_file_path = temp_file.name
                        
                    try:
                        gcs_uri = upload_file_to_gcs(
                            local_file_path=temp_file_path,
                            bucket_name=settings.GCS_BUCKET_NAME,
                            destination_blob_name=blob_name
                        )
                        return gcs_uri
                    finally:
                        if os.path.exists(temp_file_path):
                            os.remove(temp_file_path)

            except Exception as e:
                logger.error(f"Error en QAnalytics: {str(e)}")
                raise
            finally:
                await browser.close()
EOF

echo "Escribiendo app/tms/factory.py..."
cat << 'EOF' > $PROJECT_DIR/app/tms/factory.py
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
EOF

echo "Escribiendo app/api/routes.py..."
cat << 'EOF' > $PROJECT_DIR/app/api/routes.py
import logging
from fastapi import APIRouter, BackgroundTasks
from app.api.schemas import ExtractionRequest
from app.tms.factory import get_tms_extractor

logger = logging.getLogger(__name__)
router = APIRouter()

async def run_extraction_task(source_name: str, request: ExtractionRequest):
    try:
        extractor = get_tms_extractor(source_name)
        await extractor.extract(
            client_name=request.client_name,
            timeout_ms=request.timeout_ms,
            extra_params=request.extra_params
        )
    except Exception as e:
        logger.error(f"Fallo en background: {str(e)}")

@router.post("/extract/{source_name}", status_code=202)
async def trigger_extraction(source_name: str, request: ExtractionRequest, bg_tasks: BackgroundTasks):
    get_tms_extractor(source_name) 
    bg_tasks.add_task(run_extraction_task, source_name, request)
    return {"message": f"Tarea iniciada: {source_name}", "status": "processing"}

@router.get("/health")
def health_check():
    return {"status": "ok"}
EOF

echo "Escribiendo app/main.py..."
cat << 'EOF' > $PROJECT_DIR/app/main.py
import logging
from fastapi import FastAPI
from app.api.routes import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")

app = FastAPI(title="Extraction API Service", version="1.0.0")
app.include_router(router, prefix="/api/v1")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8080, reload=True)
EOF

echo ""
echo "======================================================"
echo "¡Proyecto Creado con Éxito (Python 3.11 + Directorio TMS)! "
echo "======================================================"
echo "Instrucciones de ejecución local:"
echo "1. cd $PROJECT_DIR"
echo "2. python3.11 -m venv venv"
echo "3. source venv/bin/activate"
echo "4. pip install -e ."
echo "5. playwright install --with-deps chromium"
echo "6. uvicorn app.main:app --reload --port 8080"