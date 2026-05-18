"""
Tests unitarios para el adapter QAnalytics.

Cubren los tres bugs confirmados por logs de Cloud Run (2026-05-18):
  1. Modal: checkboxes.nth(i).check(timeout=5000) falla cuando la animación
     Bootstrap del modal no terminó — el elemento no pasa "actionability".
  2. Modal: falta esperar la animación fade-in antes de interactuar.
  3. Search: el click de #btn_buscar no esperaba la respuesta XHR del
     UpdatePanel — el export podía capturar datos pre-filtro.

No requieren credenciales ni browser. Correr con:
    cd extraction_service
    python -m pytest tests/test_qanalytics_adapter.py -v
"""
import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from app.tms.qanalytics.scraper import (
    QAnalyticsExtractor,
    SEL_MODAL_CERRAR,
    SEL_MODAL_CHECKBOXES,
    SEL_MODAL_PENDIENTES,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_page(*, modal_visible=True, checkbox_count=2, evaluate_state=None, check_raises=None):
    """Construye un mock de Page con comportamiento configurable."""
    page = MagicMock()

    modal = AsyncMock()
    if modal_visible:
        modal.wait_for = AsyncMock(return_value=None)
    else:
        modal.wait_for = AsyncMock(side_effect=PlaywrightTimeoutError("no modal"))

    cerrar = AsyncMock()
    cerrar.click = AsyncMock(return_value=None)

    checkboxes = MagicMock()
    checkboxes.count = AsyncMock(return_value=checkbox_count)

    checkbox_item = AsyncMock()
    if check_raises:
        checkbox_item.check = AsyncMock(side_effect=check_raises)
    else:
        checkbox_item.check = AsyncMock(return_value=None)
    checkboxes.nth = MagicMock(return_value=checkbox_item)

    def _locator(sel):
        if sel == SEL_MODAL_PENDIENTES:
            return modal
        if sel == SEL_MODAL_CHECKBOXES:
            return checkboxes
        if sel == SEL_MODAL_CERRAR:
            return cerrar
        return AsyncMock()

    page.locator = MagicMock(side_effect=_locator)
    page.wait_for_function = AsyncMock(return_value=None)
    page.wait_for_timeout = AsyncMock(return_value=None)
    page.screenshot = AsyncMock(return_value=None)
    page.content = AsyncMock(return_value="<html/>")

    state = evaluate_state if evaluate_state is not None else {"marked": checkbox_count, "total": checkbox_count}
    # evaluate call order: 1=hook alert, 2=main mark, 3=modal('hide'), 4=last_alert (error path only)
    page.evaluate = AsyncMock(side_effect=[None, state, None, None])

    return page, modal, checkboxes, checkbox_item


# ---------------------------------------------------------------------------
# Bug 1 — Modal: reemplazar loop .check() por evaluate atómico
# ---------------------------------------------------------------------------

class TestModalCheckboxViaEvaluate:
    """
    Verifica que _handle_pendientes_modal_if_open NO usa checkboxes.nth(i).check().

    Logs 2026-05-18: check(timeout=5000) lanzaba TimeoutError porque la animación
    Bootstrap no había terminado. Solución: hacer el marking con page.evaluate().
    """

    def test_succeeds_when_check_would_timeout(self):
        """OLD code: check() lanza TimeoutError → falla. NEW code: evaluate() → pasa."""
        page, modal, checkboxes, item = _make_page(
            modal_visible=True,
            checkbox_count=2,
            check_raises=PlaywrightTimeoutError("Timeout 5000ms exceeded"),
        )

        asyncio.run(QAnalyticsExtractor()._handle_pendientes_modal_if_open(page, "test"))

        assert page.evaluate.call_count >= 2, (
            "Se esperaban al menos 2 llamadas a page.evaluate() "
            "(hook alert + mark checkboxes)"
        )

    def test_check_not_called_in_new_implementation(self):
        """Garantía: .check() de Playwright no se invoca en el flujo normal."""
        page, modal, checkboxes, item = _make_page(modal_visible=True, checkbox_count=2)

        asyncio.run(QAnalyticsExtractor()._handle_pendientes_modal_if_open(page, "test"))

        item.check.assert_not_called()

    def test_raises_when_no_checkboxes_marked(self):
        """Si evaluate retorna marked=0, debe levantar RuntimeError con contexto."""
        page, modal, checkboxes, item = _make_page(
            modal_visible=True,
            checkbox_count=2,
            evaluate_state={"marked": 0, "total": 2},
        )

        with pytest.raises(RuntimeError, match="No se logró marcar"):
            asyncio.run(QAnalyticsExtractor()._handle_pendientes_modal_if_open(page, "test"))

    def test_no_op_when_modal_not_visible(self):
        """Si el modal no aparece en 5s, retorna silenciosamente sin tocar evaluate."""
        page, modal, checkboxes, item = _make_page(modal_visible=False)

        asyncio.run(QAnalyticsExtractor()._handle_pendientes_modal_if_open(page, "test"))

        page.evaluate.assert_not_called()


# ---------------------------------------------------------------------------
# Bug 2 — Modal: wait_for_timeout para animación Bootstrap
# ---------------------------------------------------------------------------

class TestModalAnimationWait:
    """
    Verifica que se espera la animación fade-in del modal antes de interactuar.

    Bootstrap anima el modal con CSS transition (~300ms). Si se interactúa
    antes, el backdrop cubre los checkboxes y Playwright los marca como
    "not stable" / "intercepted by another element".
    """

    def test_wait_for_timeout_called_after_modal_visible(self):
        """Tras modal.wait_for(visible), debe llamarse page.wait_for_timeout(N>=300)."""
        page, modal, checkboxes, item = _make_page(modal_visible=True, checkbox_count=1)

        asyncio.run(QAnalyticsExtractor()._handle_pendientes_modal_if_open(page, "test"))

        assert page.wait_for_timeout.called, (
            "page.wait_for_timeout() debe llamarse tras modal.wait_for(visible) "
            "para dejar que la animación Bootstrap termine."
        )
        timeout_arg = page.wait_for_timeout.call_args[0][0]
        assert timeout_arg >= 300, (
            f"El wait debe ser >= 300ms para cubrir la animación Bootstrap "
            f"(recibido: {timeout_arg}ms)"
        )


# ---------------------------------------------------------------------------
# Bug 3 — Search: esperar XHR UpdatePanel antes de exportar
# ---------------------------------------------------------------------------

class TestSubmitSearchWaitsForResponse:
    """
    Verifica que _submit_search() envuelve el click de #btn_buscar en
    page.expect_response() para garantizar que la tabla tiene datos filtrados.

    Logs 2026-05-18: el XHR de btn_buscar tardaba ~4s. El código old clickeaba
    y pasaba inmediatamente al export, capturando la tabla pre-filtro.
    """

    def _make_submit_page(self):
        page = MagicMock()
        call_order = []

        @asynccontextmanager
        async def _expect_response_cm(*args, **kwargs):
            call_order.append("enter_expect_response")
            yield AsyncMock()
            call_order.append("exit_expect_response")

        page.expect_response = MagicMock(side_effect=_expect_response_cm)

        btn = AsyncMock()

        async def _click(*args, **kwargs):
            call_order.append("click_btn_buscar")

        btn.click = _click
        page.locator = MagicMock(return_value=btn)
        page.screenshot = AsyncMock(return_value=None)
        page.content = AsyncMock(return_value="<html/>")

        return page, call_order

    def test_expect_response_called(self):
        """_submit_search debe llamar page.expect_response() para esperar el XHR."""
        extractor = QAnalyticsExtractor()
        page, _ = self._make_submit_page()

        asyncio.run(extractor._submit_search(page, timeout_ms=30_000))

        assert page.expect_response.called, (
            "_submit_search debe llamar page.expect_response() para esperar "
            "que el UpdatePanel XHR de QAnalytics retorne antes de continuar."
        )

    def test_click_inside_expect_response_block(self):
        """El click de #btn_buscar debe ocurrir DENTRO del bloque expect_response."""
        extractor = QAnalyticsExtractor()
        page, call_order = self._make_submit_page()

        asyncio.run(extractor._submit_search(page, timeout_ms=30_000))

        assert "enter_expect_response" in call_order
        assert "click_btn_buscar" in call_order
        assert "exit_expect_response" in call_order

        enter = call_order.index("enter_expect_response")
        click = call_order.index("click_btn_buscar")
        exit_ = call_order.index("exit_expect_response")

        assert enter < click < exit_, (
            f"El click debe ocurrir DENTRO del expect_response. "
            f"Orden actual: {call_order}"
        )
