"""El origen de un viaje se elige en un solo lugar: services/origen_del_viaje.py.

Hasta el 10/10 había cinco versiones y casi todas tomaban una parada ORIGIN
cualquiera (LIMIT 1 sin orden, o un JOIN que multiplicaba filas). Esta guarda
falla si una consulta vuelve a elegir el origen por su cuenta."""
from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
DEFINICION = APP / "services" / "origen_del_viaje.py"

# Usos que NO eligen el origen de un viaje, con su motivo.
NO_ELIGEN_EL_ORIGEN = {
    # Filtro del Monitor: "tiene algún origen igual a…" (EXISTS sobre todas las paradas).
    ("routers/trips.py", "AND ts.stop_type = 'ORIGIN' AND ts.local = ANY(?))"),
    # Catálogo de orígenes para el desplegable (agrupa todas las paradas).
    ("routers/trips.py", "WHERE ts.stop_type = 'ORIGIN' AND NULLIF(btrim(ts.local), '') IS NOT NULL"),
}


def test_ninguna_consulta_elige_el_origen_por_su_cuenta():
    encontrados = []
    for ruta in sorted(APP.rglob("*.py")):
        if ruta == DEFINICION:
            continue
        relativa = str(ruta.relative_to(APP))
        for n, linea in enumerate(ruta.read_text().splitlines(), start=1):
            if re.search(r"\.stop_type\s*=\s*'ORIGIN'", linea) and not any(
                relativa == r and fragmento in linea for r, fragmento in NO_ELIGEN_EL_ORIGEN
            ):
                encontrados.append(f"{relativa}:{n}: {linea.strip()}")
    assert encontrados == [], "\n".join(encontrados)
