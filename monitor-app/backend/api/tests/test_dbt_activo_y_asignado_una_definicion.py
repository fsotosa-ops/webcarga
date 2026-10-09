"""Activo y asignado: una sola definición, en dbt (09/10).

Había tres escritores sin regla común (rama TMS, rama manual, el detalle del
Monitor). Decisión del usuario: la regla vive solo en dbt, en
macros/viaje_activo_y_asignado.sql, y la usan las dos ramas de app/trips.sql y
la escotilla OR 6. Ningún pipeline corre `dbt test`, así que la guarda vive acá,
sobre el mirror de Mage (no está en git: sin mirror, se salta).
"""
from __future__ import annotations

from pathlib import Path

import pytest

DBT = Path(__file__).resolve().parents[4] / ".mage-agent/local_sync/dbt/tms"
MODELO = DBT / "models/app/trips.sql"


@pytest.fixture
def modelo() -> str:
    if not MODELO.exists():
        pytest.skip("mirror de Mage no sincronizado en esta máquina")
    return MODELO.read_text()


def test_las_dos_ramas_y_la_escotilla_usan_la_misma_macro_de_asignado(modelo):
    # rama TMS, rama manual y OR 6
    assert modelo.count("{{ viaje_asignado(") == 3


def test_activo_del_tms_se_define_una_vez(modelo):
    # rama TMS y OR 6; la manual usa la parte de estado
    assert modelo.count("{{ viaje_activo_tms(") == 2
    assert modelo.count("{{ viaje_abierto_por_estado(") == 1
    assert "trip_status NOT IN ('CANCELADO', 'Declinada', 'Removida')" not in modelo


def test_ya_no_se_fuerza_no_asignado_por_estado(modelo):
    assert "'Creada', 'Aceptada', 'Control de salida'" not in modelo


def test_la_rama_manual_ya_no_copia_los_flags_del_alta(modelo):
    manual = modelo.split("FROM app.trips_manual m")[0].rsplit("UNION ALL", 1)[1]
    assert "m.is_active                                         AS is_active" not in manual
    assert "m.is_assigned                                       AS is_assigned" not in manual
