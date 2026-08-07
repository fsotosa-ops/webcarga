"""
Tests unitarios del extractor de IANSA (Reporte Detalle, tenant mmPFQ S.A.).

Cubren las 4 diferencias reales contra las otras 3 páginas de QAnalytics,
todas confirmadas en vivo el 2026-08-07 (ver
docs/superpowers/plans/2026-08-07-iansa-report-findings.md):

  1. Navegación por menú "Reportes" — NO por goto() directo, que es flaky
     por una race con el redirect asíncrono del login.
  2. Fechas en #txt_f1/#txt_f2, escritas Y verificadas por page.evaluate:
     esos inputs fallan la actionability de Playwright y los locators
     cuelgan hasta timeoutear.
  3. Búsqueda por #btnImg con partial postback (expect_response), no
     #btn_buscar ni navegación completa.
  4. Exportación por #BtExportar (submit) con descarga directa, no por el
     link onclick="exportar_tabla()" que reutilizan SAP y Citas.

No requieren credenciales ni browser. Correr con:
    cd extraction_service
    python -m pytest tests/test_qanalytics_cumplimiento_iansa.py -v
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import date
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.tms.qanalytics.cumplimiento_iansa import (
    HREF_REPORTE_DETALLE,
    QAnalyticsCumplimientoIansaExtractor,
    SEL_BTN_BUSCAR_IANSA,
    SEL_BTN_EXPORT_IANSA,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class _FakeDownloadInfo:
    """Reemplaza el objeto que devuelve `async with page.expect_download()`.

    Debe exponer `.value` como awaitable (Playwright lo resuelve con
    `await download_info.value`).
    """

    def __init__(self, download):
        self._download = download

    @property
    def value(self):
        async def _get():
            return self._download

        return _get()


# ---------------------------------------------------------------------------
# 1 — Navegación por menú
# ---------------------------------------------------------------------------


class TestNavigateViaMenu:
    def _make_nav_page(self, clicked: list):
        page = MagicMock()
        page.wait_for_load_state = AsyncMock(return_value=None)
        page.wait_for_timeout = AsyncMock(return_value=None)
        page.goto = AsyncMock(return_value=None)

        async def _click(selector, **kwargs):
            clicked.append(selector)

        page.click = _click
        return page

    def test_clicks_reportes_dropdown_then_report_href(self):
        clicked = []
        page = self._make_nav_page(clicked)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._navigate_to_distribucion(
                page, "iansa", 30_000
            )
        )

        assert any("Reportes" in c for c in clicked), (
            f"Debe abrir el dropdown 'Reportes'. Clicks: {clicked}"
        )
        assert any(HREF_REPORTE_DETALLE in c for c in clicked), (
            f"Debe clickear el href del Reporte Detalle. Clicks: {clicked}"
        )

    def test_does_not_use_direct_goto(self):
        """goto() directo es flaky (race con el redirect del login) — el
        extractor debe navegar por el menú, no saltar por URL."""
        clicked = []
        page = self._make_nav_page(clicked)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._navigate_to_distribucion(
                page, "iansa", 30_000
            )
        )

        page.goto.assert_not_called()

    def test_does_not_use_distribucion_menu(self):
        """IANSA no cuelga de 'Módulo Distribución' (ahí vive Monitor de
        Viajes, la página equivocada que usaba el scraper viejo)."""
        clicked = []
        page = self._make_nav_page(clicked)

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._navigate_to_distribucion(
                page, "iansa", 30_000
            )
        )

        assert not any("Distribución" in c for c in clicked), (
            f"No debe navegar por Módulo Distribución. Clicks: {clicked}"
        )


# ---------------------------------------------------------------------------
# 2 — Fechas por evaluate, no por locator
# ---------------------------------------------------------------------------


class TestSetDateRange:
    def test_writes_and_verifies_via_evaluate(self):
        page = MagicMock()
        page.evaluate = AsyncMock(
            return_value={"from": "05-08-2026", "to": "07-08-2026"}
        )
        page.locator = MagicMock()

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                page, date(2026, 8, 5), date(2026, 8, 7)
            )
        )

        page.evaluate.assert_called_once()
        js_arg, values_arg = page.evaluate.call_args[0]
        assert "#txt_f1" in js_arg and "#txt_f2" in js_arg
        assert values_arg == ["05-08-2026", "07-08-2026"]

    def test_never_touches_locator(self):
        """Los locators cuelgan en esta página — la verificación del valor
        seteado tiene que salir del mismo evaluate, no de input_value()."""
        page = MagicMock()
        page.evaluate = AsyncMock(
            return_value={"from": "05-08-2026", "to": "07-08-2026"}
        )
        page.locator = MagicMock()

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                page, date(2026, 8, 5), date(2026, 8, 7)
            )
        )

        page.locator.assert_not_called()

    def test_raises_when_values_dont_match(self):
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={"from": "WRONG", "to": "WRONG"})

        with pytest.raises(RuntimeError, match="No se pudo setear el rango"):
            asyncio.run(
                QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                    page, date(2026, 8, 5), date(2026, 8, 7)
                )
            )

    def test_raises_when_inputs_missing(self):
        """Si el DOM no tiene los inputs, evaluate devuelve None/None —
        debe fallar ruidosamente en vez de seguir y exportar datos sin filtrar."""
        page = MagicMock()
        page.evaluate = AsyncMock(return_value={"from": None, "to": None})

        with pytest.raises(RuntimeError, match="No se pudo setear el rango"):
            asyncio.run(
                QAnalyticsCumplimientoIansaExtractor()._set_date_range(
                    page, date(2026, 8, 5), date(2026, 8, 7)
                )
            )


# ---------------------------------------------------------------------------
# 3 — Búsqueda: partial postback
# ---------------------------------------------------------------------------


class TestSubmitSearch:
    def _make_search_page(self):
        page = MagicMock()
        order = []

        @asynccontextmanager
        async def _expect_response_cm(*args, **kwargs):
            order.append("enter_expect_response")
            yield AsyncMock()
            order.append("exit_expect_response")

        page.expect_response = MagicMock(side_effect=_expect_response_cm)

        async def _evaluate(js, *args):
            order.append(f"evaluate:{js}")

        page.evaluate = _evaluate
        page.wait_for_timeout = AsyncMock(return_value=None)
        page.locator = MagicMock()
        page.screenshot = AsyncMock(return_value=None)
        page.content = AsyncMock(return_value="<html/>")
        return page, order

    def test_clicks_btn_img_inside_expect_response(self):
        page, order = self._make_search_page()

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._submit_search(
                page, timeout_ms=30_000
            )
        )

        click_steps = [i for i, s in enumerate(order) if SEL_BTN_BUSCAR_IANSA.lstrip("#") in s]
        assert click_steps, f"Debe clickear #btnImg. Orden: {order}"

        enter = order.index("enter_expect_response")
        exit_ = order.index("exit_expect_response")
        assert enter < click_steps[0] < exit_, (
            f"El click debe ocurrir DENTRO del expect_response. Orden: {order}"
        )

    def test_does_not_click_base_class_button(self):
        """#btn_buscar no existe en esta página."""
        page, order = self._make_search_page()

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._submit_search(
                page, timeout_ms=30_000
            )
        )

        assert not any("btn_buscar" in s for s in order), (
            f"No debe usar #btn_buscar (no existe acá). Orden: {order}"
        )

    def test_settles_after_postback(self):
        """El response llega con los headers, no con el DOM re-renderizado:
        sin settle, el export puede leer la grilla vieja."""
        page, order = self._make_search_page()

        asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._submit_search(
                page, timeout_ms=30_000
            )
        )

        assert page.wait_for_timeout.called
        assert page.wait_for_timeout.call_args[0][0] >= 1000


