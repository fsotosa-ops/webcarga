"""El backend escribe copy que el usuario lee, y no tenía quien lo vigilara.

El frontend tiene `lib/copy/espanol-neutral.test.ts` desde hace rondas; el
backend no, y por eso tres mensajes de error de Certificación llegaron a
producción en voseo ("Indicá un destino", "Verificá la categoría") mientras la
misma pantalla, en su mitad de React, decía "Indica" y "Verifica".

La regla es del usuario y es explícita: español neutral, nunca voseo. El
producto opera en Chile.
"""
from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent / "app"

# Formas de voseo, no palabras que casualmente lleven tilde. Cada una es una
# conjugación que sólo existe en el paradigma vos/vosotros: el imperativo
# agudo (indicá, verificá, elegí) y el presente (tenés, podés).
#
# Se listan a mano en vez de con una regla morfológica porque "está", "quedó",
# "categoría" y "según" son español neutral perfecto y una regla los barrería.
VOSEO = [
    # imperativos
    "indicá", "verificá", "elegí", "cargá", "revisá", "seleccioná", "arrastrá",
    "poné", "sacá", "mirá", "contá", "dejá", "probá", "usá", "andá", "vení",
    "hacé", "tené", "escribí", "leé", "guardá", "borrá", "marcá",
    "asigná", "confirmá", "cerrá", "abrí", "buscá", "agregá", "quitá",
    # imperativo + pronombre enclítico, que no lleva tilde
    "devolvelo", "asignalo", "marcalo", "borralo", "guardalo", "cerralo",
    "mandalo", "sacalo", "dejalo", "ponelo", "hacelo", "tenelo",
    # presente
    "tenés", "podés", "querés", "sabés", "vas a poder", "necesitás", "debés",
]
PATRON = re.compile(r"\b(" + "|".join(re.escape(v) for v in VOSEO) + r")\b", re.IGNORECASE)


def _archivos() -> list[Path]:
    return sorted(p for p in RAIZ.rglob("*.py") if "__pycache__" not in p.parts)


def test_el_backend_no_escribe_voseo():
    """Recorre `app/` entero: mensajes de error, docstrings y comentarios.

    No distingue copy de comentario a propósito. Un comentario en voseo es el
    borrador del próximo mensaje de error en voseo — así llegaron los tres que
    este test nació corrigiendo.
    """
    hallazgos: list[str] = []
    for archivo in _archivos():
        for numero, linea in enumerate(archivo.read_text(encoding="utf-8").splitlines(), 1):
            for encontrado in PATRON.finditer(linea):
                hallazgos.append(
                    f"{archivo.relative_to(RAIZ.parent)}:{numero} — «{encontrado.group(0)}»"
                )

    assert not hallazgos, (
        "Voseo en el backend. El español del producto es neutral (opera en Chile):\n  "
        + "\n  ".join(hallazgos)
    )


def test_la_guarda_mira_archivos_de_verdad():
    """Guarda de la guarda: si el recorrido deja de encontrar archivos, el test
    de arriba pasa vacío y no vigila nada. Ya pasó con el equivalente del
    frontend, que por eso lleva la misma comprobación.
    """
    archivos = _archivos()
    assert len(archivos) > 20, f"El recorrido de {RAIZ} encontró sólo {len(archivos)} archivos"
    assert any(a.name == "compliance.py" for a in archivos)
