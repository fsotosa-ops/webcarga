"""Las reglas del Monitor (app.monitor_alert_rules), leídas en un solo lugar.

Las leen Configuración › Alertas del Monitor (para editarlas) y /trips/meta
(para que el Monitor las aplique). Antes la lista de columnas estaba copiada en
los dos routers, y una columna nueva había que acordarse de agregarla dos veces.
"""

SQL_REGLAS_DEL_MONITOR = (
    "SELECT stale_report_hours, dwell_hours, late_arrival_grace_min, unassigned_enabled, "
    "dwell_yellow_min, dwell_orange_min, dwell_red_min, tms_dropped_hours, stale_trip_days, "
    "in_progress_idle_days "
    "FROM app.monitor_alert_rules WHERE id = 1"
)
