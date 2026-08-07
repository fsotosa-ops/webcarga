import asyncio
import csv
import logging
import os
import time
from datetime import date
from typing import Optional

from playwright.async_api import Page, async_playwright

from app.core.config import settings
from app.tms.base import (
    CSV_DELIMITER,
    BaseTMSExtractor,
    ExtractionArtifact,
    build_path,
    get_downloads_dir,
    stringify,
)

logger = logging.getLogger(__name__)


# Selectores del portal Sodimac (tms.falabella.supply).
# El portal corre Angular Material y usa las directivas `mat-table`, `mat-row`,
# `mat-cell`, `mat-header-cell` como ATRIBUTOS sobre tags HTML nativos
# (`<th mat-header-cell>`), no como componentes custom.
SEL_USERNAME = "[formcontrolname='username']"
SEL_PASSWORD = "[formcontrolname='password']"
SEL_BTN_INGRESAR = "button.login__submit"

SEL_NAV_GESTIONAR = "a[href='/shipment-request/list']"
URL_REQUESTS = "https://tms.falabella.supply/shipment-request/list"

# Angular Material rotó a MDC entre versiones: classnames pasaron de
# `.mat-paginator-*` a `.mat-mdc-paginator-*`. Matcheamos ambas.
SEL_PAGINATOR_LABEL = ".mat-paginator-range-label, .mat-mdc-paginator-range-label"
SEL_PAGINATOR_NEXT = (
    "mat-paginator .mat-paginator-navigation-next, "
    "mat-paginator .mat-mdc-paginator-navigation-next"
)
JS_SEL_RANGE_LABEL = (
    "document.querySelector("
    "'.mat-paginator-range-label, .mat-mdc-paginator-range-label')"
)
SEL_PAGE_SIZE_SELECT = "Filas por página"

SEL_TABLE_HEADERS = "table[mat-table] th[mat-header-cell]"
SEL_TABLE_ROWS = "table[mat-table] tr[mat-row]"
SEL_TABLE_CELLS = "td[mat-cell]"


