"""Los viajes del día no se filtran por TMS (10/10).

Qué tracto o conductor tuvo carga el día D sale de una sola cadena:
app.trip_fleet_links → app.v_trip_fleet_resolution → app.trips_del_dia(D) →
services/cierre_lineas.py. Desde julio, diez consultas le agregaban a mano
`AND t.source_system != 'sodimac'` ("esa fuente no resuelve flota por la misma
cadena"). Cuando Operaciones empezó a vincular la flota en los viajes de
Sodimac, la premisa dejó de ser cierta: el viaje quedaba asignado en el Monitor
y su tracto de Equipo Completo seguía "No asignado" en el Cierre, en el reporte
y en los disponibles (ítem 4 de la minuta del 09/10). Decisión del usuario
(09/10): "si tiene patente y/o conductor califica como asignado, del TMS o del
vínculo en la app", sin importar el TMS.

Si un TMS no aporta flota, la vista no la resuelve y el viaje no cuenta solo.
No hace falta excluirlo, y excluirlo esconde lo que Operaciones sí vinculó.
"""
from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

# SQL dentro de los .py: la comparación contra un literal entre comillas simples.
EXCLUSION_POR_TMS = re.compile(r"source_system\s*(?:!=|<>)\s*'|source_system\s+NOT\s+IN\s*\(", re.I)


def test_ninguna_consulta_de_la_app_excluye_un_tms():
    encontrados = [
        f"{ruta.relative_to(APP.parent)}:{n}: {linea.strip()}"
        for ruta in sorted(APP.rglob("*.py"))
        for n, linea in enumerate(ruta.read_text().splitlines(), start=1)
        if EXCLUSION_POR_TMS.search(linea)
    ]
    assert encontrados == [], "\n".join(encontrados)
