# Rediseño scraper IANSA (QAnalytics) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el scraper de IANSA (hoy apunta a la página equivocada de QAnalytics) por uno que extrae del reporte real (`Reporte Detalle`, tenant `mmPFQ S.A.`), actualizar el pipeline de Mage y dbt para que ese dato llegue correcto a `app.trips`, y limpiar el histórico roto.

**Architecture:** Nuevo extractor `QAnalyticsCumplimientoIansaExtractor` (subclase de `QAnalyticsExtractor`, mismo patrón adapter que `cumplimiento_sap.py`/`cumplimiento_citas.py`, product `cumplimiento-iansa`). El mapeo de columnas del transformer de Mage se mueve a un módulo de config compartido (`utils/qanalytics_tenant_column_maps.py`) en vez de hardcodearse inline. `stg_qanalytics_trips.sql` se extiende (no se duplica) para incluir el nuevo product. El histórico roto de IANSA se borra explícitamente tras confirmar conteos.

**Tech Stack:** Python 3.11, Playwright (Firefox), FastAPI, pytest, Mage.ai (custom Python blocks), dbt (Postgres/Supabase).

## Global Constraints

- Ningún cambio a `qanalytics_agg_nro_sap_transformer.py` (transformer de Walmart) en este plan — queda documentado como backlog post-Hito 4 (ver spec).
- El DELETE de histórico (Task 8) requiere confirmación explícita del usuario en el momento de ejecutarlo — no se corre automáticamente como parte de un script no supervisado.
- Todo cambio a archivos de Mage se hace en la copia local sincronizada (`mcp__mage-agent__sync_project_to_local`) y se sube con `mcp__mage-agent__sync_local_to_remote` — nunca editar directo en la UI de Mage sin pasar por este flujo.
- `dbt/tms/models/silver/stg_qanalytics_trips.sql` es un modelo compartido con Walmart — cualquier edición se verifica con `dbt compile`/`dbt run` (o revisión manual del SQL compilado) antes de subir, para no romper el pipeline de Walmart.

---

### Task 1: Investigar en vivo el reporte real de IANSA

**Files:**
- Create: `extraction_service/scripts/inspect_iansa_report.py` (script de investigación, se deja en el repo como utilidad reproducible — no es parte del servicio productivo)
- Create: `docs/superpowers/plans/2026-08-07-iansa-report-findings.md` (hallazgos: columnas reales, mecanismo de exportación)

**Interfaces:**
- Consumes: `app.core.config.settings` (`QANALYTICS_URL`, `QANALYTICS_USER`, `QANALYTICS_PASS`) — ya existen en `.env`, no requiere cambios.
- Produces: `docs/superpowers/plans/2026-08-07-iansa-report-findings.md` con las columnas exactas de la tabla de resultados y el comportamiento confirmado de `#BtExportar`. Las Tasks 2, 4 y 5 leen este archivo como su fuente de verdad para nombres de columna.

- [ ] **Step 1: Escribir el script de investigación**

```python
# extraction_service/scripts/inspect_iansa_report.py
"""
Investiga en vivo el reporte real de IANSA en QAnalytics para confirmar
columnas de la tabla de resultados y el mecanismo de exportación.

Uso:
    cd extraction_service
    source venv/bin/activate
    python scripts/inspect_iansa_report.py

Requiere SODIMAC_* no, QANALYTICS_USER/PASS en .env (ya presentes).
No requiere conexión a la base de datos del servicio — solo Playwright.
"""
import asyncio

from playwright.async_api import async_playwright

from app.core.config import settings

TARGET_URL = (
    "https://www.qanalytics.cl/qnew/"
    "gestion_reporte_detalle_cumplimiento_iansa_trans.aspx"
)


async def main():
    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        context = await browser.new_context(accept_downloads=True, ignore_https_errors=True)
        page = await context.new_page()

        await page.goto(settings.QANALYTICS_URL, timeout=60000)
        await page.click("#Transporte")
        await page.fill("input[name='UsuarioT']", settings.QANALYTICS_USER)
        await page.fill("input[name='ContrasenaT']", settings.QANALYTICS_PASS)
        await page.fill("input[name='ClienteT']", "iansa")
        await page.click("#BtnTransporte")
        await page.wait_for_load_state("domcontentloaded", timeout=60000)

        await page.goto(TARGET_URL, timeout=60000)
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)

        # Setear un rango amplio (jQuery, igual que el resto de los extractors
        # qanalytics — .fill() directo no dispara el datetimepicker bindeado).
        await page.evaluate(
            """
            ([f1, f2]) => {
                jQuery("#txt_f1").val(f1).trigger("change");
                jQuery("#txt_f2").val(f2).trigger("change");
            }
            """,
            ["01-06-2026", "07-08-2026"],
        )
        await page.wait_for_timeout(500)

        await page.click("#btnImg")
        await page.wait_for_timeout(4000)
        await page.screenshot(path="/tmp/iansa_findings_table.png", full_page=True)

        with open("/tmp/iansa_findings.html", "w", encoding="utf-8") as f:
            f.write(await page.content())

        # Columnas de cualquier tabla de resultados visible (excluye el form)
        tables = await page.eval_on_selector_all(
            "table",
            """
            els => els.map(t => ({
                id: t.id,
                rows: t.rows.length,
                headers: t.rows.length > 0
                    ? Array.from(t.rows[0].cells).map(c => c.textContent.trim())
                    : []
            })).filter(t => t.rows > 0)
            """,
        )
        print("[tables con filas]", tables)

        # Intentar exportar y ver si dispara una descarga real
        try:
            async with page.expect_download(timeout=15000) as dl_info:
                await page.click("#BtExportar")
            download = await dl_info.value
            print("[export] descarga disparada:", download.suggested_filename)
            await download.save_as(f"/tmp/{download.suggested_filename}")
        except Exception as e:
            print("[export] NO disparó descarga directa:", repr(e))
            print("[export] URL tras click:", page.url)

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Correr el script**

Run: `cd extraction_service && source venv/bin/activate && python scripts/inspect_iansa_report.py`

Si `#btnImg` no dispara resultados o el flujo se cuelga (visto en esta sesión con un enfoque similar), reintentar reemplazando el `page.click("#btnImg")` por `await page.locator("#btnImg").click(force=True, timeout=15000)`, y si sigue sin dar filas, ampliar el rango de fechas (`"01-01-2026"` como `f1`) antes de asumir que la cuenta no tiene viajes en el período.

