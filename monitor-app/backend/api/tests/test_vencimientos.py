"""La ventana de "por vencer" tiene UNA definicion.

Estaba escrita a mano en tres routers con el literal INTERVAL '30 days'. Este
test no comprueba el numero: comprueba que no vuelva a haber tres numeros.
"""
import pathlib
import re

ROUTERS = pathlib.Path(__file__).parent.parent / "app" / "routers"


def test_ningun_router_escribe_la_ventana_a_mano():
    culpables = []
    for archivo in sorted(ROUTERS.glob("*.py")):
        for n, linea in enumerate(archivo.read_text().splitlines(), 1):
            if re.search(r"INTERVAL\s+'\d+\s+days'", linea):
                culpables.append(f"{archivo.name}:{n}")
    assert not culpables, (
        "La ventana de vencimiento se escribio a mano en: "
        + ", ".join(culpables)
        + ". Usa app/services/vencimientos.py."
    )


def test_los_predicados_leen_la_vigencia_calculada():
    """El aviso es dato (regla del tipo o Configuracion > Alertas), no una
    constante; el vencimiento sale de la politica y de las reglas, no de la
    fecha suelta; y no hay llamadas por registro a funciones no inlineables."""
    from app.services import vencimientos as v

    assert not hasattr(v, "DIAS_POR_VENCER")
    vencido, por_vencer, pendiente = (
        v.vencido_predicate("cr"), v.por_vencer_predicate("cr"), v.pendiente_predicate("cr"))
    assert "expiration_policy" in vencido and "reglas_aplicables(" in vencido
    assert "'documento_por_vencer'" in por_vencer
    assert "exigible_on" in pendiente
    assert "documento_vence_el" not in pendiente


def test_por_vencer_excluye_lo_ya_vencido():
    """Sin la mitad `>= hoy`, "por vencer" se come a "vencido" y un
    documento caducado se muestra como si solo estuviera proximo."""
    from app.services.vencimientos import por_vencer_predicate

    sql = por_vencer_predicate("cr")
    assert ">= public.hoy_chile()" in sql
    assert "<= public.hoy_chile()" in sql


APP = pathlib.Path(__file__).parent.parent / "app"


def test_nadie_compara_expiration_date_a_mano():
    """`plantilla_certificacion.py` tenia su propia copia de "vencido". Una
    segunda copia es como el embudo y el cajon ya divergieron una vez."""
    culpables = []
    for archivo in sorted(APP.rglob("*.py")):
        if archivo.name == "vencimientos.py":
            continue
        for n, linea in enumerate(archivo.read_text().splitlines(), 1):
            if re.search(r"expiration_date\s*<", linea):
                culpables.append(f"{archivo.relative_to(APP)}:{n}")
    assert not culpables, "Usa vencido_predicate: " + ", ".join(culpables)


def test_vencimientos_no_usa_el_dia_utc():
    """CURRENT_DATE es el dia UTC (la base corre en UTC): entre las 21 y las
    24 de Chile adelanta un vencimiento. Todo corte se compara con
    public.hoy_chile()."""
    from app.services import vencimientos as v

    for sql in (v.por_vencer_predicate("cr"), v.vencido_predicate("cr"),
                v.pendiente_predicate("cr")):
        assert "CURRENT_DATE" not in sql
        assert "public.hoy_chile()" in sql
