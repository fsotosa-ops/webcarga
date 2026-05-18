import asyncio
import logging
import os
import time
from datetime import date
from typing import Optional

from playwright.async_api import (
    Page,
    async_playwright,
    TimeoutError as PlaywrightTimeoutError,
)

from app.tms.base import BaseTMSExtractor, ExtractionArtifact, build_path, get_downloads_dir
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

        downloads_dir = get_downloads_dir()

        async with async_playwright() as p:
            browser = await p.firefox.launch(headless=settings.BROWSER_HEADLESS)
            context = await browser.new_context(
                accept_downloads=True,
                ignore_https_errors=True,
            )
            page = await context.new_page()

            page.on(
                "console",
                lambda msg: logger.info(f"[browser console] {msg.type}: {msg.text}"),
            )
            page.on(
                "pageerror",
                lambda exc: logger.error(f"[browser pageerror] {exc}"),
            )

            async def _log_response_async(response):
                url = response.url
                if response.request.resource_type not in ("xhr", "fetch", "document"):
                    return
                # ★ marca requests a páginas/APIs del propio QAnalytics
                marker = "★" if ("qanalytics" in url or ".aspx" in url) else " "
                if marker == "★":
                    try:
                        body_preview = (await response.text())[:300]
                    except Exception:
                        body_preview = "<no-body>"
                    logger.info(
                        f"[xhr]{marker} {response.status} "
                        f"{response.request.method} {url} "
                        f"body[:300]={body_preview!r}"
                    )
                else:
                    logger.info(
                        f"[xhr]{marker} {response.status} "
                        f"{response.request.method} {url}"
                    )

            page.on("response", lambda r: asyncio.create_task(_log_response_async(r)))

            try:
                t0 = time.time()
                await self._login(page, client_name, timeout_ms)
                logger.info(f"[TIMING] login: {time.time()-t0:.1f}s")

                t0 = time.time()
                await self._navigate_to_distribucion(page, timeout_ms)
                await self._maybe_dump_page(page, "post_nav")
                logger.info(f"[TIMING] navigate: {time.time()-t0:.1f}s")

                t0 = time.time()
                await self._handle_pendientes_modal_if_open(page, label="auto-load")
                logger.info(f"[TIMING] modal auto-load: {time.time()-t0:.1f}s")

                t0 = time.time()
                await self._set_date_range(page, date_from, date_to)
                await self._submit_search(page, timeout_ms)
                logger.info(f"[TIMING] dates+search: {time.time()-t0:.1f}s")

                t0 = time.time()
                await self._handle_pendientes_modal_if_open(page, label="post-filter")
                logger.info(f"[TIMING] modal post-filter: {time.time()-t0:.1f}s")

                t0 = time.time()
                local_path = await self._download_export(
                    page,
                    client_name,
                    ts,
                    date_from,
                    date_to,
                    downloads_dir,
                    timeout_ms,
                )
                logger.info(f"[TIMING] download: {time.time()-t0:.1f}s")
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
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

    async def _navigate_to_distribucion(self, page: Page, timeout_ms: int) -> None:
        await page.click('a.dropdown-toggle.NavQA >> text="Módulo Distribución"')
        await page.click(
            'a[href="gestion_planificacion_programados_dist_transporte_walmart.aspx"]'
        )
        await page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)

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

    async def _submit_search(self, page: Page, timeout_ms: int) -> None:
        """
        Click a #btn_buscar y espera la respuesta del UpdatePanel de ASP.NET.

        QAnalytics usa UpdatePanel: el click dispara un POST al mismo .aspx que
        devuelve HTML parcial con la tabla filtrada. Sin esperar esa respuesta,
        el export captura la tabla pre-filtro (bug confirmado en logs 2026-05-18:
        XHR de búsqueda llegaba 4s después del click al botón de export).
        """
        logger.info("[STEP search] Click #btn_buscar — esperando respuesta UpdatePanel")
        try:
            async with page.expect_response(
                lambda r: ".aspx" in r.url and r.request.method == "POST" and r.status == 200,
                timeout=min(timeout_ms, 60_000),
            ):
                await page.locator(SEL_BTN_BUSCAR).click(timeout=min(timeout_ms, 60_000))
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

        # Bootstrap anima el modal con CSS transition (~300ms). Si se interactúa
        # antes de que termine, el backdrop cubre los checkboxes y Playwright los
        # marca como "not stable" / "intercepted". Esperar que la animación complete.
        await page.wait_for_timeout(400)

        logger.info(f"[modal:{label}] Modal abierto. Procesando…")

        # Hook window.alert para capturar mensajes de valida_GP().
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

        # Marcar todos los checkboxes, rellenar fechas de salida vacías y
        # sincronizar contadores via JS atómico.
        # NO usar checkboxes.nth(i).check() — Playwright evalúa "actionability"
        # por elemento y falla con Timeout 5000ms cuando la animación Bootstrap
        # no terminó (bug confirmado en logs de Cloud Run 2026-05-18: 4 runs
        # consecutivos fallaron en este punto exacto).
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
                        // .click() dispara el atributo onclick del elemento
                        // y sus jQuery handlers. dispatchEvent('change') no
                        // activa onclick attributes.
                        chk.click();
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

                // Diagnóstico completo: ver TODOS los inputs del modal y
                // la fuente completa de valida_GP para entender qué valida.
                const hoy = new Date();
                const dd = String(hoy.getDate()).padStart(2, '0');
                const mo = String(hoy.getMonth() + 1).padStart(2, '0');
                const yyyy = hoy.getFullYear();
                const fechaHoy = dd + '-' + mo + '-' + yyyy;

                // Todos los inputs (todos los types)
                const allInputs = Array.from(root.querySelectorAll('input')).map(inp => ({
                    id: inp.id, type: inp.type, name: inp.name || '',
                    value: inp.value, onclick: inp.getAttribute('onclick') || ''
                }));

                // Checkboxes: capturar onclick para saber si populan fechas
                const chkDiag = Array.from(root.querySelectorAll(
                    'input[type="checkbox"][id^="PTO_"]'
                )).map(chk => ({
                    id: chk.id, checked: chk.checked,
                    onclick: chk.getAttribute('onclick') || ''
                }));

                // Variables globales que valida_GP puede leer
                const gVars = {
                    fechasSalida: typeof window.fechasSalida !== 'undefined'
                        ? JSON.stringify(window.fechasSalida).substring(0, 200) : 'UNDEF',
                    arFechas: typeof window.arFechas !== 'undefined'
                        ? JSON.stringify(window.arFechas).substring(0, 200) : 'UNDEF',
                };

                // Fuente completa de valida_GP
                const validaGpSrc = typeof valida_GP === 'function'
                    ? valida_GP.toString().substring(0, 1000)
                    : 'NOT_FOUND';

                return {
                    marked, total,
                    fechasRellenas: 0, fechaHoy,
                    inputDiag: allInputs, chkDiag, gVars, validaGpSrc
                };
            }
            """
        )
        logger.info(
            f"[modal:{label}] marked={state.get('marked')} total={state.get('total')} "
            f"allInputs={state.get('inputDiag')} chkDiag={state.get('chkDiag')} "
            f"gVars={state.get('gVars')}"
        )
        logger.info(
            f"[modal:{label}] validaGP={state.get('validaGpSrc','NOT_FOUND')!r}"
        )
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
    async def _maybe_dump_page(page: Page, label: str) -> None:
        """Si QANALYTICS_DUMP_PAGE=1, vuelca HTML + screenshot a /tmp/.

        Uso:
            BROWSER_HEADLESS=False QANALYTICS_DUMP_PAGE=1 \\
              uvicorn app.main:app --reload --port 8080

        Luego revisar /tmp/qanalytics_dump_post_nav.html para confirmar que
        los selectores (#txt_fecini, #btn_buscar, exportar_tabla, etc.) existen
        en la página correcta antes de interactuar con ellos.
        """
        if os.getenv("QANALYTICS_DUMP_PAGE") != "1":
            return
        try:
            html_path = f"/tmp/qanalytics_dump_{label}.html"
            png_path = f"/tmp/qanalytics_dump_{label}.png"
            html = await page.content()
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(html)
            await page.screenshot(path=png_path, full_page=True)
            logger.info(f"[DUMP] {label} → {html_path} | {png_path}")
        except Exception as err:
            logger.warning(f"[DUMP] {label} falló: {err}")

