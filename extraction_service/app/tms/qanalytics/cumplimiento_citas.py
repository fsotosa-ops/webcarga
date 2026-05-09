from datetime import date

from playwright.async_api import Page

from app.tms.qanalytics.scraper import DATE_FORMAT_APP, QAnalyticsExtractor

# URL del "Reporte Cumplimiento Citas" bajo Módulo Backhauls.
# Confirmado inspeccionando el DOM post-login (2026-05-08).
HREF_CUMPLIMIENTO_CITAS = "gestion_reporte_cumplimiento_citas_back_transporte_walmart.aspx"

# Selector de fecha fin — esta página usa #txtFechaFin (camelCase), distinto
# de Monitor de Viajes (#txt_fecfin) y Cumplimiento SAP (#txt_fin).
# Confirmado en /tmp/qanalytics_fatal.html (2026-05-09).
SEL_DATE_TO_CITAS = "#txtFechaFin"


class QAnalyticsCumplimientoCitasExtractor(QAnalyticsExtractor):
    """Extrae el Reporte Cumplimiento Citas de QAnalytics (Módulo Backhauls).

    Reutiliza login, modal de pendientes y export del padre.
    Difiere en: módulo de navegación (Backhauls vs Distribución) y URL.
    """

    PRODUCT_NAME = "cumplimiento-citas"

    async def _navigate_to_distribucion(self, page: Page) -> None:
        await page.click('a.dropdown-toggle.NavQA >> text="Módulo Backhauls"')
        await page.click(f'a[href="{HREF_CUMPLIMIENTO_CITAS}"]')

    async def _set_date_range(self, page: Page, date_from: date, date_to: date) -> None:
        import logging
        logger = logging.getLogger(__name__)

        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        logger.info(f"[STEP dates] Seteando rango {from_str} → {to_str} (cumplimiento-citas)")

        await page.evaluate(
            """
            ([fromStr, toStr]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#txt_fecini').val(fromStr).trigger('change');
                jQuery('#txtFechaFin').val(toStr).trigger('change');
            }
            """,
            [from_str, to_str],
        )

        actual_from = await page.locator("#txt_fecini").input_value()
        actual_to = await page.locator(SEL_DATE_TO_CITAS).input_value()
        if actual_from != from_str or actual_to != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango. Esperado={from_str}/{to_str}, "
                f"obtenido={actual_from}/{actual_to}"
            )
