"""`has_expiration` se retiró: `expiration_policy` es la única fuente (HU-C1).

Las rutas mockeadas no lo detectarían: un SELECT que lo nombre pasa los tests y
da 500 en producción apenas la columna no exista. Se permite sólo en
comentarios `#`, que cuentan la historia."""
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"


def test_ningun_codigo_de_la_api_lee_has_expiration():
    culpables = [
        f"{ruta.relative_to(APP)}:{n}"
        for ruta in APP.rglob("*.py")
        for n, linea in enumerate(ruta.read_text().splitlines(), 1)
        if "has_expiration" in linea and not linea.lstrip().startswith("#")
    ]
    assert culpables == []