- [ ] **Step 3: Revisar `/tmp/iansa_findings_table.png` y la salida de `[tables con filas]`**

Confirmar manualmente (leyendo el screenshot) qué tabla es la de resultados reales (puede haber tablas de layout con `rows > 0` que no son la de datos) y anotar el `id`.

- [ ] **Step 4: Escribir los hallazgos**

Crear `docs/superpowers/plans/2026-08-07-iansa-report-findings.md` con:
- Lista exacta de columnas de la tabla de resultados (el `headers` de la tabla correcta).
- Si existe una columna equivalente a "Viaje" (identificador de viaje) para agrupar filas — de no existir, documentar qué columna cumple ese rol (ej. un ID de trip distinto).
- Si `#BtExportar` disparó una descarga directa (`page.expect_download`) o no — si no, describir qué pasó (¿navegó a otra URL? ¿abrió una vista imprimible?) y qué mecanismo alternativo usar (ej. capturar la tabla HTML igual que hace `cumplimiento_sap`/`cumplimiento_citas` vía el mismo link `onclick="exportar_tabla()"` si existe en esta página bajo otro nombre, o generar el archivo parseando el HTML de la tabla directamente con Playwright si no hay botón de export real).
- Formato de fecha/hora tal como aparece en las celdas (para saber si necesita el mismo parseo que el resto de qanalytics).

- [ ] **Step 5: Commit**

```bash
cd /Users/usuario/Desktop/projects/webcarga
git add extraction_service/scripts/inspect_iansa_report.py \
        docs/superpowers/plans/2026-08-07-iansa-report-findings.md
git commit -m "docs: hallazgos del reporte real de IANSA (QAnalytics)

Script de investigación + columnas confirmadas del Reporte Detalle,
insumo para el extractor nuevo (cumplimiento-iansa).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Extractor `QAnalyticsCumplimientoIansaExtractor`

**Files:**
- Create: `extraction_service/app/tms/qanalytics/cumplimiento_iansa.py`
- Create: `extraction_service/tests/test_qanalytics_cumplimiento_iansa.py`
- Modify: `extraction_service/app/tms/factory.py`

**Interfaces:**
- Consumes: `app.tms.qanalytics.scraper.QAnalyticsExtractor` (clase base — `_login`, `_handle_pendientes_modal_if_open`, `extract()` no se tocan), `app.tms.base.build_path`, columnas/comportamiento de `docs/superpowers/plans/2026-08-07-iansa-report-findings.md` (Task 1).
- Produces: clase `QAnalyticsCumplimientoIansaExtractor` con `PRODUCT_NAME = "cumplimiento-iansa"`, registrada en `factory.EXTRACTORS[("qanalytics", "cumplimiento-iansa")]`. Task 3 la consume vía la API HTTP (`POST /api/v1/jobs {"source":"qanalytics","product":"cumplimiento-iansa",...}`).

- [ ] **Step 1: Escribir el archivo del extractor**

```python
# extraction_service/app/tms/qanalytics/cumplimiento_iansa.py
import logging
import os
from datetime import date

from playwright.async_api import Page

from app.tms.base import build_path
from app.tms.qanalytics.scraper import DATE_FORMAT_APP, QAnalyticsExtractor

logger = logging.getLogger(__name__)

# IANSA vive en un tenant separado de QAnalytics (branding "mmPFQ S.A."),
# no bajo Módulo Distribución/Backhauls como el resto de clientes — la URL
# es fija, no templada por client_name. Confirmado en vivo 2026-08-07:
# alcanzable directo por goto() tras el login con ClienteT="iansa", sin
# pasar por ningún dropdown de módulo.
TARGET_URL = (
    "https://www.qanalytics.cl/qnew/"
    "gestion_reporte_detalle_cumplimiento_iansa_trans.aspx"
)

