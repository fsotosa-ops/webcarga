# /new-tms — Agregar un nuevo adapter TMS

Guía paso a paso para integrar un nuevo TMS al extraction_service.

Pide al usuario el nombre del TMS si no lo especificó (ej. "bluex", "coordinadora").

## Pasos a implementar

### 1. Crear la estructura de archivos

```bash
mkdir -p extraction_service/app/tms/{NAME}
touch extraction_service/app/tms/{NAME}/__init__.py
```

### 2. Crear el scraper (`app/tms/{NAME}/scraper.py`)

Usar esta plantilla base como punto de partida:

```python
import time
from datetime import date
from typing import Optional

from playwright.async_api import async_playwright

from app.core.config import settings
from app.tms.base import BaseTMSExtractor, ExtractionArtifact, build_path


class {ClassName}Extractor(BaseTMSExtractor):
    SOURCE_NAME = "{name}"
    PRODUCT_NAME = "trips"

    async def extract(
        self,
        *,
        client_name: str,
        date_from: Optional[date],
        date_to: Optional[date],
        timeout_ms: int,
    ) -> ExtractionArtifact:
        ts = int(time.time())
        local_path = build_path(
            source=self.SOURCE_NAME,
            product=self.PRODUCT_NAME,
            client=client_name,
            timestamp=ts,
            date_from=date_from,
            date_to=date_to,
            extension=".csv",
        )

        async with async_playwright() as p:
            browser = await p.chromium.launch(
                headless=settings.BROWSER_HEADLESS,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = await browser.new_page()
            try:
                # TODO: implementar login, navegación, extracción
                pass
            finally:
                await browser.close()

        return ExtractionArtifact(
            local_path=local_path,
            source=self.SOURCE_NAME,
            product=self.PRODUCT_NAME,
            client_name=client_name,
            timestamp=ts,
            date_from=date_from,
            date_to=date_to,
        )
```

**Decisión de browser**: Firefox para portales con reCAPTCHA v3; Chromium con `--no-sandbox` para portales con Cloudflare Bot Management.

### 3. Registrar en `app/tms/factory.py`

Agregar import y entrada en `EXTRACTORS`:
```python
from app.tms.{name}.scraper import {ClassName}Extractor

EXTRACTORS: dict[str, BaseTMSExtractor] = {
    "qanalytics": QAnalyticsExtractor(),
    "wingsuite": WingsuiteExtractor(),
    "sodimac": SodimacExtractor(),
    "{name}": {ClassName}Extractor(),   # ← agregar aquí
}
```

### 4. Agregar credenciales en `app/core/config.py`

```python
{NAME_UPPER}_USER: str
{NAME_UPPER}_PASS: str
{NAME_UPPER}_URL: str = "https://..."
```

### 5. Agregar al `.env`

```
{NAME_UPPER}_USER=usuario
{NAME_UPPER}_PASS=clave
{NAME_UPPER}_URL=https://portal.ejemplo.com
```

### 6. Verificar integración

```bash
curl -s http://localhost:8080/api/v1/sources | python3 -m json.tool
# Debe aparecer el nuevo TMS en la lista
```

Luego correr `/smoke-test {name}` para el E2E completo.
