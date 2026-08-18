"""El paso "Viajes" del Cierre.

La unica escritura de WebCarga sobre un viaje es "no asignado por WebCarga",
con motivo (regla 2 de Pablo). El trip_status del TMS no se toca nunca.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from tests.conftest import PoolDeUnaConexion

pytestmark = pytest.mark.integracion

# asyncpg tipa $1 como `date` en cuanto el SQL lo castea con `::date`: exige
# un objeto date de Python, no un string (asyncpg.exceptions.DataError si se
# le pasa "2026-08-18" a secas). Mismo patron que _parse_business_date en
# daily_closures.py.
FECHA_NEGOCIO = date.fromisoformat("2026-08-18")

# `RUTA` (group_id 'en_ruta' en app.trip_statuses) — cualquier estado no
# terminal sirve para probar el predicado; este es el mismo que domina el
# grupo "abandonado" en produccion.
ESTADO_NO_TERMINAL = "RUTA"


async def _crear_viaje(
    conexion,
    *,
    planning_date,
    is_active,
    is_assigned,
    dias_sin_novedad=0,
    trip_status=ESTADO_NO_TERMINAL,
):
    """Inserta un viaje sintetico en app.trips, dentro de la transaccion
    revertida de `conexion_revertida` — nunca sobrevive al test.

    `app.trips` no tiene mas restricciones que la PK y el FK opcional de
    unassigned_reason_id (verificado contra la base real, pg_constraint), asi
    que alcanza con las columnas que el predicado lee. `status_reported_at`
    se calcula desde `dias_sin_novedad` para controlar exactamente la
    antiguedad que cada caso necesita."""
    trip_id = uuid.uuid4()
    status_reported_at = datetime.utcnow() - timedelta(days=dias_sin_novedad)
    await conexion.execute(
        """
        INSERT INTO app.trips
            (id, planning_date, client_name, source_system_trip_id, trip_status,
             status_reported_at, is_active, is_assigned)
        VALUES ($1, $2, 'TEST-CIERRE', $3, $4, $5, $6, $7)
        """,
        trip_id, planning_date, str(trip_id), trip_status, status_reported_at,
        is_active, is_assigned,
    )
    return trip_id


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


async def test_cada_grupo_clasifica_al_viaje_que_le_corresponde(conexion_revertida):
    """Reemplaza dos tests que no probaban lo que decian: un SELECT con un
    solo CASE por fila sobre una tabla con PK jamas repite un trip_id (eso
    solo lo rompe un fan-out de JOIN, y aca no hay ninguno) — comprobar
    "disjuntos" asi era tautologico. Y depender de que produccion tenga
    abandonados hoy se cae el dia que operaciones los resuelve a todos, que
    es justamente el resultado bueno.

    Se prueba el predicado de verdad: un viaje sintetico por grupo, cada uno
    con los valores minimos que decide su clasificacion, y se verifica que
    cada uno aterriza en el grupo que le corresponde — ni en otro, ni en
    ninguno."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    id_hoy = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO,
        is_active=True, is_assigned=False)
    id_rezago = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=False)
    id_en_curso = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=3),
        is_active=True, is_assigned=True)
    id_abandonado = await _crear_viaje(
        conexion_revertida, planning_date=FECHA_NEGOCIO - timedelta(days=30),
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    grupo_por_id = {f["trip_id"]: f["grupo"] for f in filas}

    esperado = {
        id_hoy: "hoy",
        id_rezago: "rezago",
        id_en_curso: "en_curso",
        id_abandonado: "abandonado",
    }
    for trip_id, grupo_esperado in esperado.items():
        assert trip_id in grupo_por_id, f"el viaje sintetico de {grupo_esperado} no aparecio en ningun grupo"
        assert grupo_por_id[trip_id] == grupo_esperado, (
            f"el viaje sintetico de {grupo_esperado} aterrizo en {grupo_por_id[trip_id]}")

    # Disjuntos, ahora si probado con datos que realmente cubren los cuatro
    # casos: cada id sintetico aparece una sola vez en el resultado completo.
    ids_en_resultado = [f["trip_id"] for f in filas]
    assert len(ids_en_resultado) == len(set(ids_en_resultado)), "hay viajes en mas de un grupo"


async def test_viaje_sin_planning_date_puede_ser_abandonado(conexion_revertida):
    """Bug real: la CTE excluia toda fila con planning_date IS NULL antes de
    que la rama `abandonado` pudiera verla, aunque esa rama no necesita
    fecha. Hoy hay 1 viaje asi en produccion (Sin Registros, sin fecha) — no
    entraba a ningun grupo y nadie se enteraba, que es exactamente lo que
    este servicio existe para evitar."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    id_sin_fecha = await _crear_viaje(
        conexion_revertida, planning_date=None,
        is_active=False, is_assigned=False, dias_sin_novedad=10)

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    fila = next((f for f in filas if f["trip_id"] == id_sin_fecha), None)

    assert fila is not None, "el viaje sin planning_date no aparecio en ningun grupo"
    assert fila["grupo"] == "abandonado"
    assert fila["planning_date"] is None


async def test_los_viajes_futuros_no_entran(conexion_revertida):
    """Un viaje planificado para manana no es rezago ni espera nada (3 de
    IANSA el 16/08). No hay nada que declarar sobre el."""
    from app.services.cierre_viajes import SQL_GRUPOS_CIERRE

    filas = await conexion_revertida.fetch(SQL_GRUPOS_CIERRE, FECHA_NEGOCIO)
    # planning_date IS NULL es valido para "abandonado" desde la correccion
    # de arriba — no es un viaje futuro, es un viaje sin fecha.
    assert all(
        f["planning_date"] is None or f["planning_date"] <= FECHA_NEGOCIO
        for f in filas)
