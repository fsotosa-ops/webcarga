"""
Investiga en vivo el Reporte Detalle de IANSA en QAnalytics.

IANSA vive en un tenant separado (branding "mmPFQ S.A."), con una página
distinta a las otras 3 soportadas hoy. Este script confirma:
  - columnas reales de la tabla de resultados,
  - qué columna identifica el viaje (para agrupar filas),
  - si #BtExportar dispara una descarga real o hace otra cosa.

IMPORTANTE — por qué todo pasa por `page.evaluate` y no por locators:
los inputs de fecha de esta página (#txt_f1/#txt_f2) fallan las
comprobaciones de "actionability" de Playwright — tanto `fill()` como
`input_value()` cuelgan 30s y timeoutean, aunque un `eval_on_selector_all`
crudo los lee sin problema (verificado 2026-08-07). Leer/escribir vía JS
evita esas comprobaciones por completo.

Uso:
    cd extraction_service
    source venv/bin/activate
    python scripts/inspect_iansa_report.py
"""
import asyncio
import json

from playwright.async_api import async_playwright

from app.core.config import settings

# El Reporte Detalle vive bajo el dropdown "Reportes" (no "Módulo
# Distribución"/"Backhauls" como los otros reportes soportados).
HREF_REPORTE_DETALLE = "gestion_reporte_detalle_cumplimiento_iansa_trans.aspx"

DATE_FROM = "01-06-2026"
DATE_TO = "07-08-2026"


async def main():
    async with async_playwright() as p:
        browser = await p.firefox.launch(headless=True)
        context = await browser.new_context(
            accept_downloads=True,
            ignore_https_errors=True,
        )
        page = await context.new_page()

        # --- Login (mismo flujo que QAnalyticsExtractor._login) ---
        await page.goto(settings.QANALYTICS_URL, timeout=60000)
        await page.click("#Transporte")
        await page.fill("input[name='UsuarioT']", settings.QANALYTICS_USER)
        await page.fill("input[name='ContrasenaT']", settings.QANALYTICS_PASS)
        await page.fill("input[name='ClienteT']", "iansa")
        await page.click("#BtnTransporte")
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
        print(f"[login] OK — URL={page.url}")

        # --- Navegar por el MENÚ, no por goto() directo ---
        # El login dispara un redirect asíncrono; un goto() lanzado antes de
        # que termine es bounceado a inicioQMGPS.aspx (race condition real,
        # reproducida 2026-08-07). Además, el click de menú es el mismo patrón
        # que ya usan cumplimiento_sap.py / cumplimiento_citas.py.
        await page.wait_for_timeout(2000)
        print(f"[login settled] URL={page.url}")
        await page.click('a.dropdown-toggle.NavQA >> text="Reportes"')
        await page.click(f'a[href="{HREF_REPORTE_DETALLE}"]')
        await page.wait_for_load_state("domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        print(f"[nav] URL={page.url}")

        # --- Setear fechas 100% vía JS (ver docstring) ---
        set_result = await page.evaluate(
            """
            ([f1, f2]) => {
                const a = document.getElementById('txt_f1');
                const b = document.getElementById('txt_f2');
                if (!a || !b) return {ok: false, reason: 'inputs no encontrados'};
                if (typeof jQuery !== 'undefined') {
                    jQuery('#txt_f1').val(f1).trigger('change');
                    jQuery('#txt_f2').val(f2).trigger('change');
                } else {
                    a.value = f1;
                    b.value = f2;
                }
                return {ok: true, f1: a.value, f2: b.value,
                        jquery: typeof jQuery !== 'undefined'};
            }
            """,
            [DATE_FROM, DATE_TO],
        )
        print(f"[dates] {set_result}")

        # --- Buscar. #btnImg NO hace un postback de página completa: dispara
        #     un partial postback de UpdatePanel (POST AJAX a la misma .aspx).
        #     `expect_navigation` timeoutea; `expect_response` resuelve en
        #     ~0.4s (verificado 2026-08-07). El settle posterior es porque el
        #     evento de response llega con los headers, no con el DOM ya
        #     re-renderizado. ---
        async with page.expect_response(
            lambda r: ".aspx" in r.url and r.request.method == "POST" and r.status == 200,
            timeout=60000,
        ):
            await page.evaluate("document.getElementById('btnImg').click()")
        print("[search] partial postback OK")
        await page.wait_for_timeout(3000)

        await page.screenshot(path="/tmp/iansa_findings_table.png", full_page=True)
        with open("/tmp/iansa_findings.html", "w", encoding="utf-8") as f:
            f.write(await page.content())
        print("[dump] /tmp/iansa_findings_table.png + /tmp/iansa_findings.html")

        # --- Inventario de tablas con filas reales ---
        tables = await page.evaluate(
            """
            () => Array.from(document.querySelectorAll('table'))
                .map(t => ({
                    id: t.id || '(sin id)',
                    className: (t.className || '').substring(0, 60),
                    rowCount: t.rows.length,
                    firstRow: t.rows.length > 0
                        ? Array.from(t.rows[0].cells).map(c => c.textContent.trim())
                        : [],
                    secondRow: t.rows.length > 1
                        ? Array.from(t.rows[1].cells).map(c => c.textContent.trim())
                        : [],
                }))
                .filter(t => t.rowCount > 1)
            """
        )
        print("\n[tablas con >1 fila]")
        print(json.dumps(tables, indent=2, ensure_ascii=False)[:6000])

        # --- Probar la exportación ---
        print("\n[export] probando #BtExportar…")
        try:
            async with page.expect_download(timeout=20000) as dl_info:
                await page.evaluate("document.getElementById('BtExportar').click()")
            download = await dl_info.value
            dest = f"/tmp/iansa_export_{download.suggested_filename}"
            await download.save_as(dest)
            print(f"[export] ✓ DESCARGA DIRECTA — {download.suggested_filename} → {dest}")
        except Exception as err:
            print(f"[export] ✗ NO disparó descarga: {err!r}")
            print(f"[export] URL tras click: {page.url}")
            with open("/tmp/iansa_post_export.html", "w", encoding="utf-8") as f:
                f.write(await page.content())
            await page.screenshot(path="/tmp/iansa_post_export.png", full_page=True)
            print("[export] dump post-click: /tmp/iansa_post_export.{html,png}")

        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
