import asyncio
import csv
import json
import logging
import os
import time
from datetime import date
from urllib.parse import urljoin

from playwright.async_api import (
    BrowserContext,
    Page,
    async_playwright,
)

from app.core.config import settings
from app.tms.base import BaseTMSExtractor, ExtractionArtifact, build_path

logger = logging.getLogger(__name__)


# Selectores del HTML de Wingsuite — concentrados acá para que cambios del
# proveedor sean un solo punto de edición. Validados contra los dumps de
# `codigo_fuente*.html` del POC (webcarga-dev/poc_wingsuite).
SEL_USERNAME = "#username"
SEL_PASSWORD = "#password"
SEL_SIDE_MENU = "#side-menu"
SEL_PAGE_CONTENT = "#page-content"
SEL_DATE_FROM = "#fecha_inicio"
SEL_DATE_TO = "#fecha_fin"

# IDs del reporte "Viajes por Transportista" dentro del módulo Logística.
# La app expone la navegación como `funcionesTema.cargarPaginaBd(app, reporte)`.
APP_ID_LOGISTICA = "5"
REPORT_ID_VIAJES = "4134"

# Endpoint XHR que trae las filas en el body de la respuesta. No es una URL
# completa, solo un fragmento único para filtrar en `expect_response`.
RESPONSE_MARKER_VIAJES = "viajes.obtener_completo_transportista"

# Formato que Wingsuite espera en sus inputs de fecha (dd-mm-YYYY).
DATE_FORMAT_APP = "%d-%m-%Y"

# DataTables del sitio exporta CSV con separador ';' — mantenemos la misma
# convención para que archivos producidos por el adapter sean intercambiables
# con los que un analista exportaría manualmente desde la UI.
CSV_DELIMITER = ";"