# Selectores propios de esta página — distintos de los otros 3 reportes
# qanalytics (Monitor de Viajes usa #txt_fecini/#txt_fecfin, SAP usa
# #txt_fecini/#txt_fin, Citas usa #txt_fecini/#txtFechaFin).
SEL_DATE_FROM_IANSA = "#txt_f1"
SEL_DATE_TO_IANSA = "#txt_f2"
SEL_BTN_BUSCAR_IANSA = "#btnImg"
SEL_BTN_EXPORT_IANSA = "#BtExportar"


class QAnalyticsCumplimientoIansaExtractor(QAnalyticsExtractor):
    """Extrae el Reporte Detalle de IANSA (tenant mmPFQ S.A. en QAnalytics).

    Reutiliza login y modal de pendientes del padre. Difiere en: URL fija
    (no templada), selectores de fecha, botón de búsqueda y mecanismo de
    exportación — las 4 páginas qanalytics soportadas hoy tienen los 4
    completamente distintos entre sí.
    """

    PRODUCT_NAME = "cumplimiento-iansa"

    async def _navigate_to_distribucion(
        self, page: Page, client_name: str, timeout_ms: int
    ) -> None:
        logger.info(f"[STEP nav] Navegando directo a {TARGET_URL}")
        await page.goto(TARGET_URL, timeout=timeout_ms)
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

    async def _set_date_range(self, page: Page, date_from: date, date_to: date) -> None:
        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        logger.info(f"[STEP dates] Seteando rango {from_str} → {to_str} (cumplimiento-iansa)")

        await page.evaluate(
            """
            ([fromStr, toStr]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#txt_f1').val(fromStr).trigger('change');
                jQuery('#txt_f2').val(toStr).trigger('change');
            }
            """,
            [from_str, to_str],
        )

        actual_from = await page.locator(SEL_DATE_FROM_IANSA).input_value()
        actual_to = await page.locator(SEL_DATE_TO_IANSA).input_value()
        if actual_from != from_str or actual_to != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango. Esperado={from_str}/{to_str}, "
                f"obtenido={actual_from}/{actual_to}"
            )

    async def _submit_search(self, page: Page, timeout_ms: int) -> None:
        """Click a #btnImg. A diferencia del padre (#btn_buscar), esta página
        NO expone un UpdatePanel XHR predecible por URL — se espera un tiempo
        fijo tras el click en vez de `expect_response` (confirmado necesario
        en la investigación de Task 1)."""
        logger.info("[STEP search] Click #btnImg")
        try:
            await page.locator(SEL_BTN_BUSCAR_IANSA).click(timeout=min(timeout_ms, 30_000))
            await page.wait_for_timeout(3000)
        except Exception:
            await self._safe_screenshot(page, "search_failed")
            raise

    async def _download_export(
        self,
        page: Page,
        client_name: str,
        timestamp: int,
        date_from: date,
        date_to: date,
        downloads_dir: str,
        timeout_ms: int,
    ) -> str:
        logger.info("[STEP export] Click #BtExportar")
        async with page.expect_download(timeout=timeout_ms) as download_info:
            await page.locator(SEL_BTN_EXPORT_IANSA).click(timeout=10000)
        download = await download_info.value

        ext = os.path.splitext(download.suggested_filename)[1] or ".xls"
        relative_path = build_path(
            source=self.SOURCE_NAME,
            product=self.PRODUCT_NAME,
            client=client_name,
            timestamp=timestamp,
            date_from=date_from,
            date_to=date_to,
            extension=ext,
        )
        local_file_path = os.path.join(downloads_dir, relative_path)
        os.makedirs(os.path.dirname(local_file_path), exist_ok=True)

        await download.save_as(local_file_path)
        logger.info(f"¡ÉXITO! Archivo descargado en: {local_file_path}")
        return local_file_path
```

**Antes de dar este paso por terminado**: si los hallazgos de Task 1 muestran que `#BtExportar` NO dispara una descarga directa (`page.expect_download` nunca resuelve), reemplazar `_download_export` por la estrategia alternativa documentada en `iansa-report-findings.md` (ej. parsear la tabla HTML directo con `page.content()` y guardarla como `.html`, igual formato que ya consume `pd.read_html()` en `processor_qanalytics_iansa_files.py`).

- [ ] **Step 2: Escribir los tests unitarios**

