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


def test_el_predicado_de_por_vencer_usa_la_constante():
    from app.services.vencimientos import DIAS_POR_VENCER, por_vencer_predicate

    sql = por_vencer_predicate("cr")
    assert str(DIAS_POR_VENCER) in sql
    assert "cr.expiration_date" in sql


def test_por_vencer_excluye_lo_ya_vencido():
    """Sin la mitad `>= CURRENT_DATE`, "por vencer" se come a "vencido" y un
    documento caducado se muestra como si solo estuviera proximo."""
    from app.services.vencimientos import por_vencer_predicate

    sql = por_vencer_predicate("cr")
    assert ">= CURRENT_DATE" in sql
    assert "<= CURRENT_DATE" in sql
