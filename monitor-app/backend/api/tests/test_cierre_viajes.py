"""El paso "Viajes" del Cierre.

La unica escritura de WebCarga sobre un viaje es "no asignado por WebCarga",
con motivo (regla 2 de Pablo). El trip_status del TMS no se toca nunca.
"""
from __future__ import annotations

import pytest

from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion


async def test_el_dominio_de_motivos_existe_y_tiene_codigo_estable(conexion_revertida):
    """Sin al menos una fila, status_taxonomies.py:30 responde 422
    'domain desconocido' y el selector de motivos no carga."""
    filas = await conexion_revertida.fetch(
        "SELECT code, label FROM app.status_taxonomies "
        "WHERE domain = 'TRIP_UNASSIGNED_REASON' AND active ORDER BY sort_order")

    assert len(filas) >= 4, "el dominio quedo vacio: el selector va a dar 422"
    codigos = {f["code"] for f in filas}
    assert None not in codigos, "un motivo sin code se rompe al renombrar la etiqueta"
    assert {"SIN_CAMION", "SIN_PROVEEDOR", "NO_DA_TARIFA", "MANDANTE_DECLINO"} <= codigos