class SodimacExtractor(BaseTMSExtractor):
    SOURCE_NAME = "sodimac"
    PRODUCT_NAME = "trips"

    # Filas por página: maximiza para reducir clicks de paginación. 20 es la
    # opción más alta disponible en el mat-select del portal.
    PAGE_SIZE = 20

    async def extract(
        self,
        *,
        client_name: str,
        date_from: Optional[date],
        date_to: Optional[date],
        timeout_ms: int,
    ) -> ExtractionArtifact:
        # Sodimac NO filtra por rango en servidor: el endpoint
        # `/shipment-request/by-filters` con `arrivalDatetime{Start,End}`
        # devolvió consistentemente `totalElements=0` con rangos de 1-2 semanas,
        # mientras que sin filtro la tabla trae las 228 solicitudes visibles.
        # Scrapeamos el set completo visible — el pipeline downstream recorta
        # por fecha si lo necesita.
        if date_from or date_to:
            logger.warning(
                f"[sodimac] date_from={date_from}/date_to={date_to} recibidos "
                f"pero el adapter sodimac NO filtra por rango — scrapeamos set completo."
            )

        ts = int(time.time())
        logger.info(
            f"Iniciando extracción Sodimac — cliente={client_name} ts={ts}"
        )

        downloads_dir = get_downloads_dir()

        async with async_playwright() as p:
            # Browser fresco por request — `channel="chrome"` usa el Chrome real
            # del sistema; las flags `--no-sandbox` + `--disable-dev-shm-usage`
            # son obligatorias en Cloud Run (non-root, /dev/shm de 64MB).
            browser = await p.chromium.launch(
                channel="chrome",
                headless=settings.BROWSER_HEADLESS,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            # `timezone_id` explícito es OBLIGATORIO: el portal de Sodimac
            # (Angular) renderiza fecha/hora de la cita del lado del cliente
            # (JS `Date`/`Intl`), y el scraper lee `cell.textContent` — o sea,
            # el texto ya formateado. Sin esto, el Chromium headless de Cloud Run
            # usa el TZ del contenedor (UTC) y captura 11:00 AM donde un operador
            # en Chile ve 7:00 AM (+4h sistemático en todo el histórico).
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                accept_downloads=True,
                ignore_https_errors=True,
                timezone_id="America/Santiago",
            )
            page = await context.new_page()

            page.on(
                "console",
                lambda msg: logger.debug(f"[console] {msg.type}: {msg.text}"),
            )
            page.on(
                "pageerror",
                lambda exc: logger.error(f"[pageerror] {exc}"),
            )

            # Sniffer XHR: si CF corta el backend después del login, los status
            # 401/403/challenge aparecen acá con marker ★ sobre las URLs del
            # endpoint real. Sin esto los timeouts son opacos.
            async def _log_response_async(response):
                url = response.url
                rtype = response.request.resource_type
                if rtype not in ("xhr", "fetch"):
                    return
                if "/cdn-cgi/" in url:
                    return
                marker = (
                    "★"
                    if ("carrier-shipment" in url or "/api/" in url)
                    else " "
                )
                # Only read body for critical API calls — static assets can be large.
                if marker == "★":
                    try:
                        body_preview = (await response.text())[:500]
                    except Exception:
                        body_preview = "<no-body>"
                    logger.info(
                        f"[xhr]{marker} {response.status} "
                        f"{response.request.method} {url} "
                        f"body[:500]={body_preview!r}"
                    )
                else:
                    logger.info(
                        f"[xhr]{marker} {response.status} "
                        f"{response.request.method} {url}"
                    )

            page.on(
                "response",
                lambda r: asyncio.create_task(_log_response_async(r)),
            )

            try:
                await self._login(page, timeout_ms)
                await self._navigate_to_requests(page, timeout_ms)
                headers, rows = await self._scrape_table(page, timeout_ms)

                # `date_from=None, date_to=None` en el Artifact — sodimac no
                # filtra por rango, build_path usa `today` como placeholder
                # estable para el filename (ver app/tms/base.py).
                relative_path = build_path(
                    source=self.SOURCE_NAME,
                    product=self.PRODUCT_NAME,
                    client=client_name,
                    timestamp=ts,
                    date_from=None,
                    date_to=None,
                    extension=".csv",
                )
                local_file_path = os.path.join(downloads_dir, relative_path)
                os.makedirs(os.path.dirname(local_file_path), exist_ok=True)

                self._write_csv(local_file_path, headers, rows)
                logger.info(
                    f"¡ÉXITO! CSV Sodimac generado en: {local_file_path} "
                    f"({len(rows)} filas)"
                )

                return ExtractionArtifact(
                    local_path=local_file_path,
                    source=self.SOURCE_NAME,
                    product=self.PRODUCT_NAME,
                    client_name=client_name,
                    timestamp=ts,
                    date_from=None,
                    date_to=None,
                )

            except Exception as e:
                await self._safe_screenshot(page, f"fatal_{ts}")
                logger.error(f"Error en la extracción Sodimac: {e}")
                raise
            finally:
                await browser.close()

    # ------------------------------------------------------------------ #
    # Pasos del flujo
    # ------------------------------------------------------------------ #

    async def _login(self, page: Page, timeout_ms: int) -> None:
        """Login automatizado como TRANSPORTISTA. El portal es un SPA Angular:
        primero bootstrapea `tms-frontend-root`, luego hay que clickear el tab
        TRANSPORTISTA antes de ver los inputs."""
        logger.info("[STEP login] Navegando al portal Sodimac")
        await page.goto(settings.SODIMAC_URL, timeout=timeout_ms)

        # Bootstrap Angular — `tms-frontend-root` arranca sin hijos y los puebla
        # cuando el router monta la vista. No usamos `networkidle` porque
        # Angular mantiene polling/telemetry que nunca llega a idle.
        await page.wait_for_function(
            """() => {
                const root = document.querySelector('tms-frontend-root');
                return !!root && root.children.length > 0;
            }""",
            timeout=timeout_ms,
        )

        logger.info("[STEP login] Click tab TRANSPORTISTA + fill credenciales")
        await page.get_by_role("tab", name="TRANSPORTISTA").click(timeout=timeout_ms)
        await page.wait_for_selector(SEL_USERNAME, state="visible", timeout=timeout_ms)
        await page.fill(SEL_USERNAME, settings.SODIMAC_USER)
        await page.fill(SEL_PASSWORD, settings.SODIMAC_PASS)
        await page.locator(SEL_BTN_INGRESAR).click(timeout=timeout_ms)

        # Señal DOM: el sidebar renderiza el link al menú post-login. Usar
        # `wait_for_url` con callable dio falsos timeouts (confirmado por
        # screenshot mostrando sidebar montado con _login aún bloqueado).
        logger.info("[STEP login] Esperando sidebar post-login")
        await page.wait_for_selector(
            SEL_NAV_GESTIONAR, state="attached", timeout=timeout_ms
        )
        logger.info(f"Login exitoso, sesión activa en {page.url}")

    async def _navigate_to_requests(self, page: Page, timeout_ms: int) -> None:
        logger.info("[STEP nav] Entrando a Gestionar Solicitudes")
        logger.info(f"URL pre-nav: {page.url}")

        try:
            await page.wait_for_selector(
                SEL_NAV_GESTIONAR, state="visible", timeout=15000
            )
            logger.info("Sidebar con Gestionar Solicitudes visible")
            await page.locator(SEL_NAV_GESTIONAR).first.click(timeout=5000)
            await page.wait_for_url(
                "**/shipment-request/list**", timeout=10000
            )
            logger.info(f"Click SPA OK — URL: {page.url}")
        except Exception as e:
            logger.warning(
                f"Click SPA falló ({e}); fallback goto {URL_REQUESTS}"
            )
            await page.goto(URL_REQUESTS, timeout=timeout_ms)
            logger.info(f"Goto OK — URL: {page.url}")

        if "shipment-request" not in page.url:
            await self._safe_screenshot(page, f"nav_wrong_url_{int(time.time())}")
            raise RuntimeError(
                f"Navegación a Gestionar Solicitudes falló: URL actual {page.url}"
            )

        # Esperar al DATO real. Angular pinta `mat-row` en estado "skeleton"
        # antes de que el backend responda. Esperamos al paginador con total>0.
        logger.info(f"Esperando data real en la tabla (timeout={timeout_ms}ms)")
        await page.wait_for_function(
            f"""() => {{
                const el = {JS_SEL_RANGE_LABEL};
                if (!el) return false;
                const m = el.textContent.trim().match(/de\\s+(\\d+)/i);
                return !!m && parseInt(m[1], 10) > 0;
            }}""",
            timeout=timeout_ms,
        )
        total_label = (
            await page.locator(SEL_PAGINATOR_LABEL).inner_text()
        ).strip()
        logger.info(f"Tabla lista — paginador: '{total_label}'")

    async def _set_page_size(
        self, page: Page, size: int, timeout_ms: int
    ) -> None:
        """Abre el mat-select del paginador y selecciona `size`.

        BEST-EFFORT: si el mat-select no colabora (overlay no renderiza,
        option ausente, combobox intercepted) loguea warning y sigue con el
        default del portal (10). El scraping funciona igual; sólo se
        traducirá a más clicks de paginación.
        """
        # Timeout corto fijo — es best-effort, nunca debe bloquear el job completo.
        _T = 5000
        logger.info(f"[STEP size] Ajustando page size a {size} (best-effort)")
        try:
            prev_label = (
                await page.locator(SEL_PAGINATOR_LABEL).first.inner_text()
            ).strip()
            await page.get_by_role(
                "combobox", name=SEL_PAGE_SIZE_SELECT
            ).click(timeout=_T)

            await page.wait_for_selector(
                "[role='option']", state="visible", timeout=_T
            )

            option = page.get_by_role("option", name=str(size), exact=True)
            await option.click(timeout=_T)

            await page.wait_for_function(
                f"""(prev) => {{
                    const el = {JS_SEL_RANGE_LABEL};
                    return el && el.textContent.trim() !== prev;
                }}""",
                arg=prev_label,
                timeout=_T,
            )
            new_label = (
                await page.locator(SEL_PAGINATOR_LABEL).first.inner_text()
            ).strip()
            logger.info(f"Page size OK: '{prev_label}' → '{new_label}'")
        except Exception as err:
            available = "<no-overlay>"
            try:
                available = await page.locator("[role='option']").all_inner_texts()
            except Exception as inner_err:
                logger.debug(f"[STEP size] No se pudo leer opciones del overlay: {inner_err}")
            try:
                await page.keyboard.press("Escape")
            except Exception as esc_err:
                logger.debug(f"[STEP size] No se pudo cerrar overlay con Escape: {esc_err}")
            logger.warning(
                f"[STEP size] No pude ajustar a {size} — sigo con default. "
                f"Opciones detectadas: {available!r}. Causa: {err}"
            )

    async def _scrape_table(self, page: Page, timeout_ms: int):
        logger.info("[STEP scrape] Recorriendo tabla de solicitudes")

        await self._set_page_size(page, self.PAGE_SIZE, timeout_ms)

        raw_headers = await page.locator(SEL_TABLE_HEADERS).all_inner_texts()
        headers = [h.strip() for h in raw_headers if h.strip()]
        logger.info(f"Headers detectados: {headers}")

        all_rows: list[dict] = []
        page_num = 1
        while True:
            await page.wait_for_selector(SEL_TABLE_ROWS, timeout=timeout_ms)
            # Single JS call instead of one Playwright IPC round-trip per row.
            page_cells: list[list[str]] = await page.evaluate(
                """() => {
                    const rows = document.querySelectorAll(
                        'table[mat-table] tr[mat-row]'
                    );
                    return Array.from(rows).map(row =>
                        Array.from(row.querySelectorAll('td[mat-cell]')).map(
                            cell => cell.textContent.trim()
                        )
                    );
                }"""
            )
            for cells in page_cells:
                all_rows.append(dict(zip(headers, cells)))
            logger.info(
                f"Página {page_num}: +{len(page_cells)} filas (total={len(all_rows)})"
            )

            if await self._next_is_disabled(page):
                break

            prev_label = (
                await page.locator(SEL_PAGINATOR_LABEL).first.inner_text()
            ).strip()
            await page.locator(SEL_PAGINATOR_NEXT).first.click()
            # Espera determinista: el range-label cambia sólo cuando Angular
            # re-renderizó con la siguiente tanda. No usamos `networkidle`.
            await page.wait_for_function(
                f"""(prev) => {{
                    const el = {JS_SEL_RANGE_LABEL};
                    return el && el.textContent.trim() !== prev;
                }}""",
                arg=prev_label,
                timeout=timeout_ms,
            )
            page_num += 1

        return headers, all_rows

    @staticmethod
    async def _next_is_disabled(page: Page) -> bool:
        """Material marca el botón "siguiente" deshabilitado de varias formas
        y las rota entre versiones. Token match sobre class — substring daría
        falso positivo contra `mat-mdc-button-disabled-interactive`."""
        nxt = page.locator(SEL_PAGINATOR_NEXT).first
        if await nxt.get_attribute("disabled") is not None:
            return True
        if await nxt.get_attribute("aria-disabled") == "true":
            return True
        cls = await nxt.get_attribute("class") or ""
        tokens = cls.split()
        disabled_markers = {"mat-button-disabled", "mat-mdc-button-disabled"}
        return any(t in disabled_markers for t in tokens)

    @staticmethod
    def _write_csv(path: str, headers: list[str], rows: list[dict]) -> None:
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f, fieldnames=headers, delimiter=CSV_DELIMITER
            )
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {h: stringify(row.get(h, "")) for h in headers}
                )
