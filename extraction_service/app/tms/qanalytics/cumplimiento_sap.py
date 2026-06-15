from datetime import date

from playwright.async_api import Page

from app.tms.qanalytics.scraper import DATE_FORMAT_APP, QAnalyticsExtractor

# Plantilla de URL del "Reporte Cumplimiento SAP" bajo Módulo Distribución.
# Se formatea con client_name.lower() en tiempo de ejecución.
HREF_CUMPLIMIENTO_TMPL = "gestion_reporte_cumplimiento_sap_dist_transporte_{client}.aspx"

# Selector de fecha fin en esta página — difiere del Monitor de Viajes
# que usa #txt_fecfin. Confirmado en HTML dump /tmp/qanalytics_fatal.html.
SEL_DATE_TO_CUMPLIMIENTO = "#txt_fin"


class QAnalyticsCumplimientoExtractor(QAnalyticsExtractor):
    """Extrae el Reporte Cumplimiento SAP de QAnalytics.

    Reutiliza login, modal de pendientes y export del padre.
    Difiere en: URL de navegación y selector de fecha fin (#txt_fin vs #txt_fecfin).
    """

    PRODUCT_NAME = "cumplimiento-sap"

    async def _navigate_to_distribucion(
        self, page: Page, client_name: str, timeout_ms: int
    ) -> None:
        href = HREF_CUMPLIMIENTO_TMPL.format(client=client_name)
        await page.click('a.dropdown-toggle.NavQA >> text="Módulo Distribución"')
        await page.click(f'a[href="{href}"]')
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

    async def _set_date_range(self, page: Page, date_from: date, date_to: date) -> None:
        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        import logging
        logger = logging.getLogger(__name__)
        logger.info(f"[STEP dates] Seteando rango {from_str} → {to_str} (cumplimiento-sap)")

        await page.evaluate(
            """
            ([fromStr, toStr]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#txt_fecini').val(fromStr).trigger('change');
                jQuery('#txt_fin').val(toStr).trigger('change');
            }
            """,
            [from_str, to_str],
        )

        actual_from = await page.locator("#txt_fecini").input_value()
        actual_to = await page.locator(SEL_DATE_TO_CUMPLIMIENTO).input_value()
        if actual_from != from_str or actual_to != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango. Esperado={from_str}/{to_str}, "
                f"obtenido={actual_from}/{actual_to}"
            )