```python
# extraction_service/tests/test_qanalytics_cumplimiento_iansa.py
"""
Tests unitarios del extractor de IANSA (Reporte Detalle, tenant mmPFQ S.A.).

No requieren credenciales ni browser real. Correr con:
    cd extraction_service
    python -m pytest tests/test_qanalytics_cumplimiento_iansa.py -v
"""
import asyncio
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.tms.qanalytics.cumplimiento_iansa import (
    QAnalyticsCumplimientoIansaExtractor,
    SEL_BTN_EXPORT_IANSA,
    SEL_BTN_BUSCAR_IANSA,
    TARGET_URL,
)


class TestNavigateDirectUrl:
    def test_goto_called_with_fixed_url(self):
        """A diferencia de las otras 3 subclases, IANSA navega directo por
        goto() a una URL fija — no hay click a ningún dropdown de módulo."""
        page = MagicMock()
        page.goto = AsyncMock(return_value=None)
        page.wait_for_load_state = AsyncMock(return_value=None)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._navigate_to_distribucion(
                page, "iansa", 30_000
            )
        )

        page.goto.assert_called_once()
        called_url = page.goto.call_args[0][0]
        assert called_url == TARGET_URL


class TestSetDateRange:
    def test_sets_txt_f1_txt_f2_via_jquery(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value=None)

        locator_values = {"#txt_f1": "05-08-2026", "#txt_f2": "07-08-2026"}

        def _locator(sel):
            loc = AsyncMock()
            loc.input_value = AsyncMock(return_value=locator_values[sel])
            return loc

        page.locator = MagicMock(side_effect=_locator)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                page, date(2026, 8, 5), date(2026, 8, 7)
            )
        )

        page.evaluate.assert_called_once()
        js_arg, values_arg = page.evaluate.call_args[0]
        assert "#txt_f1" in js_arg and "#txt_f2" in js_arg
        assert values_arg == ["05-08-2026", "07-08-2026"]

    def test_raises_when_values_dont_match(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value=None)

        def _locator(sel):
            loc = AsyncMock()
            loc.input_value = AsyncMock(return_value="WRONG")
            return loc

        page.locator = MagicMock(side_effect=_locator)

        with pytest.raises(RuntimeError, match="No se pudo setear el rango"):
            asyncio.run(
                QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                    page, date(2026, 8, 5), date(2026, 8, 7)
                )
            )


class TestSubmitSearch:
    def test_clicks_btn_img_not_btn_buscar(self):
        """Esta página no tiene #btn_buscar (el de la clase base) — usa #btnImg."""
        page = MagicMock()
        btn = AsyncMock()
        clicked_selectors = []

        def _locator(sel):
            clicked_selectors.append(sel)
            return btn

        page.locator = MagicMock(side_effect=_locator)
        page.wait_for_timeout = AsyncMock(return_value=None)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._submit_search(page, timeout_ms=30_000)
        )

        assert SEL_BTN_BUSCAR_IANSA in clicked_selectors
        assert "#btn_buscar" not in clicked_selectors


class TestDownloadExport:
    def test_clicks_bt_exportar_and_saves_via_build_path(self):
        page = MagicMock()

        download = AsyncMock()
        download.suggested_filename = "reporte_iansa.xls"
        download.save_as = AsyncMock(return_value=None)

        class _DownloadCM:
            async def __aenter__(self):
                return self
            async def __aexit__(self, *a):
                return False
            @property
            def value(self):
                async def _v():
                    return download
                return _v()

        page.expect_download = MagicMock(return_value=_DownloadCM())
        btn = AsyncMock()
        clicked_selectors = []

        def _locator(sel):
            clicked_selectors.append(sel)
            return btn

        page.locator = MagicMock(side_effect=_locator)

        path = asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._download_export(
                page, "iansa", 1780000000, date(2026, 8, 5), date(2026, 8, 7),
                "/tmp/downloads", 30_000,
            )
        )

        assert SEL_BTN_EXPORT_IANSA in clicked_selectors
        assert "tms/qanalytics/cumplimiento-iansa/iansa/" in path
        download.save_as.assert_called_once()
```

**Nota**: `TestDownloadExport` asume que Task 1 confirmó que `#BtExportar` SÍ dispara `page.expect_download`. Si Task 1 documentó lo contrario, reescribir este test para la estrategia alternativa antes de continuar (no dejar un test que no refleja la implementación real).

- [ ] **Step 3: Correr los tests y verificar que pasan**

Run: `cd extraction_service && source venv/bin/activate && python -m pytest tests/test_qanalytics_cumplimiento_iansa.py -v`
Expected: todos PASS.

- [ ] **Step 4: Registrar en factory.py**

Modificar `extraction_service/app/tms/factory.py`:

```python
from app.tms.qanalytics.cumplimiento_citas import QAnalyticsCumplimientoCitasExtractor
from app.tms.qanalytics.cumplimiento_iansa import QAnalyticsCumplimientoIansaExtractor
from app.tms.qanalytics.cumplimiento_sap import QAnalyticsCumplimientoExtractor
from app.tms.qanalytics.scraper import QAnalyticsExtractor
from app.tms.sodimac.scraper import SodimacExtractor
from app.tms.wingsuite.scraper import WingsuiteExtractor

EXTRACTORS: dict[tuple[str, str], BaseTMSExtractor] = {
    ("qanalytics", "trips"): QAnalyticsExtractor(),
    ("qanalytics", "cumplimiento-sap"): QAnalyticsCumplimientoExtractor(),
    ("qanalytics", "cumplimiento-citas"): QAnalyticsCumplimientoCitasExtractor(),
    ("qanalytics", "cumplimiento-iansa"): QAnalyticsCumplimientoIansaExtractor(),
    ("wingsuite", "trips"): WingsuiteExtractor(),
    ("sodimac", "trips"): SodimacExtractor(),
}
```

