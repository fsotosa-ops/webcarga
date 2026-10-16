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


MIGRACION = (Path(__file__).resolve().parents[2] / "supabase" / "migrations"
             / "20261024090000_retire_catalog_colors.sql")


@pytest.mark.integracion
async def test_la_contraccion_borra_los_colores_con_copia_y_las_vistas_siguen(conexion_revertida):
    """P1.10: la migración copia cada color a audit_log, borra las columnas de los
    dos catálogos y recrea las vistas materializadas sin ellas. Se ejecuta dentro
    de la transacción revertida del test (dos veces: es re-ejecutable)."""
    conn = conexion_revertida
    tiene_color = await conn.fetchval(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name IN ('trip_statuses', 'status_taxonomies') AND column_name IN ('bg_color', 'text_color')")
    filas = await conn.fetchval("SELECT (SELECT count(*) FROM app.trip_statuses) + (SELECT count(*) FROM app.status_taxonomies)")
    sql = MIGRACION.read_text(encoding="utf-8")
    await conn.execute(sql)
    await conn.execute(sql)

    # app.operational_states (la tabla de antes de la Ronda 43) conserva los suyos:
    # nadie la lee y su retiro está diferido aparte.
    quedan = await conn.fetchval(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name IN ('trip_statuses', 'status_taxonomies', 'asset_compliance_status', 'carrier_asset_roster') "
        "AND column_name LIKE ANY (ARRAY['%bg_color', '%text_color'])")
    assert quedan == 0
    if tiene_color:
        copias = await conn.fetchval(
            "SELECT count(*) FROM public.audit_log WHERE field = 'retired_colors' AND source = 'migration'")
        assert copias == filas
    # Las vistas siguen respondiendo, con su etiqueta de subtipo.
    await conn.fetch("SELECT asset_id, fleet_service_type_label FROM app.asset_compliance_status LIMIT 1")
    await conn.fetch("SELECT carrier_id, fleet_service_type_label FROM app.carrier_asset_roster LIMIT 1")
