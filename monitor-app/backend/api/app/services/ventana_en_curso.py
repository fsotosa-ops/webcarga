"""La ventana de "En curso" del Monitor (decisión del usuario 11/10).

Un viaje activo sigue en "En curso" mientras la fecha de su último movimiento
esté dentro de los últimos `in_progress_idle_days` días (Configuración › Alertas
del Monitor, 3 por defecto). El movimiento es la llegada o salida más reciente en
sus paradas —del TMS, del GPS o cargada a mano—; si nunca tuvo (Sodimac y los
manuales no registran horas), cuenta su fecha de planificación.

Por qué así: un viaje largo, a regiones, dura varios días y sigue moviéndose,
así que la antigüedad del viaje no sirve. El último reporte del TMS tampoco: el
portal de Sodimac lo renueva aunque el viaje esté cerrado. Medido el 11/10: los
Walmart de 2-3 días tenían un evento GPS de hace horas; los Sodimac pegados en
"Control de salida", ninguno.

Lo que queda fuera sigue activo: se ve en el Historial y en el Cierre. No es
`stale_trip_days`, que dice cuándo un viaje entregado sin cierre del TMS sale del
Cierre: son dos preguntas, dos números.
"""

# Lo que cuenta como movimiento: un hecho ocurrido en una parada. Las horas
# programadas (departure_date_prog) no, porque son un plan.
_EVENTOS_DE_LA_PARADA = (
    "s.arrival_date, s.departure_date, s.gps_arrival_date, s.gps_departure_date, "
    "s.arrival_date_manual, s.departure_date_manual, "
    "s.gps_arrival_date_manual, s.gps_departure_date_manual, s.unload_start, s.unload_end"
)


def ultimo_movimiento(viaje: str) -> str:
    """Fecha (en Chile) del último movimiento del viaje cuyo alias es `viaje`, o
    su fecha de planificación si nunca tuvo. NULL si no tiene ninguna de las dos."""
    return (
        "COALESCE(("
        f"SELECT (max(GREATEST({_EVENTOS_DE_LA_PARADA})) AT TIME ZONE 'America/Santiago')::date "
        f"FROM app.trip_stops s WHERE s.trip_id = {viaje}.id), {viaje}.planning_date)"
    )


def dentro_de_la_ventana(viaje: str) -> str:
    """Condición: el viaje se movió dentro de la ventana de "En curso". Un viaje
    sin movimiento ni fecha no se puede ubicar, y queda fuera."""
    return (
        f"COALESCE({ultimo_movimiento(viaje)} >= public.hoy_chile() - "
        "(SELECT in_progress_idle_days FROM app.monitor_alert_rules WHERE id = 1), false)"
    )