- [ ] **Step 5: Correr toda la suite de extraction_service**

Run: `cd extraction_service && source venv/bin/activate && python -m pytest tests/ -v`
Expected: todos PASS (incluidos los tests existentes de `test_qanalytics_adapter.py`, que no deben romperse).

- [ ] **Step 6: Commit**

```bash
git add extraction_service/app/tms/qanalytics/cumplimiento_iansa.py \
        extraction_service/tests/test_qanalytics_cumplimiento_iansa.py \
        extraction_service/app/tms/factory.py
git commit -m "feat(extraction_service): extractor dedicado para IANSA (Reporte Detalle)

IANSA vive en un tenant separado de QAnalytics (mmPFQ S.A.), no en el
Monitor de Viajes genérico — nuevo product cumplimiento-iansa con
selectores propios (#txt_f1/#txt_f2, #btnImg, #BtExportar).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Deploy y smoke test contra el servicio real

**Files:**
- No se modifican archivos — este task despliega y verifica lo hecho en Task 2.

**Interfaces:**
- Consumes: `webcarga-extraction` en Cloud Run (deploy vía GitHub Actions, workflow `Deploy Extraction Service`), endpoint `POST /api/v1/jobs`.
- Produces: confirmación en vivo de que `("qanalytics","cumplimiento-iansa")` extrae un archivo válido. Task 4 usa el archivo descargado acá para confirmar las columnas reales antes de escribir el config de mapeo (cruzar contra los hallazgos de Task 1).

- [ ] **Step 1: Push a la rama actual para disparar el deploy**

```bash
git push
```

- [ ] **Step 2: Confirmar que el workflow terminó OK**

Run: `gh run list --workflow "Deploy Extraction Service" --limit 1 --json status,conclusion,createdAt`
Expected: `"status":"completed","conclusion":"success"` para el run más reciente (createdAt posterior al push del Step 1).

- [ ] **Step 3: Obtener la URL del servicio desplegado**

Run: `gh run view <run-id> --log 2>/dev/null | grep -i "https://webcarga-extraction"`

- [ ] **Step 4: Disparar un job de smoke test**

```bash
curl -s -X POST https://<url-del-servicio>/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{"source":"qanalytics","product":"cumplimiento-iansa","client_name":"smoketest-iansa","date_from":"2026-06-01","date_to":"2026-08-07"}' \
  | python3 -m json.tool
