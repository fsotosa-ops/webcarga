"""El paso "Viajes" del Cierre.

La unica escritura de WebCarga sobre un viaje es "no asignado por WebCarga",
con motivo (regla 2 de Pablo). El trip_status del TMS no se toca nunca.
"""
from __future__ import annotations

from datetime import date

import pytest

from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

# asyncpg tipa $1 como `date` en cuanto el SQL lo castea con `::date`: exige
# un objeto date de Python, no un string (asyncpg.exceptions.DataError si se
# le pasa "2026-08-18" a secas). Mismo patron que _parse_business_date en
# daily_closures.py.
FECHA_NEGOCIO = date.fromisoformat("2026-08-18")


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


async def test_los_cuatro_grupos_son_disjuntos(conexion_revertida):
    """Un viaje en dos grupos significa que la persona lo resuelve dos veces,
    o peor: lo resuelve en uno y sigue apareciendo en el otro."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    ids = [f["trip_id"] for f in filas]
    assert len(ids) == len(set(ids)), "hay viajes en mas de un grupo"
    assert {f["grupo"] for f in filas} <= {"hoy", "rezago", "en_curso", "abandonado"}


async def test_abandonado_no_se_deriva_de_is_active(conexion_revertida):
    """El grupo 4 existe porque is_active YA los descarto: exige recencia de 7
    dias y los apaga justo cuando empiezan a importar (sin cierre en el TMS no
    llega la orden de compra). Si se derivara de is_active estaria vacio."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    abandonados = [f for f in filas if f["grupo"] == "abandonado"]
    assert abandonados, "el grupo de abandonados quedo vacio"
    assert all(f["dias_sin_novedad"] > 7 for f in abandonados)


async def test_los_viajes_futuros_no_entran(conexion_revertida):
    """Un viaje planificado para manana no es rezago ni espera nada (3 de
    IANSA el 16/08). No hay nada que declarar sobre el."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    assert all(str(f["planning_date"]) <= "2026-08-18" for f in filas)
