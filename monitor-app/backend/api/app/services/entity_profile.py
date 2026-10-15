"""La ficha propia de un conductor o un equipo (D4, Entrega C 14/10): dónde trabajó y qué hizo.

- `assignment_history`: los períodos de empresa (app.fleet_assignment_periods, D2), el vigente
  primero. El historial empieza el día del despliegue de D2; lo anterior aparece como un período
  sin fecha de inicio.
- `activity`: el último viaje y cuántos viajes hizo en 30 días, con la misma resolución de flota
  que el Monitor (app.v_trip_fleet_resolution). Un viaje anulado no cuenta. Es un resumen: el
  detalle se ve en el Monitor filtrado.
"""
from __future__ import annotations

from typing import Literal

from .cliente_del_viaje import join_cliente, nombre_del_cliente

Kind = Literal["DRIVER", "ASSET"]

_RELATION = {"DRIVER": "DRIVER_CARRIER", "ASSET": "ASSET_CARRIER"}
_RESOLVED = {"DRIVER": "vfr.resolved_driver_id", "ASSET": "vfr.resolved_tractor_asset_id"}


async def assignment_history(db, kind: Kind, entity_id: str) -> list[dict]:
    rows = await db.fetch(
        """
        SELECT p.counterpart_id::text AS carrier_id, c.business_name AS carrier_name,
               c.operational_status AS carrier_status,
               lower(p.valid_during) AS valid_from,
               (upper(p.valid_during) - 1) AS valid_until,
               upper_inf(p.valid_during) AS current
        FROM app.fleet_assignment_periods p
        JOIN public.carriers c ON c.id = p.counterpart_id
        WHERE p.relation = $1 AND p.subject_id = $2
        ORDER BY upper_inf(p.valid_during) DESC, upper(p.valid_during) DESC NULLS FIRST
        """,
        _RELATION[kind], entity_id,
    )
    return [dict(r) for r in rows]


async def activity(db, kind: Kind, entity_id: str) -> dict:
    row = await db.fetchrow(
        f"""
        WITH trips AS (
            SELECT t.planning_date, {nombre_del_cliente('t', 'sh')} AS client_name
            FROM app.trips t
            JOIN app.v_trip_fleet_resolution vfr ON vfr.trip_id = t.id
            {join_cliente('t', 'sh')}
            WHERE {_RESOLVED[kind]} = $1 AND t.voided_at IS NULL
        )
        SELECT (SELECT count(*) FROM trips WHERE planning_date >= public.hoy_chile() - 30)::int AS trips_30d,
               (SELECT planning_date FROM trips ORDER BY planning_date DESC NULLS LAST LIMIT 1) AS last_trip_date,
               (SELECT client_name FROM trips ORDER BY planning_date DESC NULLS LAST LIMIT 1) AS last_trip_client
        """,
        entity_id,
    )
    return dict(row)