```

- [ ] **Step 5: Poll hasta done/failed**

```bash
JOB_ID=<job_id del step anterior>
for i in $(seq 1 24); do
  RESP=$(curl -s https://<url-del-servicio>/api/v1/jobs/$JOB_ID)
  STATUS=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
  echo "[$i] Status: $STATUS"
  [[ "$STATUS" == "done" || "$STATUS" == "failed" ]] && { echo "$RESP" | python3 -m json.tool; break; }
  sleep 10
done
```

Expected: `status: "done"`, con `result.gcs_uri` apuntando a `gs://sandbox-webcarga/tms/qanalytics/cumplimiento-iansa/smoketest-iansa/...`.

Si `status: "failed"`: leer `error` del resultado y revisar contra los hallazgos de Task 1 — el fallo más probable es que `_download_export` no funcione como se asumió (ver nota en Task 2 Step 1).

- [ ] **Step 6: Descargar y revisar el archivo crudo**

```bash
gsutil cp gs://sandbox-webcarga/tms/qanalytics/cumplimiento-iansa/smoketest-iansa/<filename> /tmp/iansa_smoketest_raw
```

Confirmar que el contenido tiene filas de datos reales (no vacío) y que las columnas coinciden con lo documentado en `iansa-report-findings.md`. Si no coinciden, actualizar ese archivo de hallazgos ANTES de pasar a Task 4.

- [ ] **Step 7: Limpiar el archivo de prueba**

```bash
gsutil rm gs://sandbox-webcarga/tms/qanalytics/cumplimiento-iansa/smoketest-iansa/<filename>
```

---

### Task 4: Config compartida de mapeo de columnas por tenant

**Files:**
- Create (en el repo local, luego sincronizar a Mage): `mage-sync/utils/qanalytics_tenant_column_maps.py`

**Interfaces:**
- Consumes: columnas reales confirmadas en `docs/superpowers/plans/2026-08-07-iansa-report-findings.md` (Task 1) y verificadas contra el archivo real de Task 3.
- Produces: `TENANT_COLUMN_MAPS: dict[str, dict[str, list[str]]]` con key `"iansa"` → `{"cols_viaje": [...], "cols_parada": [...]}`. Task 5 importa esto.

- [ ] **Step 1: Sincronizar Mage a local si no está ya sincronizado**

Usar `mcp__mage-agent__sync_project_to_local` (pipeline `batch_tms_monitor_trips`) si no hay una copia local vigente de esta sesión.

- [ ] **Step 2: Escribir el módulo de config**

```python
# mage-sync/utils/qanalytics_tenant_column_maps.py
"""
Mapeo de columnas esperadas por tenant para los transformers de QAnalytics.

Cada tenant de QAnalytics puede tener un reporte con columnas distintas
(confirmado: IANSA vive en un tenant separado — mmPFQ S.A. — con su propio
Reporte Detalle, columnas distintas al Monitor de Viajes genérico que usa
Walmart). Este módulo centraliza esa configuración para que agregar un
tenant nuevo sea un cambio de datos acá, no un archivo Python nuevo con
listas hardcodeadas — ver docs/superpowers/specs/2026-08-07-iansa-scraper-redesign-design.md,
sección Backlog, para el plan de migrar también al transformer de Walmart.
"""

TENANT_COLUMN_MAPS: dict[str, dict[str, list[str]]] = {
    "iansa": {
        # Columnas reales del Reporte Detalle — copiadas literal de
        # docs/superpowers/plans/2026-08-07-iansa-report-findings.md
        # (Task 1), confirmadas contra el archivo real de Task 3.
        "cols_viaje": [],
        "cols_parada": [],
        # Nombre de la columna que identifica el viaje (equivalente a
        # "Viaje" en el Monitor de Viajes genérico) — de findings.md.
        "trip_id_column": "",
    },
}
```

**Este Step no está completo hasta reemplazar los 3 valores vacíos** (`cols_viaje`, `cols_parada`, `trip_id_column`) por los reales de `iansa-report-findings.md` — es el único lugar del plan donde el contenido depende de un hallazgo externo (una página de un tercero que no existía forma de inspeccionar antes de Task 1). No continuar a Task 5 con estos campos vacíos: un `cols_viaje = []` silencioso haría que el transformer caiga al mismo bug que se está arreglando (colapsar todos los viajes en `unknown_trip`).

- [ ] **Step 3: Confirmar que `utils/__init__.py` existe (paquete importable)**

Run: `ls mage-sync/utils/__init__.py` — ya existe (confirmado vacío, no requiere cambios).

- [ ] **Step 4: Sincronizar a Mage remoto**

Usar `mcp__mage-agent__sync_local_to_remote` para subir `utils/qanalytics_tenant_column_maps.py`.

---

### Task 5: Reescribir el transformer de IANSA para usar la config

**Files:**
- Modify: `mage-sync/custom/qanalytics_agg_iansa_transformer.py`
- Modify: `mage-sync/custom/qanalytics_endpoint_scraper_iansa.py`
- Modify: `mage-sync/data_loaders/processor_qanalytics_iansa_files.py`

**Interfaces:**
- Consumes: `utils.qanalytics_tenant_column_maps.TENANT_COLUMN_MAPS["iansa"]` (Task 4).
- Produces: mismo contrato de salida que antes (`DataFrame` con columnas `tms_name, product, source_client, file_name, mage_run_id, payload`) — Task 6 (dbt) sigue leyendo `bronze.tms_trips`/`tms_trips_snapshot` sin cambios de shape acá.

- [ ] **Step 1: Modificar el bloque scraper — nuevo product**

En `custom/qanalytics_endpoint_scraper_iansa.py`, el payload actual es:

```python
    payload = {
        "source":      "qanalytics",
        "product":     "trips",
        "client_name": CLIENT_NAME,
        "date_from":   date_from_str,
        "date_to":     date_to_str,
        "timeout_ms":  180000,
    }
```

Cambiar la línea `"product": "trips",` por:

```python
        "product":     "cumplimiento-iansa",
```

El resto del bloque (polling, manejo de `status == 'failed'`, timeout) no cambia.

- [ ] **Step 2: Modificar el loader — prefijo GCS**

En `data_loaders/processor_qanalytics_iansa_files.py`, cambiar:

```python
    prefix = 'tms/qanalytics/trips/iansa/' # Ajusta la carpeta raíz a buscar
```

por:

```python
    prefix = 'tms/qanalytics/cumplimiento-iansa/iansa/'
```

- [ ] **Step 3: Reescribir el transformer para leer la config**

En `custom/qanalytics_agg_iansa_transformer.py`, reemplazar las líneas hardcodeadas:

```python
    cols_viaje_esperadas  = ['Viaje', 'Origen', 'FH Planifica', 'Transporte', 'Patente', 'Conductor', 'Tipo Viaje']
    cols_parada_esperadas = ['FH Llegada Tr', 'FH Salida Tr', 'FH Llegada Gps', 'Ini Descarga', 'Fin Descarga', 'FH Salida Gps', 'T°','Estado Rendicion','Fecha Rendicion','Destino','Entrega']
```

por:

```python
    from utils.qanalytics_tenant_column_maps import TENANT_COLUMN_MAPS

    tenant_map = TENANT_COLUMN_MAPS["iansa"]
    cols_viaje_esperadas  = tenant_map["cols_viaje"]
    cols_parada_esperadas = tenant_map["cols_parada"]
    trip_id_col = tenant_map["trip_id_column"]
```

Y reemplazar toda referencia literal a `'Viaje'` como columna de agrupación (líneas donde hace `data.groupby('_gcs_uri')['Viaje']` y el chequeo `if 'Viaje' in data.columns`) por `trip_id_col`:

```python
    if trip_id_col in data.columns:
        data[trip_id_col] = data[trip_id_col].replace('', np.nan)
        data['ViajeP'] = (
            data.groupby('_gcs_uri')[trip_id_col]
            .ffill()
            .astype(str)
            .str.replace(r'\.0$', '', regex=True)
        )
    else:
        data[trip_id_col] = 'unknown_trip'
```

y más abajo, en el `for (gcs_uri, trip_number), df_group in data.groupby(['_gcs_uri', 'Viaje']):`, cambiar `'Viaje'` por `trip_id_col`.

- [ ] **Step 4: Sincronizar a Mage remoto**

Usar `mcp__mage-agent__sync_local_to_remote` para subir los 3 archivos modificados.

- [ ] **Step 5: Verificar sync limpio**

Usar `mcp__mage-agent__sync_status` y confirmar que no quedan diffs pendientes para estos 3 archivos.

- [ ] **Step 6: Commit local (referencia — Mage no versiona con git, esto es para el repo espejo si existe)**

Si `mage-sync/` vive dentro del repo de `webcarga` (confirmar con `git status` en esa ruta), comittear igual que los demás cambios de esta sesión. Si es un directorio fuera del repo git (scratchpad de sesión), omitir este step — el registro de qué se cambió queda en el AGENTLOG al cierre.

---

### Task 6: Extender `stg_qanalytics_trips.sql`

**Files:**
- Modify: `mage-sync/dbt/tms/models/silver/stg_qanalytics_trips.sql`

**Interfaces:**
- Consumes: `bronze.tms_trips_snapshot` con `product = 'cumplimiento-iansa'` (poblado por Task 3/5), columnas reales confirmadas en Task 1.
- Produces: filas IANSA con `raw_estado` no-NULL en `stg_qanalytics_trips` — Task 8 verifica esto contra Supabase real.

- [ ] **Step 1: Extender el filtro de product**

En la CTE `snapshot_ranked`, cambiar:

```sql
    FROM {{ ref('tms_trips_snapshot') }}
    WHERE tms_name = 'qanalytics'
      AND product  = 'trips'
```

por:

```sql
    FROM {{ ref('tms_trips_snapshot') }}
    WHERE tms_name = 'qanalytics'
      AND product  IN ('trips', 'cumplimiento-iansa')
```

- [ ] **Step 2: Extender los COALESCE de `trips_metadata`/`stops_enriched` con las columnas reales de IANSA**

Usando las columnas confirmadas en `docs/superpowers/plans/2026-08-07-iansa-report-findings.md`, extender cada COALESCE existente para intentar primero la columna de Walmart y luego (fallback) la columna equivalente real de IANSA — **no** agregar una rama `CASE WHEN source_client = 'iansa'`, seguir el mismo principio genérico ya documentado en el archivo (ver comentario existente sobre `raw_origen_fallback`). Ejemplo de la forma esperada (columnas exactas a completar con el hallazgo real):

```sql
        COALESCE(
            snap.payload->'trip_metadata'->>'Estado',
            snap.payload->'trip_metadata'->>'<columna real de estado en IANSA>'
        )                                                              AS raw_estado,
```

Repetir para cualquier otro campo donde IANSA tenga un nombre de columna distinto al de Walmart (fecha de planificación, transporte, patente, conductor) — cruzar cada uno contra el hallazgo real de Task 1, no asumir que coincide con el patrón `Origen`/`Destino` ya documentado para el reporte viejo (ese fallback era para la página incorrecta, puede no aplicar a la página nueva).

- [ ] **Step 3: Compilar el modelo para detectar errores de sintaxis antes de subir**

Si hay acceso a `dbt compile` local contra el proyecto sincronizado, correrlo. Si no, revisar manualmente que el SQL resultante sea válido (paréntesis balanceados, comas correctas) antes de sincronizar — un error de sintaxis acá rompe el pipeline de Walmart también, dado que es un modelo compartido (ver Global Constraints).

- [ ] **Step 4: Sincronizar a Mage remoto**

Usar `mcp__mage-agent__sync_local_to_remote`.

---

### Task 7: Confirmar con el usuario y ejecutar la limpieza de histórico

**Files:**
- No se modifican archivos de código — este task ejecuta SQL directo contra Supabase.

**Interfaces:**
- Consumes: tablas `bronze.tms_trips`, `bronze.tms_trips_snapshot`, `app.trip_stops`, `app.trips` (proyecto Supabase `viclzoftiudkepqnhekv`).
- Produces: histórico IANSA (`product='trips'`, fuente incorrecta) eliminado. Task 8 corre el pipeline y verifica que se repuebla correcto.

- [ ] **Step 1: Conteos ANTES del borrado**

```sql
SELECT 'bronze.tms_trips' AS tabla, count(*) FROM bronze.tms_trips
  WHERE tms_name='qanalytics' AND source_client='iansa' AND product='trips'
UNION ALL
SELECT 'bronze.tms_trips_snapshot', count(*) FROM bronze.tms_trips_snapshot
  WHERE tms_name='qanalytics' AND source_client='iansa' AND product='trips'
UNION ALL
SELECT 'app.trips', count(*) FROM app.trips
  WHERE source_system='qanalytics' AND client_name='iansa'
UNION ALL
SELECT 'app.trip_stops', count(*) FROM app.trip_stops
  WHERE trip_id IN (SELECT id FROM app.trips WHERE source_system='qanalytics' AND client_name='iansa');
```

Guardar estos conteos — se comparan en Step 3.

- [ ] **Step 2: PARAR y pedir confirmación explícita al usuario**

Mostrar los conteos del Step 1 y esperar un "sí, procede" explícito antes de correr cualquier DELETE — no continuar automáticamente, sin importar qué tan claro parezca el plan en este documento (mismo criterio que el DELETE de `trip_stops` huérfanos de la ronda anterior).

- [ ] **Step 3: Ejecutar el DELETE (solo tras confirmación)**

```sql
DELETE FROM app.trip_stops
  WHERE trip_id IN (
    SELECT id FROM app.trips WHERE source_system = 'qanalytics' AND client_name = 'iansa'
  );

DELETE FROM app.trips
  WHERE source_system = 'qanalytics' AND client_name = 'iansa';

DELETE FROM bronze.tms_trips
  WHERE tms_name = 'qanalytics' AND source_client = 'iansa' AND product = 'trips';

DELETE FROM bronze.tms_trips_snapshot
  WHERE tms_name = 'qanalytics' AND source_client = 'iansa' AND product = 'trips';
```

- [ ] **Step 4: Conteos DESPUÉS — deben ser 0 en las 4 tablas**

Repetir la query del Step 1. Expected: `count = 0` en las 4 filas.

---

### Task 8: Repoblar y verificar end-to-end

**Files:**
- No se modifican archivos — verificación final.

**Interfaces:**
- Consumes: pipeline `batch_tms_monitor_trips` (bloques modificados en Tasks 5-6), Supabase real.

- [ ] **Step 1: Confirmar con el usuario si se corre el pipeline completo ahora o se espera la corrida programada**

El bloque `qanalytics_endpoint_scraper_iansa` corre dentro de `batch_tms_monitor_trips` — no usar `run_block`/`execute_pipeline` sin confirmar con el usuario primero (ver `reference_mage_run_block_broken.md` — este bloque específico de ejecución vía API viene fallando en rondas anteriores; puede requerir que el usuario lo corra manualmente desde la UI de Mage).

- [ ] **Step 2: Tras la corrida, verificar `bronze.tms_trips` repoblado**

```sql
SELECT count(*), min(last_updated_at), max(last_updated_at)
FROM bronze.tms_trips
WHERE tms_name='qanalytics' AND source_client='iansa' AND product='cumplimiento-iansa';
```

Expected: `count > 0`.

- [ ] **Step 3: Verificar `raw_estado` no-NULL en `stg_qanalytics_trips`**

Correr contra Supabase (la vista `silver.stg_qanalytics_trips` refleja el modelo dbt actualizado tras el `dbt run`):

```sql
SELECT count(*) FILTER (WHERE raw_estado IS NOT NULL) AS con_estado,
       count(*) AS total
FROM silver.stg_qanalytics_trips
WHERE source_client = 'iansa';
```

Expected: `con_estado = total` (o muy cercano — a diferencia del 100% NULL de antes del fix).

- [ ] **Step 4: Verificar `app.trips` repoblado**

```sql
SELECT count(*), count(*) FILTER (WHERE trip_status IS NOT NULL) AS con_status
FROM app.trips
WHERE source_system = 'qanalytics' AND client_name = 'iansa';
```

Expected: `count > 0` y `con_status = count`.

- [ ] **Step 5: Confirmar en el Diario**

Verificar visualmente (o vía `GET /api/v1/trips?client_name=iansa`) que al menos un viaje IANSA aparece con estado correcto, no `NULL`/vacío.

---

## Resumen de tasks

1. Investigar en vivo el reporte real de IANSA → hallazgos documentados.
2. Extractor `QAnalyticsCumplimientoIansaExtractor` + tests unitarios + registro en factory.
3. Deploy + smoke test contra el servicio real.
4. Config compartida `TENANT_COLUMN_MAPS` (solo entrada IANSA).
5. Reescribir transformer/scraper-block/loader de Mage para IANSA.
6. Extender `stg_qanalytics_trips.sql`.
7. Confirmar con el usuario y ejecutar limpieza de histórico.
8. Repoblar y verificar end-to-end.