# ---------------------------------------------------------------------------
# 4 — Exportación: descarga directa
# ---------------------------------------------------------------------------


class TestDownloadExport:
    def test_clicks_bt_exportar_and_saves_via_build_path(self, tmp_path):
        page = MagicMock()

        download = MagicMock()
        download.suggested_filename = "Reporte Detalle.xls"
        download.save_as = AsyncMock(return_value=None)

        @asynccontextmanager
        async def _expect_download_cm(*args, **kwargs):
            yield _FakeDownloadInfo(download)

        page.expect_download = MagicMock(side_effect=_expect_download_cm)

        evaluated = []

        async def _evaluate(js, *args):
            evaluated.append(js)

        page.evaluate = _evaluate

        path = asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._download_export(
                page,
                "iansa",
                1780000000,
                date(2026, 8, 5),
                date(2026, 8, 7),
                str(tmp_path),
                30_000,
            )
        )

        assert any(SEL_BTN_EXPORT_IANSA.lstrip("#") in js for js in evaluated), (
            f"Debe clickear #BtExportar. Evaluates: {evaluated}"
        )
        assert "tms/qanalytics/cumplimiento-iansa/iansa/" in path
        assert path.endswith(".xls")
        download.save_as.assert_called_once_with(path)

    def test_falls_back_to_xls_when_no_extension(self, tmp_path):
        page = MagicMock()

        download = MagicMock()
        download.suggested_filename = "ReporteSinExtension"
        download.save_as = AsyncMock(return_value=None)

        @asynccontextmanager
        async def _expect_download_cm(*args, **kwargs):
            yield _FakeDownloadInfo(download)

        page.expect_download = MagicMock(side_effect=_expect_download_cm)

        async def _evaluate(js, *args):
            return None

        page.evaluate = _evaluate

        path = asyncio.run(
            QAnalyticsCumplimientoIansaExtractor()._download_export(
                page,
                "iansa",
                1780000000,
                date(2026, 8, 5),
                date(2026, 8, 7),
                str(tmp_path),
                30_000,
            )
        )

        assert path.endswith(".xls")


# ---------------------------------------------------------------------------
# Registro en el factory
# ---------------------------------------------------------------------------


class TestFactoryRegistration:
    def test_combo_is_registered(self):
        from app.tms.factory import get_adapter

        adapter = get_adapter("qanalytics", "cumplimiento-iansa")
        assert isinstance(adapter, QAnalyticsCumplimientoIansaExtractor)
        assert adapter.SOURCE_NAME == "qanalytics"
        assert adapter.PRODUCT_NAME == "cumplimiento-iansa"

    def test_existing_combos_still_work(self):
        """Backward compat: agregar IANSA no debe romper los otros 3."""
        from app.tms.factory import get_adapter

        assert get_adapter("qanalytics", "trips").PRODUCT_NAME == "trips"
        assert (
            get_adapter("qanalytics", "cumplimiento-sap").PRODUCT_NAME
            == "cumplimiento-sap"
        )
        assert get_adapter("sodimac", "trips").PRODUCT_NAME == "trips"
