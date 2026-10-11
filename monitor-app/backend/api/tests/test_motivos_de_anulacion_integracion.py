"""El catálogo de motivos de anulación y la carga de los anulados existentes
(spec 2026-10-10 motivos de anulación, §2.1)."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.integracion


async def test_el_catalogo_tiene_los_cuatro_motivos_iniciales(conexion_revertida):
    filas = await conexion_revertida.fetch(
        "SELECT code, label FROM app.status_taxonomies WHERE domain = 'TRIP_VOID_REASON' ORDER BY sort_order")
    assert [(f["code"], f["label"]) for f in filas] == [
        ("DUPLICADO", "Duplicado"),
        ("CARGADO_POR_ERROR", "Cargado por error"),
        ("DATOS_INCORRECTOS", "Datos incorrectos (se registró de nuevo)"),
        ("OTRO", "Otro"),
    ]


async def test_todo_viaje_anulado_tiene_motivo_de_catalogo(conexion_revertida):
    """Los 6 duplicados del 23/09 quedan con DUPLICADO, en las dos tablas."""
    for tabla in ("app.trips", "app.trips_manual"):
        sin_motivo = await conexion_revertida.fetchval(
            f"SELECT count(*) FROM {tabla} t LEFT JOIN app.status_taxonomies r ON r.id = t.void_reason_id "
            "WHERE t.voided_at IS NOT NULL AND (r.domain IS DISTINCT FROM 'TRIP_VOID_REASON')")
        assert sin_motivo == 0, tabla
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM app.trips t JOIN app.status_taxonomies r ON r.id = t.void_reason_id "
        "WHERE t.planning_date = '2026-09-23' AND r.code = 'DUPLICADO'") == 6


async def test_la_columna_de_texto_libre_ya_no_existe(conexion_revertida):
    assert await conexion_revertida.fetchval(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'app' "
        "AND table_name IN ('trips', 'trips_manual') AND column_name = 'void_reason'") == 0
