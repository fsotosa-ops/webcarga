import os
import logging
import time
from datetime import date
from typing import Optional

from playwright.async_api import (
    Page,
    async_playwright,
    TimeoutError as PlaywrightTimeoutError,
)

from app.tms.base import BaseTMSExtractor, ExtractionArtifact, build_path
from app.core.config import settings

logger = logging.getLogger(__name__)


# Selectores que dependen del HTML de QAnalytics — concentrados acá para que
# cualquier cambio del proveedor sea un solo punto de edición.
SEL_DATE_FROM = "#txt_fecini"
SEL_DATE_TO = "#txt_fecfin"
SEL_BTN_BUSCAR = "#btn_buscar"
SEL_BTN_EXPORT = 'a[onclick*="exportar_tabla"]'
SEL_MODAL_PENDIENTES = "#modal_pendiente"
SEL_MODAL_CHECKBOXES = '#modal_pendiente input[type="checkbox"][id^="PTO_"]'
SEL_MODAL_CERRAR = '#modal_pendiente .modal-footer button:has-text("Cerrar")'

# Formato que espera el datetimepicker de QAnalytics (ver qanalytics.html:915-916)
DATE_FORMAT_APP = "%d-%m-%Y"


class QAnalyticsExtractor(BaseTMSExtractor):
    SOURCE_NAME = "qanalytics"
    # "trips" es el nombre canónico del producto de datos — compartido con
    # wingsuite y cualquier futuro TMS que exponga viajes. La nomenclatura
    # interna de QAnalytics ("monitor-trips") queda como detalle de implementación.
    PRODUCT_NAME = "trips"

    async def extract(
        self,
        *,
        client_name: str,
        date_from: Optional[date],
        date_to: Optional[date],
        timeout_ms: int,
    ) -> ExtractionArtifact:
        # QAnalytics filtra por rango — si no llegan fechas, es un input inválido
        # para este TMS (solo sodimac acepta None).
        if date_from is None or date_to is None:
            raise ValueError(
                f"{self.SOURCE_NAME} requiere date_from y date_to."
            )

        # Timestamp Unix fijado UNA SOLA VEZ al inicio — todos los paths
        # derivados (local + GCS) lo comparten para que coincidan.
        ts = int(time.time())

        logger.info(
            f"Iniciando extracción QAnalytics — cliente={client_name} "
            f"desde={date_from.isoformat()} hasta={date_to.isoformat()} "
            f"ts={ts}"
        )

        downloads_dir = os.path.join(os.getcwd(), "downloads")
        os.makedirs(downloads_dir, exist_ok=True)

        async with async_playwright() as p:
            browser = await p.firefox.launch(headless=settings.BROWSER_HEADLESS)
            context = await browser.new_context(
                accept_downloads=True,
                ignore_https_errors=True,
            )
            page = await context.new_page()

            # Listeners de diagnóstico — útiles cuando el sitio tira errores JS
            page.on(
                "console",
                lambda msg: logger.info(f"[browser console] {msg.type}: {msg.text}"),
            )
            page.on(
                "pageerror",
                lambda exc: logger.error(f"[browser pageerror] {exc}"),
            )

            try:
                await self._login(page, client_name, timeout_ms)
                await self._navigate_to_distribucion(page)

                # La página abre #modal_pendiente automáticamente al cargar si hay
                # gestiones pendientes. Hay que procesarlo antes de tocar nada más.
                await self._handle_pendientes_modal_if_open(page, label="auto-load")

                # Aplicar el rango de fechas pedido por el usuario
                await self._set_date_range(page, date_from, date_to)
                await self._submit_search(page)

                # Tras filtrar puede aparecer otra vez el modal de pendientes
                await self._handle_pendientes_modal_if_open(page, label="post-filter")

                local_path = await self._download_export(
                    page,
                    client_name,
                    ts,
                    date_from,
                    date_to,
                    downloads_dir,
                    timeout_ms,
                )
                return ExtractionArtifact(
                    local_path=local_path,
                    source=self.SOURCE_NAME,
                    product=self.PRODUCT_NAME,
                    client_name=client_name,
                    timestamp=ts,
                    date_from=date_from,
                    date_to=date_to,
                )

            except Exception as e:
                await self._safe_screenshot(page, "fatal")
                logger.error(f"Error en el proceso: {e}")
                raise
            finally:
                await browser.close()

    # ------------------------------------------------------------------ #
    # Pasos del flujo
    # ------------------------------------------------------------------ #

    async def _login(self, page: Page, client_name: str, timeout_ms: int) -> None:
        await page.goto(settings.QANALYTICS_URL, timeout=timeout_ms)
        await page.click("#Transporte")
        await page.fill("input[name='UsuarioT']", settings.QANALYTICS_USER)
        await page.fill("input[name='ContrasenaT']", settings.QANALYTICS_PASS)
        await page.fill("input[name='ClienteT']", client_name)
        await page.click("#BtnTransporte")

    async def _navigate_to_distribucion(self, page: Page) -> None:
        await page.click('a.dropdown-toggle.NavQA >> text="Módulo Distribución"')
        await page.click(
            'a[href="gestion_planificacion_programados_dist_transporte_walmart.aspx"]'
        )

    async def _set_date_range(
        self, page: Page, date_from: date, date_to: date
    ) -> None:
        """
        Setea los inputs de fecha. Los inputs tienen un jQuery datetimepicker bindeado
        (qanalytics.html:915-916), por lo que es más confiable hacerlo via jQuery
        (`.val(...).trigger('change')`) que via `page.fill()`: el plugin lee desde su
        propio estado interno cuando se dispara el postback.
        """
        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        logger.info(f"[STEP dates] Seteando rango {from_str} → {to_str}")

        await page.evaluate(
            """
            ([fromStr, toStr]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#txt_fecini').val(fromStr).trigger('change');
                jQuery('#txt_fecfin').val(toStr).trigger('change');
            }
            """,
            [from_str, to_str],
        )

        # Confirmación: leer los valores efectivos
        actual_from = await page.locator(SEL_DATE_FROM).input_value()
        actual_to = await page.locator(SEL_DATE_TO).input_value()
        if actual_from != from_str or actual_to != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango de fechas. "
                f"Esperado={from_str}/{to_str}, obtenido={actual_from}/{actual_to}"
            )

    async def _submit_search(self, page: Page) -> None:
        """
        Click a #btn_buscar para que la app aplique el filtro de fechas.
        Solo es seguro hacerlo si el modal de pendientes NO está visible (Bootstrap
        pone un backdrop encima que bloquea el click).
        """
        logger.info("[STEP search] Click #btn_buscar para aplicar filtro de fechas")
        try:
            await page.locator(SEL_BTN_BUSCAR).click(timeout=15000)
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
        """
        Click al botón real de exportación (`onclick="exportar_tabla()"`,
        qanalytics.html:450). Genera un .xls vía el plugin jQuery table2excel.

        El path local se construye con `build_path` para mantener una ÚNICA
        fuente de verdad compartida con el blob de GCS (ver `app.tms.base`).
        """
        logger.info("[STEP export] Click botón de exportación")
        async with page.expect_download(timeout=timeout_ms) as download_info:
            await page.locator(SEL_BTN_EXPORT).click(timeout=10000)
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

    # ------------------------------------------------------------------ #
    # Manejo del modal "Gestiones Pendientes"
    # ------------------------------------------------------------------ #

    async def _handle_pendientes_modal_if_open(
        self, page: Page, label: str
    ) -> None:
        """
        Procesa el modal si está visible. Si no aparece en 5s, asume que no hay
        gestiones pendientes en este momento y retorna silenciosamente.

        El modal exige que TODOS los registros estén marcados (`txtchkGP == txtcantidadGP`)
        antes de permitir cerrarlo via `valida_GP()`. Por eso marcamos todos los
        checkboxes Y sincronizamos los contadores ocultos a mano.
        """
        modal = page.locator(SEL_MODAL_PENDIENTES)
        try:
            await modal.wait_for(state="visible", timeout=5000)
        except PlaywrightTimeoutError:
            logger.info(f"[modal:{label}] No hay modal abierto, sigo.")
            return

        logger.info(f"[modal:{label}] Modal abierto. Procesando…")

        # Hook window.alert para capturar mensajes de valida_GP() (si fallara la
        # validación, en lugar de un Timeout opaco vamos a poder leer el mensaje).
        await page.evaluate(
            "window.__lastAlert = null;"
            "window.alert = (msg) => { window.__lastAlert = msg; };"
        )

        # Esperar a que la tabla esté poblada con al menos un checkbox PTO_.
        try:
            await page.wait_for_function(
                f"document.querySelectorAll({SEL_MODAL_CHECKBOXES!r}).length > 0",
                timeout=20000,
            )
        except PlaywrightTimeoutError:
            await self._safe_screenshot(page, f"modal_{label}_no_checkboxes")
            raise RuntimeError(
                f"[modal:{label}] El modal abrió pero no aparecieron checkboxes PTO_."
            )

        # Marcar todos via locator.check() (más estable que chk.checked = true:
        # Playwright respeta actionability y dispara eventos nativos).
        checkboxes = page.locator(SEL_MODAL_CHECKBOXES)
        n = await checkboxes.count()
        logger.info(f"[modal:{label}] Marcando {n} checkbox(es)…")
        for i in range(n):
            await checkboxes.nth(i).check(timeout=5000)

        # Sincronizar contadores ocultos que valida_GP() exige
        # (txtchkGP == txtcantidadGP). Sin esto el botón Cerrar dispara un alert.
        state = await page.evaluate(
            """
            () => {
                const root = document.querySelector('#modal_pendiente');
                const checkboxes = root.querySelectorAll(
                    'input[type="checkbox"][id^="PTO_"]'
                );
                let marked = 0;
                checkboxes.forEach(chk => {
                    if (!chk.checked) {
                        chk.checked = true;
                        chk.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                    if (chk.checked) marked++;
                });
                const total = checkboxes.length;
                const txtChk = document.getElementById('txtchkGP');
                const txtCant = document.getElementById('txtcantidadGP');
                if (txtChk) txtChk.value = String(total);
                if (txtCant && txtCant.value !== String(total)) txtCant.value = String(total);
                const lbChk = document.getElementById('lb_chk');
                if (lbChk) lbChk.innerHTML = 'Total Seleccionados : ' + String(total);
                return { marked, total };
            }
            """
        )
        logger.info(f"[modal:{label}] Estado tras marcar: {state}")
        if not state or state.get("marked", 0) == 0:
            await self._safe_screenshot(page, f"modal_{label}_marked_zero")
            raise RuntimeError(
                f"[modal:{label}] No se logró marcar checkboxes. Estado: {state}"
            )

        # Click Cerrar
        await page.locator(SEL_MODAL_CERRAR).click(timeout=10000)

        # Esperar al cierre real. Si falla, el alert hookeado tiene el motivo.
        try:
            await modal.wait_for(state="hidden", timeout=10000)
        except PlaywrightTimeoutError:
            last_alert = await page.evaluate("window.__lastAlert")
            await self._safe_screenshot(page, f"modal_{label}_hidden_timeout")
            raise RuntimeError(
                f"[modal:{label}] El modal no se ocultó tras Cerrar. "
                f"Último alert capturado: {last_alert!r}"
            )

        logger.info(f"[modal:{label}] Modal cerrado correctamente.")

    # ------------------------------------------------------------------ #
    # Utilidades
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _safe_screenshot(page: Page, label: str) -> None:
        """Best-effort screenshot — nunca tira excepción nueva."""
        try:
            path = f"error_debug_{label}.png"
            await page.screenshot(path=path)
            logger.info(f"Screenshot guardado: {path}")
        except Exception as shot_err:
            logger.warning(f"No se pudo capturar screenshot {label}: {shot_err}")
