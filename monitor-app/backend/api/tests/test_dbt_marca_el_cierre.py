"""Los triggers de marca del Cierre en las tablas de dbt (spec 2026-10-10, §3.1).

Viven en el post_hook porque un --full-refresh borra lo que cree una migración.
Ningún pipeline corre `dbt test`, así que la guarda va acá, sobre el espejo de
Mage (no está en git: sin espejo, se salta)."""
from __future__ import annotations

from pathlib import Path

import pytest

DBT = Path(__file__).resolve().parents[4] / ".mage-agent/local_sync/dbt/tms/models/app"


@pytest.mark.parametrize("modelo", ["trips.sql", "trip_stops.sql"])
def test_el_post_hook_crea_los_tres_triggers_de_marca(modelo):
    ruta = DBT / modelo
    if not ruta.exists():
        pytest.skip("espejo de Mage no sincronizado en esta máquina")
    texto = ruta.read_text()
    for evento, tabla in (("ins", "NEW"), ("upd", "NEW"), ("del", "OLD")):
        assert f"DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_{evento} ON {{{{ this }}}}" in texto
        assert (f"REFERENCING {tabla} TABLE AS changed FOR EACH STATEMENT "
                "EXECUTE FUNCTION app.enqueue_closure_recompute()") in texto
    # Los nombres viejos, en español, se retiran (estándar de la base: inglés,
    # verbo + objeto, como trg_trips_resolve_fleet_*).
    assert "CREATE TRIGGER trg_marcar_cierre" not in texto
