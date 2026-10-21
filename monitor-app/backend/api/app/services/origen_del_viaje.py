"""El origen de un viaje: su PRIMERA parada ORIGIN (10/10).

Desde el 18/07 el origen no es una columna de app.trips: es la parada ORIGIN de
app.trip_stops (parada 0). Sodimac es multiorigen —una fila ORIGIN por bodega,
con stop_order 0..k-1—, así que "una parada ORIGIN cualquiera" no es el origen.

Una sola definición para todas las consultas de la API que muestran el origen;
antes había cinco, casi todas sin orden. La vista app.v_driver_daily_trip_legs
tiene su propia versión (un objeto de la base no puede importar esto) con el
mismo criterio: migración 20260823190000.

Pasa a ser público, como TRACTOREO_ROSTER_CTE, porque lo importan varios routers.
"""


def origen_del_viaje(viaje: str) -> str:
    """Expresión escalar con el local de origen del viaje cuyo alias es `viaje`. La regla vive en la base,
    app.trip_origin_local (migración 20261101090000): la analítica en dbt usa la misma."""
    return f"app.trip_origin_local({viaje}.id)"
