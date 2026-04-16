import asyncio
import csv
import logging
import os
import time
from datetime import date
from typing import Optional

from playwright.async_api import Page, async_playwright

from app.core.config import settings
from app.tms.base import BaseTMSExtractor, ExtractionArtifact, build_path

logger = logging.getLogger(__name__)


# Selectores del portal Sodimac (tms.falabella.supply) — validados contra el
# DOM real (dump en poc_sodimac/codigo_fuente/step1b_transportista_tab.html).
# El portal corre Angular Material y usa las directivas `mat-table`, `mat-row`,
# `mat-cell`, `mat-header-cell` como ATRIBUTOS sobre tags HTML nativos
# (`<th mat-header-cell>`), no como componentes custom.
# NO cambiar a selectores tipo `<mat-header-cell>` — no matchean.
#
# El tab TRANSPORTISTA es un `<div class="mat-tab-label">`, no un `<button>`.
# El botón Ingresar es `<button class="login__submit">` con un `<span>` interno.
SEL_TAB_TRANSPORTISTA = "div.mat-tab-label:has-text('TRANSPORTISTA')"
SEL_USERNAME = "[formcontrolname='username']"
SEL_PASSWORD = "[formcontrolname='password']"
SEL_BTN_INGRESAR = "button.login__submit"

# El link del sidebar es `<a href="/carrier-shipment-request">` dentro de un
# `<mat-expansion-panel>` (dump: step3_requests_table.html de la PoC). Usamos
# selector por `href` — más estable que `:has-text()` porque no depende del
# locale del texto ni de whitespace. El panel "Solicitudes" viene expandido
# por default (aria-expanded="true" en el dump), pero post-login Angular puede
# tardar en montar el sidebar; por eso esperamos `state="visible"` antes de
# clickear. Si el click no prospera en 5s caemos al goto absoluto.
SEL_NAV_GESTIONAR = "a[href='/carrier-shipment-request']"
URL_REQUESTS = "https://tms.falabella.supply/carrier-shipment-request"

SEL_PAGINATOR_LABEL = ".mat-paginator-range-label"
SEL_PAGINATOR_NEXT = "mat-paginator .mat-paginator-navigation-next"
SEL_PAGE_SIZE_SELECT = "Filas por página"

SEL_TABLE_HEADERS = "table[mat-table] th[mat-header-cell]"
SEL_TABLE_ROWS = "table[mat-table] tr[mat-row]"
SEL_TABLE_CELLS = "td[mat-cell]"

# DataTables-style CSV export convention compartida con wingsuite.
CSV_DELIMITER = ";"


def _stringify(value) -> str:
    if value is None:
        return ""
    return str(value)