class WingsuiteExtractor(BaseTMSExtractor):
    SOURCE_NAME = "wingsuite"
    # "trips" es el nombre canónico del producto de datos — compartido con
    # qanalytics y cualquier futuro TMS. El nombre del reporte en la UI de
    # Wingsuite ("Viajes por Transportista", id 4134) queda como detalle interno.
    PRODUCT_NAME = "trips"

    async def extract(
        self,
        *,
        client_name: str,
        date_from: date,
        date_to: date,
        timeout_ms: int,
    ) -> ExtractionArtifact:
        # Timestamp Unix fijado UNA SOLA VEZ al inicio — todos los paths
        # derivados (local + GCS) lo comparten para que coincidan.
        ts = int(time.time())

        logger.info(
            f"Iniciando extracción Wingsuite — cliente={client_name} "
            f"desde={date_from.isoformat()} hasta={date_to.isoformat()} "
            f"ts={ts}"
        )

        downloads_dir = os.path.join(os.getcwd(), "downloads")
        os.makedirs(downloads_dir, exist_ok=True)

        async with async_playwright() as p:
            # Firefox alineado con qanalytics y el Dockerfile. Chromium
            # crasheaba en Cloud Run, y Firefox además pasa el reCAPTCHA v3
            # invisible del login de Wingsuite sin fricción.
            browser = await p.firefox.launch(headless=settings.BROWSER_HEADLESS)
            context = await browser.new_context(
                accept_downloads=True,
                ignore_https_errors=True,
                viewport={"width": 1366, "height": 768},
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

            try:
                # `generar_sesion.php` puede abrir popup + cerrar la original
                # (Chromium) o navegar in-place (Firefox). `_login` devuelve la
                # página viva con `#side-menu` para aislar ese detalle.
                page = await self._login(page, context, timeout_ms)
                await self._navigate_to_logistics_module(page, timeout_ms)
                await self._open_report(page, timeout_ms)

                local_path = await self._apply_filters_and_download(
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
                await self._safe_screenshot(page, f"fatal_{ts}")
                logger.error(f"Error en el proceso Wingsuite: {e}")
                raise
            finally:
                await browser.close()

    # ------------------------------------------------------------------ #
    # Pasos del flujo
    # ------------------------------------------------------------------ #

    async def _login(
        self,
        page: Page,
        context: BrowserContext,
        timeout_ms: int,
    ) -> Page:
        logger.info("[STEP login] Navegando al login de Wingsuite")
        await page.goto(settings.WINGSUITE_URL, timeout=timeout_ms)
        await page.wait_for_selector(SEL_USERNAME, state="visible", timeout=timeout_ms)

        await page.fill(SEL_USERNAME, settings.WINGSUITE_USER)
        await page.fill(SEL_PASSWORD, settings.WINGSUITE_PASS)
        await page.locator(SEL_PASSWORD).press("Enter")

        # Poll todas las páginas del contexto hasta encontrar una con el
        # side-menu visible (indica sesión activa). Acepta tanto el flujo
        # in-place de Firefox como el popup+close de Chromium.
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            for candidate in list(context.pages):
                if candidate.is_closed():
                    continue
                try:
                    if await candidate.locator(SEL_SIDE_MENU).count() > 0:
                        logger.info(f"Login exitoso en {candidate.url}")
                        candidate.on(
                            "console",
                            lambda m: logger.info(
                                f"[browser console] {m.type}: {m.text}"
                            ),
                        )
                        candidate.on(
                            "pageerror",
                            lambda exc: logger.error(f"[browser pageerror] {exc}"),
                        )
                        return candidate
                except Exception:
                    continue
            await asyncio.sleep(0.5)

        raise RuntimeError(
            "Login Wingsuite falló (posible rechazo reCAPTCHA o credenciales "
            "inválidas). Revisa el screenshot de diagnóstico en /tmp."
        )

    async def _navigate_to_logistics_module(
        self, page: Page, timeout_ms: int
    ) -> None:
        logger.info("[STEP nav] Entrando al Módulo Operación Logística")
        # Post-login aterrizamos en /web/core/index.php; reutilizamos ese dir
        # como base para `urljoin` y apuntamos al app_id del módulo.
        target_url = urljoin(
            settings.WINGSUITE_URL, f"index.php?id_app={APP_ID_LOGISTICA}"
        )
        await page.goto(target_url, timeout=timeout_ms)
        await page.wait_for_selector(SEL_SIDE_MENU, state="visible", timeout=timeout_ms)

    async def _open_report(self, page: Page, timeout_ms: int) -> None:
        logger.info(
            f"[STEP report] Abriendo reporte {REPORT_ID_VIAJES} "
            "(Viajes por Transportista)"
        )
        # El onload del módulo dispara cargarPaginaBd pero puede no haber corrido
        # aún; forzamos para evitar condiciones de carrera.
        await page.evaluate(
            f"funcionesTema.cargarPaginaBd('{APP_ID_LOGISTICA}','{REPORT_ID_VIAJES}')"
        )
        await page.wait_for_selector(
            SEL_PAGE_CONTENT, state="visible", timeout=timeout_ms
        )
        # Esperar a que el contenido del reporte termine de pintar dentro del
        # contenedor — sin esto, los selectores de los filtros pueden existir
        # pero sin sus handlers jQuery bindeados.
        await page.wait_for_function(
            f"document.querySelector('{SEL_PAGE_CONTENT}').innerText.trim().length > 0",
            timeout=timeout_ms,
        )
        # Hard wait corto para asegurar que el datetimepicker se inicialice.
        # Medido empíricamente en el POC; si el sitio se ralentiza, subir acá.
        await page.wait_for_timeout(1500)

    async def _apply_filters_and_download(
        self,
        page: Page,
        client_name: str,
        timestamp: int,
        date_from: date,
        date_to: date,
        downloads_dir: str,
        timeout_ms: int,
    ) -> str:
        logger.info("[STEP filters] Aplicando rango de fechas y disparando búsqueda")

        await page.wait_for_selector(SEL_DATE_FROM, state="visible", timeout=timeout_ms)

        # Setear rangos via jQuery .val() directamente. `locator.fill()` abre el
        # datepicker bootstrap y deja a buscar_listado() sin disparar el XHR.
        from_str = date_from.strftime(DATE_FORMAT_APP)
        to_str = date_to.strftime(DATE_FORMAT_APP)
        await page.evaluate(
            """
            ([fi, ff]) => {
                if (typeof jQuery === 'undefined') {
                    throw new Error('jQuery no está disponible en la página');
                }
                jQuery('#fecha_inicio').val(fi);
                jQuery('#fecha_fin').val(ff);
            }
            """,
            [from_str, to_str],
        )

        # Leer del DOM los valores efectivos y fallar explícito si no coinciden.
        effective = await page.evaluate(
            "() => ({ fi: document.querySelector('#fecha_inicio').value, "
            "ff: document.querySelector('#fecha_fin').value })"
        )
        if effective["fi"] != from_str or effective["ff"] != to_str:
            raise RuntimeError(
                f"No se pudo setear el rango. Esperado={from_str}/{to_str}, "
                f"obtenido={effective['fi']}/{effective['ff']}"
            )
        logger.info(f"Rango efectivo: {effective['fi']} → {effective['ff']}")

        # Interceptar el XHR del endpoint de viajes. Los botones nativos CSV/Excel
        # del DataTables no disparan descarga real (sólo copiar/dinámica); el XHR
        # trae todas las filas en JSON.
        #
        # TODO: si aparecen rangos grandes donde el endpoint pagina, implementar
        # paginación aquí — por ahora asumimos que una respuesta trae todo.
        async with page.expect_response(
            lambda r: RESPONSE_MARKER_VIAJES in r.url,
            timeout=timeout_ms,
        ) as resp_info:
            await page.evaluate("buscar_listado()")

        response = await resp_info.value
        payload = await response.json()
        rows = self._extract_rows(payload)
        logger.info(f"Filas recibidas desde Wingsuite: {len(rows)}")

        # Path local construido con `build_path` — misma fuente de verdad que
        # el runner de jobs usa para el blob de GCS (ver app/api/routes.py).
        relative_path = build_path(
            source=self.SOURCE_NAME,
            product=self.PRODUCT_NAME,
            client=client_name,
            timestamp=timestamp,
            date_from=date_from,
            date_to=date_to,
            extension=".csv",
        )
        local_file_path = os.path.join(downloads_dir, relative_path)
        os.makedirs(os.path.dirname(local_file_path), exist_ok=True)

        self._write_csv(local_file_path, rows)
        logger.info(f"¡ÉXITO! CSV Wingsuite generado en: {local_file_path}")
        return local_file_path

    # ------------------------------------------------------------------ #
    # Transformación JSON → CSV
    # ------------------------------------------------------------------ #

    @staticmethod
    def _extract_rows(payload) -> list[dict]:
        # El endpoint envuelve la data en {"status": ..., "resp": [...]}.
        # Aceptamos también una lista pelada por robustez (versiones previas
        # del API la devolvían así).
        if isinstance(payload, dict):
            data = payload.get("resp")
        elif isinstance(payload, list):
            data = payload
        else:
            data = None
        if not isinstance(data, list):
            return []
        return [r for r in data if isinstance(r, dict)]

    @staticmethod
    def _write_csv(path: str, rows: list[dict]) -> None:
        # Header = unión de claves en orden de aparición. Estable aunque algunos
        # registros tengan campos opcionales. Separador ';' como el export CSV
        # del DataTables del sitio.
        fieldnames: list[str] = []
        seen: set[str] = set()
        for row in rows:
            for k in row.keys():
                if k not in seen:
                    seen.add(k)
                    fieldnames.append(k)

        with open(path, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, delimiter=CSV_DELIMITER)
            writer.writeheader()
            for row in rows:
                writer.writerow(
                    {k: _stringify(row.get(k)) for k in fieldnames}
                )

    # ------------------------------------------------------------------ #
    # Utilidades
    # ------------------------------------------------------------------ #

    @staticmethod
    async def _safe_screenshot(page: Page, label: str) -> None:
        """Best-effort screenshot a /tmp — nunca tira excepción nueva."""
        try:
            path = f"/tmp/error_wingsuite_{label}.png"
            await page.screenshot(path=path, full_page=True)
            logger.info(f"Screenshot guardado: {path}")
        except Exception as shot_err:
            logger.warning(f"No se pudo capturar screenshot {label}: {shot_err}")


def _stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)
