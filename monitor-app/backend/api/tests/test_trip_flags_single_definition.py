"""Activo y asignado tienen una sola definición: app.is_trip_open y
app.is_trip_assigned (spec 2026-10-11). Ningún INSERT de app.trips en la API
puede escribirlos con un literal: ese fue el segundo escritor que dejaba un
viaje manual "activo, no asignado" hasta la corrida de Mage."""
from __future__ import annotations

import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
INSERT = re.compile(r"INSERT INTO app\.trips\s*\((?P<cols>[^)]*)\)\s*VALUES\s*\((?P<vals>.*?)\)\s*\"\"\"", re.S)


def test_no_insert_into_trips_hardcodes_the_flags():
    found = 0
    for path in APP.rglob("*.py"):
        for match in INSERT.finditer(path.read_text()):
            cols = match["cols"]
            if "is_assigned" not in cols and "is_active" not in cols:
                continue
            found += 1
            vals = match["vals"]
            assert "app.is_trip_open(" in vals, f"{path.name}: is_active sin app.is_trip_open"
            assert "app.is_trip_assigned(" in vals, f"{path.name}: is_assigned sin app.is_trip_assigned"
    assert found >= 1, "la guarda no encontró el INSERT del alta manual: revisar la expresión regular"