class SodimacExtractor(BaseTMSExtractor):
    SOURCE_NAME = "sodimac"
    # "trips" es el nombre canónico del producto de datos — compartido con
    # wingsuite y qanalytics. La nomenclatura del proveedor ("Gestionar
    # Solicitudes" / `/carrier-shipment-request`) queda como detalle interno;
    # el pipeline downstream consume `tms/*/trips/` de los tres TMS indistintamente.
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
        # La UI de Sodimac no expone filtro de fechas — la tabla siempre muestra
        # el set completo de solicitudes del transportista. Si llegan fechas,
        # solo se usan para el filename via `build_path`. Loguear WARNING si
        # el rango no cubre `today` para que el caller note la mismatch.
        if date_from or date_to:
            today = date.today()
            if (date_from and date_from > today) or (date_to and date_to < today):
                logger.warning(
                    f"sodimac no filtra por fecha — rango {date_from}→{date_to} "
                    f"no cubre today={today.isoformat()}. Se extrae todo de todos modos."
                )

        ts = int(time.time())

        logger.info(
            f"Iniciando extracción Sodimac — cliente={client_name} "
            f"desde={date_from} hasta={date_to} ts={ts}"
        )

        downloads_dir = os.path.join(os.getcwd(), "downloads")
        os.makedirs(downloads_dir, exist_ok=True)

        async with async_playwright() as p:
            # Browser fresco por request (sin `user_data_dir`) — el servicio es
            # un pipeline automatizado, cada job tiene que ejercer el flujo de
            # login completo con credenciales. `launch_persistent_context` de
            # la PoC nos hacía saltear el form post-primera-corrida, lo cual
            # escondía fallos de automation. `channel="chrome"` sigue usando el
            # Chrome real del sistema — el fingerprint alcanzó para pasar CF
            # incluso sin persistencia de cookies.
            # `--no-sandbox` + `--disable-dev-shm-usage` son obligatorios en
            # contenedor: Cloud Run corre como non-root con /dev/shm limitado
            # a 64MB, y el sandbox de Chrome necesita user namespaces que el
            # runtime de Cloud Run no expone. Sin esto Chrome no arranca.
            # Localmente (macOS) las flags son inocuas.
            browser = await p.chromium.launch(
                channel="chrome",
                headless=settings.BROWSER_HEADLESS,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = await browser.new_context(
                viewport={"width": 1366, "height": 768},
                accept_downloads=True,
                ignore_https_errors=True,
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
                try:
                    body_preview = (await response.text())[:500]
                except Exception:
                    body_preview = "<no-body>"
                marker = (
                    "★"
                    if ("carrier-shipment" in url or "/api/" in url)
                    else " "
                )
                logger.info(
                    f"[xhr]{marker} {response.status} "
                    f"{response.request.method} {url} "
                    f"body[:500]={body_preview!r}"
                )

            page.on(
                "response",
                lambda r: asyncio.create_task(_log_response_async(r)),
            )

            try:
                await self._login(page, timeout_ms)
                await self._navigate_to_requests(page, timeout_ms)
                headers, rows = await self._scrape_table(page, timeout_ms)

                relative_path = build_path(
                    source=self.SOURCE_NAME,
                    product=self.PRODUCT_NAME,
                    client=client_name,
                    timestamp=ts,
                    date_from=date_from,
                    date_to=date_to,
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
                    date_from=date_from,
                    date_to=date_to,
                )

            except Exception as e:
                await self._safe_screenshot(page, f"fatal_{ts}")
                logger.error(f"Error en la extracción Sodimac: {e}")
                raise
            finally:
                # Cerrar `browser` cierra también el context + page. No hay
                # user_data_dir que persistir — próxima corrida empieza limpia.
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

        # Con browser fresco siempre aterrizamos en /login. No tenemos bypass
        # "sesión viva" — cada job ejerce el flujo completo de credenciales,
        # así cualquier regresión del form (CF, selectores, creds) falla
        # explícito en esta corrida, no disfrazado por cookies cacheadas.
        logger.info("[STEP login] Click tab TRANSPORTISTA + fill credenciales")
        await page.locator(SEL_TAB_TRANSPORTISTA).first.click(timeout=timeout_ms)
        await page.wait_for_selector(SEL_USERNAME, state="visible", timeout=timeout_ms)
        await page.fill(SEL_USERNAME, settings.SODIMAC_USER)
        await page.fill(SEL_PASSWORD, settings.SODIMAC_PASS)
        await page.locator(SEL_BTN_INGRESAR).click(timeout=timeout_ms)

        # No usamos `wait_for_url` con callable — vimos un race donde el URL
        # cambiaba post-submit pero el wait quedaba colgado 180s hasta timeout
        # (confirmado por screenshot post-timeout mostrando sidebar ya montado
        # pero _login aún bloqueado). La señal DOM es más confiable: esperamos
        # a que el sidebar renderice el link del menú del TRANSPORTISTA. Si
        # aparece, el login cuajó. Si no, algo falló (CF, creds, etc.).
        logger.info("[STEP login] Esperando sidebar post-login")
        await page.wait_for_selector(
            SEL_NAV_GESTIONAR, state="attached", timeout=timeout_ms
        )
        logger.info(f"Login exitoso, sesión activa en {page.url}")

    async def _navigate_to_requests(self, page: Page, timeout_ms: int) -> None:
        logger.info("[STEP nav] Entrando a Gestionar Solicitudes")
        logger.info(f"URL pre-nav: {page.url}")

        # Post-login aterrizamos en `/`. El click SPA sobre el `<a>` dispara el
        # evento pero Angular procesa el routing async — leer `page.url` justo
        # después del `click()` todavía muestra `/`. Hay que esperar a que el
        # router actualice la URL antes de validar.
        try:
            await page.wait_for_selector(
                SEL_NAV_GESTIONAR, state="visible", timeout=15000
            )
            logger.info("Sidebar con Gestionar Solicitudes visible")
            await page.locator(SEL_NAV_GESTIONAR).first.click(timeout=5000)
            # Angular puede tardar unos cientos de ms en updatear la URL post
            # pushstate. Damos 10s — si no llega, fallback a goto.
            await page.wait_for_url(
                "**/carrier-shipment-request**", timeout=10000
            )
            logger.info(f"Click SPA OK — URL: {page.url}")
        except Exception as e:
            logger.warning(
                f"Click SPA falló ({e}); fallback goto {URL_REQUESTS}"
            )
            await page.goto(URL_REQUESTS, timeout=timeout_ms)
            logger.info(f"Goto OK — URL: {page.url}")

        # Sanity check post-nav: si no estamos en el endpoint, algo falló
        # (redir a /login por cookie muerta, ruta no montada, etc.). Falla
        # explícito en vez de esperar un timeout opaco en el paginador.
        if "carrier-shipment-request" not in page.url:
            await self._safe_screenshot(page, f"nav_wrong_url_{int(time.time())}")
            raise RuntimeError(
                f"Navegación a Gestionar Solicitudes falló: URL actual {page.url}"
            )

        # Esperar al DATO real. Angular pinta `mat-row` en estado "skeleton"
        # (celdas con 'more_vert' como texto crudo y paginador "0 de 0") antes
        # de que el backend responda. Esperamos al paginador con total > 0.
        logger.info(f"Esperando data real en la tabla (timeout={timeout_ms}ms)")
        await page.wait_for_function(
            """() => {
                const el = document.querySelector('.mat-paginator-range-label');
                if (!el) return false;
                const m = el.textContent.trim().match(/de\\s+(\\d+)/i);
                return !!m && parseInt(m[1], 10) > 0;
            }""",
            timeout=timeout_ms,
        )
        total_label = (
            await page.locator(SEL_PAGINATOR_LABEL).inner_text()
        ).strip()
        logger.info(f"Tabla lista — paginador: '{total_label}'")

    async def _set_page_size(
        self, page: Page, size: int, timeout_ms: int
    ) -> None:
        """Abre el mat-select del paginador y selecciona `size`. Espera a que
        el range-label refleje el cambio antes de retornar."""
        logger.info(f"[STEP size] Ajustando page size a {size}")
        prev_label = (
            await page.locator(SEL_PAGINATOR_LABEL).inner_text()
        ).strip()
        await page.get_by_role("combobox", name=SEL_PAGE_SIZE_SELECT).click()
        # `exact=True` evita matchear "200" o "120" cuando pedimos "20".
        await page.get_by_role("option", name=str(size), exact=True).click()
        await page.wait_for_function(
            """(prev) => {
                const el = document.querySelector('.mat-paginator-range-label');
                return el && el.textContent.trim() !== prev;
            }""",
            arg=prev_label,
            timeout=timeout_ms,
        )
        new_label = (
            await page.locator(SEL_PAGINATOR_LABEL).inner_text()
        ).strip()
        logger.info(f"Page size OK: '{prev_label}' → '{new_label}'")

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
            row_locators = page.locator(SEL_TABLE_ROWS)
            n = await row_locators.count()
            for i in range(n):
                raw_cells = await row_locators.nth(i).locator(
                    SEL_TABLE_CELLS
                ).all_inner_texts()
                cells = [c.strip() for c in raw_cells]
                all_rows.append(dict(zip(headers, cells)))
            logger.info(f"Página {page_num}: +{n} filas (total={len(all_rows)})")

            if await self._next_is_disabled(page):
                break

            prev_label = (
                await page.locator(SEL_PAGINATOR_LABEL).inner_text()
            ).strip()
            await page.locator(SEL_PAGINATOR_NEXT).click()
            # Espera determinista: el range-label cambia sólo cuando Angular
            # re-renderizó con la siguiente tanda. No usamos `networkidle`.
            await page.wait_for_function(
                """(prev) => {
                    const el = document.querySelector('.mat-paginator-range-label');
                    return el && el.textContent.trim() !== prev;
                }""",
                arg=prev_label,
                timeout=timeout_ms,
            )
            page_num += 1

        return headers, all_rows

    @staticmethod
    async def _next_is_disabled(page: Page) -> bool:
        """Tres formas en que Material marca el botón "siguiente" deshabilitado.
        Hay que chequear las tres porque Material las rota entre versiones."""
        nxt = page.locator(SEL_PAGINATOR_NEXT)
        if await nxt.get_attribute("disabled") is not None:
            return True
        if await nxt.get_attribute("aria-disabled") == "true":
            return True
        cls = await nxt.get_attribute("class") or ""
        return "mat-button-disabled" in cls

    @staticmethod
    def _write_csv(path: str, headers: list[str], rows: list[dict]) -> None:
        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(
                f, fieldnames=headers, delimiter=CSV_DELIMITER
            )
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {h: _stringify(row.get(h, "")) for h in headers}
                )

    @staticmethod
    async def _safe_screenshot(page: Page, label: str) -> None:
        """Best-effort screenshot a /tmp. No debe enmascarar la excepción original."""
        try:
            path = f"/tmp/error_sodimac_{label}.png"
            await page.screenshot(path=path, full_page=True)
            logger.info(f"Screenshot guardado: {path}")
        except Exception as shot_err:
            logger.warning(f"No se pudo capturar screenshot {label}: {shot_err}")
