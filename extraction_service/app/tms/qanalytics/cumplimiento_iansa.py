import logging
import os
from datetime import date

from playwright.async_api import Page

from app.tms.base import build_path
from app.tms.qanalytics.scraper import DATE_FORMAT_APP, QAnalyticsExtractor

logger = logging.getLogger(__name__)

# El "Reporte Detalle" de IANSA vive bajo el dropdown "Reportes" — no bajo
# "Módulo Distribución" (Monitor de Viajes, Cumplimiento SAP) ni "Módulo
# Backhauls" (Cumplimiento Citas). IANSA es un tenant separado de QAnalytics
# (branding "mmPFQ S.A."), con su propio árbol de menú.
#
# La navegación es por CLICK DE MENÚ y no por `page.goto()` directo a propósito:
# el login dispara un redirect asíncrono y un goto() lanzado antes de que
# termine es bounceado a inicioQMGPS.aspx (race real, reproducida 2026-08-07).
HREF_REPORTE_DETALLE = "gestion_reporte_detalle_cumplimiento_iansa_trans.aspx"

# Selectores propios de esta página. Los otros 3 reportes qanalytics usan
# #txt_fecini + (#txt_fecfin | #txt_fin | #txtFechaFin); acá son otros.
SEL_DATE_FROM_IANSA = "#txt_f1"
SEL_DATE_TO_IANSA = "#txt_f2"
SEL_BTN_BUSCAR_IANSA = "#btnImg"
SEL_BTN_EXPORT_IANSA = "#BtExportar"

# Tras el partial postback, el evento de response llega con los headers — no
# con el DOM ya re-renderizado. Sin este settle, el export puede dispararse
# antes de que la grilla termine de actualizarse.
SEARCH_SETTLE_MS = 3000


class QAnalyticsCumplimientoIansaExtractor(QAnalyticsExtractor):
    """Extrae el Reporte Detalle de IANSA (tenant mmPFQ S.A. de QAnalytics).

    Reutiliza login y modal de pendientes del padre. Sobreescribe los cuatro
    pasos restantes porque esta página difiere en todos: menú de navegación,
    selectores de fecha, mecanismo de búsqueda y mecanismo de exportación.

    Nota sobre `page.evaluate` vs. locators: los controles de esta página
    fallan las comprobaciones de "actionability" de Playwright — `fill()` e
    `input_value()` sobre #txt_f1/#txt_f2 cuelgan hasta timeoutear, aunque
    una lectura cruda por JS los resuelve al instante (verificado 2026-08-07).
    Por eso se lee y se escribe por JS en vez de por locator.
    """

    PRODUCT_NAME = "cumplimiento-iansa"

    async def _navigate_to_distribucion(
        self, page: Page, client_name: str, timeout_ms: int
    ) -> None:
        # Dejar que el redirect post-login termine antes de tocar el menú.
        await page.wait_for_timeout(2000)
        logger.info(f"[STEP nav] Menú Reportes → {HREF_REPORTE_DETALLE}")
        await page.click('a.dropdown-toggle.NavQA >> text="Reportes"')
        await page.click(f'a[href="{HREF_REPORTE_DETALLE}"]')
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

    async def _set_date_range(self, page: Page, date_from: date, date_to: date) -> None:
        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        logger.info(
            f"[STEP dates] Seteando rango {from_str} → {to_str} (cumplimiento-iansa)"
        )

        # Escritura Y verificación en una sola llamada JS — ver docstring de
        # la clase sobre por qué no se usa locator().input_value() acá.
        actual = await page.evaluate(
            """
            ([fromStr, toStr]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#txt_f1').val(fromStr).trigger('change');
                jQuery('#txt_f2').val(toStr).trigger('change');
                const a = document.getElementById('txt_f1');
                const b = document.getElementById('txt_f2');
                return {from: a ? a.value : null, to: b ? b.value : null};
            }
            """,
            [from_str, to_str],
        )

        if actual.get("from") != from_str or actual.get("to") != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango. Esperado={from_str}/{to_str}, "
                f"obtenido={actual.get('from')}/{actual.get('to')}"
            )

    async def _submit_search(self, page: Page, timeout_ms: int) -> None:
        """Click a #btnImg y espera el partial postback del UpdatePanel.

        A diferencia del Monitor de Viajes (#btn_buscar), esta página NO
        recarga: dispara un POST AJAX a la misma .aspx. `expect_navigation`
        nunca resuelve; `expect_response` resuelve en ~0.4s.
        """
        logger.info("[STEP search] Click #btnImg — esperando partial postback")
        try:
            async with page.expect_response(
                lambda r: ".aspx" in r.url
                and r.request.method == "POST"
                and r.status == 200,
                timeout=min(timeout_ms, 60_000),
            ):
                await page.evaluate(
                    "document.getElementById('btnImg').click()"
                )
            await page.wait_for_timeout(SEARCH_SETTLE_MS)
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
        """Click a #BtExportar (botón submit) — dispara una descarga real.

        El archivo se llama "Reporte Detalle.xls" pero su contenido es HTML
        compatible con Excel (una `<table>` plana), que es exactamente lo que
        `pd.read_html()` consume aguas abajo en Mage. El export trae el set
        completo filtrado, no la página visible de la grilla (que sí está
        paginada, ~7 filas) — no hay que iterar páginas.
        """
        logger.info("[STEP export] Click #BtExportar")
        async with page.expect_download(timeout=timeout_ms) as download_info:
            await page.evaluate("document.getElementById('BtExportar').click()")
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
