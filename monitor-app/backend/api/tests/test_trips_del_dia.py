"""Qué viajes ocuparon un día: app.trips_del_dia(fecha).

Es la única definición de "este viaje ocupó a su conductor y a su tracto el
día D" que leen el Cierre (los dos ejes), el reporte, el pre-cierre y los
disponibles del Diario. Reemplazó a `planning_date = D OR (planning_date < D
AND is_active)`, que usaba el is_active de AHORA.

Casos de la Solicitud de Cambios Diario 2.0 (16/09):
- Efrain Suarez, viaje 2051880: planificado el 11/09, entregas el 12 y el 13,
  cerrado por el TMS el 13. El 13/09 lo mostraba "No asignado".
- Conductor con la ruta CANCELADA seguía "Asignado".

Todo corre en la transacción revertida de `conexion_revertida`, con viajes
creados por el test.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.integracion

D = date.fromisoformat("2026-06-10")


async def _viaje(conn, *, planning_date, trip_status="CERRADO FINALIZADO", is_active=False,
                 status_reported_at=None, motivo=None):
    trip_id = uuid.uuid4()
    await conn.execute(
        """
        INSERT INTO app.trips
            (id, planning_date, client_name, source_system_trip_id, trip_status,
             status_reported_at, is_active, is_assigned, unassigned_reason_id)
        VALUES ($1, $2, 'TEST-DIAS', $3, $4, $5, $6, true, $7)
        """,
        trip_id, planning_date, str(trip_id), trip_status,
        status_reported_at or datetime.combine(planning_date, datetime.min.time()),
        is_active, motivo,
    )
    return trip_id


async def _parada_gps(conn, trip_id, salida_utc: datetime):
    await conn.execute(
        """
        INSERT INTO app.trip_stops (stop_id, trip_id, stop_order, stop_type, gps_departure_date)
        VALUES ($1, $2, 1, 'DESTINATION', $3)
        """,
        str(uuid.uuid4()), trip_id, salida_utc,
    )


async def _dias(conn, trip_id, desde, hasta):
    dias = []
    d = desde
    while d <= hasta:
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM app.trips_del_dia($1) WHERE trip_id = $2)", d, trip_id):
            dias.append(d)
        d += timedelta(days=1)
    return dias


async def test_un_viaje_cerrado_ocupa_los_dias_en_que_tuvo_marcas(conexion_revertida):
    """Efrain: cerrado por el TMS, pero con entregas dos días después de su
    planificación. Esos días los trabajó, y el cierre de esos días tiene que
    decirlo aunque se abra una semana después."""
    conn = conexion_revertida
    viaje = await _viaje(conn, planning_date=D)
    await _parada_gps(conn, viaje, datetime(2026, 6, 12, 18, 0, tzinfo=timezone.utc))

    assert await _dias(conn, viaje, D - timedelta(days=1), D + timedelta(days=3)) == [
        D, D + timedelta(days=1), D + timedelta(days=2),
    ]


async def test_un_cancelado_no_ocupa_ningun_dia(conexion_revertida):
    conn = conexion_revertida
    viaje = await _viaje(conn, planning_date=D, trip_status="CANCELADO")

    assert await _dias(conn, viaje, D, D) == []


async def test_un_viaje_declarado_no_ocupa_ningun_dia(conexion_revertida):
    conn = conexion_revertida
    motivo = await conn.fetchval(
        "SELECT id FROM app.status_taxonomies WHERE domain = 'TRIP_UNASSIGNED_REASON' LIMIT 1")
    viaje = await _viaje(conn, planning_date=D, motivo=motivo)

    assert await _dias(conn, viaje, D, D) == []


async def test_un_viaje_abierto_ocupa_hasta_su_ultimo_reporte_y_no_mas(conexion_revertida):
    """Sin marcas en las paradas, lo que lo extiende es que el TMS lo siga
    informando. Un viaje activo que dejó de reportarse no ocupa los días en
    que nadie sabe dónde estuvo — antes lo hacía mientras `is_active` siguiera
    encendido, hasta 7 días."""
    conn = conexion_revertida
    viaje = await _viaje(
        conn, planning_date=D, trip_status="RUTA", is_active=True,
        status_reported_at=datetime(2026, 6, 11, 22, 0),
    )

    assert await _dias(conn, viaje, D, D + timedelta(days=3)) == [D, D + timedelta(days=1)]


async def test_la_marca_se_lee_en_hora_de_chile(conexion_revertida):
    """02:00 UTC del 11 son las 22:00 del 10 en Chile: esa entrega es del 10.
    Con ::date sobre UTC el viaje ocuparía un día que no trabajó."""
    conn = conexion_revertida
    viaje = await _viaje(conn, planning_date=D)
    await _parada_gps(conn, viaje, datetime(2026, 6, 11, 2, 0, tzinfo=timezone.utc))

    assert await _dias(conn, viaje, D, D + timedelta(days=1)) == [D]


def test_ningun_lector_del_cierre_usa_el_is_active_de_ahora():
    """La regla vieja estaba copiada en 16 lugares. Si vuelve a aparecer en
    cualquiera, un día pasado vuelve a depender de cuándo se abre."""
    from pathlib import Path

    raiz = Path(__file__).resolve().parents[1] / "app"
    culpables = [
        str(p.relative_to(raiz)) for p in raiz.rglob("*.py")
        if "planning_date < $1 AND t.is_active" in p.read_text()
        or "planning_date < dds.business_date AND" in p.read_text()
        or "planning_date < eds.business_date AND" in p.read_text()
    ]
    assert culpables == []
