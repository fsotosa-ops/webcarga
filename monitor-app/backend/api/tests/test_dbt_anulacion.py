"""Las columnas de anulación en el modelo dbt de app.trips (spec 2026-10-10 anulación, §2.1).

Mismo patrón que unassigned_reason_id: la API las escribe en app.trips y en
app.trips_manual; la rama manual del modelo las lleva desde trips_manual y el
merge no las toca. Sin esto, `sync_all_columns` las borra de app.trips en la
corrida siguiente. Ningún pipeline corre `dbt test`, así que la guarda va acá,
sobre el espejo de Mage (no está en git: sin espejo, se salta)."""
from __future__ import annotations

from pathlib import Path

import pytest

MODELO = Path(__file__).resolve().parents[4] / ".mage-agent/local_sync/dbt/tms/models/app/trips.sql"
COLUMNAS = ("voided_at", "voided_by", "void_reason_id", "void_note")


def _texto() -> str:
    if not MODELO.exists():
        pytest.skip("espejo de Mage no sincronizado en esta máquina")
    return MODELO.read_text()


def test_las_columnas_de_anulacion_estan_en_merge_exclude_columns():
    config = _texto().split("schema='app'")[0]
    for col in COLUMNAS:
        assert f"'{col}'" in config, col


def test_la_rama_manual_las_lleva_desde_trips_manual():
    texto = _texto()
    for col in COLUMNAS:
        assert f"m.{col}" in texto, col


def test_el_texto_libre_void_reason_ya_no_esta_en_el_modelo():
    """Contract de la spec 2026-10-10 motivos de anulación: el motivo es de catálogo."""
    texto = _texto()
    assert "'void_reason'" not in texto
    assert "AS void_reason," not in texto
