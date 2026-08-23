"""Un solo criterio de "pendiente", y un trinquete para que siga siendo uno.

HISTORIA, que vale más que el test. La Ronda 129 unificó las TRES lecturas de
dentro de Certificación (`/pending`, el embudo y el cajón) en
`pendiente_predicate`. Afuera quedaron CINCO COPIAS escritas a mano —carriers.py
(x3, el `pending_mandatory` de la ficha) y trips.py (x2, el semáforo del
Diario)— y nadie lo notó porque una copia no rompe nada: simplemente contesta
distinto.

Diferían en DOS direcciones, no una:

  · `REJECTED`: las copias lo contaban, el predicado no.
  · "por vencer" (30 días): el predicado lo cuenta, las copias no.

Medido el 2026-08-23: 0 registros REJECTED y ningún código los escribe, así que
esa mitad era latente. La viva era la otra: el vehículo HKXW55 tenía 2
documentos obligatorios venciendo en 25 días que aparecían pendientes en
Certificación y NO en la ficha ni en el Diario.

Este test no verifica el resultado —eso lo hacen los tests de cada endpoint—
sino que la REGLA siga escrita una sola vez. Es el mismo idioma que el trinquete
del sistema visual del frontend: lo que se protege es que el número no crezca.
"""
from __future__ import annotations

import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1] / "app"

# El dueño de la definición. Es el único que puede escribirla.
DUENO = RAIZ / "services" / "vencimientos.py"

# La forma del criterio: una lista IN que empareja MISSING con EXPIRED. No se
# busca "MISSING" a secas porque ese valor aparece legítimamente en mapeos de
# presentación (la planilla traduce estados a etiquetas) y en los defaults.
CRITERIO = re.compile(r"IN\s*\(\s*'MISSING'\s*,\s*'EXPIRED'")


def _archivos_python() -> list[Path]:
    return [p for p in RAIZ.rglob("*.py") if p != DUENO]


def _es_comentario(linea: str) -> bool:
    """Un comentario que EXPLICA el criterio no es una copia del criterio.

    Sin esto el trinquete daba un falso positivo con el comentario de
    compliance.py que cuenta por qué `status IN ('MISSING','EXPIRED')` se venía
    usando mal. Es la misma trampa que el proyecto ya registró al buscar usos de
    una tabla por grep: la palabra aparece en prosa y no es un uso.

    Cubre las dos formas: comentario de Python (`#`) y comentario de SQL (`--`)
    dentro de una cadena, que es como está escrito casi todo el SQL de acá.
    """
    limpia = linea.strip()
    return limpia.startswith("#") or limpia.startswith("--")


def test_el_criterio_de_pendiente_se_escribe_en_un_solo_lugar():
    hallazgos = []
    for ruta in _archivos_python():
        for numero, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
            if CRITERIO.search(linea) and not _es_comentario(linea):
                hallazgos.append(f"{ruta.relative_to(RAIZ)}:{numero} — {linea.strip()[:80]}")

    assert not hallazgos, (
        "El criterio de \"pendiente\" volvió a escribirse a mano. Usa "
        "`pendiente_predicate(alias)` de services/vencimientos.py y agregale el "
        "ámbito que necesite tu consulta (ej. LEGAL_MANDATORY):\n  "
        + "\n  ".join(hallazgos)
    )


def test_el_dueno_si_lo_escribe():
    """Si esto falla, la definición se movió y el test de arriba quedó
    protegiendo un archivo que ya no manda — pasaría en verde sin verificar
    nada."""
    assert CRITERIO.search(DUENO.read_text(encoding="utf-8")), (
        f"{DUENO.name} ya no contiene la definición del criterio"
    )


def test_los_cinco_llamadores_usan_la_definicion_compartida():
    """Las cinco copias vivían acá. El test las nombra para que un borrado
    accidental del import se vea como lo que es."""
    for archivo in ("routers/carriers.py", "routers/trips.py"):
        texto = (RAIZ / archivo).read_text(encoding="utf-8")
        assert "pendiente_predicate" in texto, f"{archivo} dejó de usar la definición compartida"
