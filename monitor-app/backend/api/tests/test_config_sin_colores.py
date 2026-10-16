"""El color sale del significado (Configuración, Parte 1, P1.6 y P1.10).

La API ya no recibe ni devuelve `bg_color`/`text_color`: el frontend da el tono
desde la columna del tablero (lib/states.ts). Expandir: este archivo; contraer:
la migración que borra las columnas."""
from pathlib import Path

import pytest
from pydantic import ValidationError

APP = Path(__file__).resolve().parent.parent / "app"


@pytest.mark.parametrize("modelo, datos", [
    ("app.schemas.status_taxonomy:StatusTaxonomyBody", {"domain": "DRIVER_REASON", "label": "Panne", "bg_color": "#fff"}),
    ("app.schemas.status_taxonomy:StatusTaxonomyPatch", {"text_color": "#000"}),
    ("app.routers.config:TripStatusPatch", {"bg_color": "#fff"}),
])
def test_escribir_un_color_responde_422(modelo, datos):
    import importlib
    mod, nombre = modelo.split(":")
    with pytest.raises(ValidationError):
        getattr(importlib.import_module(mod), nombre)(**datos)


def test_nadie_lee_ni_devuelve_los_colores():
    """Ningún archivo de la API menciona las columnas de color: ni los SELECT de
    meta, estados, vocabularios y flota, ni los modelos de respuesta."""
    hallazgos = [str(p.relative_to(APP)) for p in APP.rglob("*.py")
                 if "bg_color" in p.read_text() or "text_color" in p.read_text()]
    assert hallazgos == []
