"""Los cuatro grupos del paso "Viajes" del Cierre (spec §6.1).

UNA sola definicion. La Ronda 123 cerro cuatro defectos de conteo que existian
porque "el universo de viajes del dia" esta escrito a mano en 14 lugares; esta
no nace repetida.

Los tres primeros grupos salen de columnas que ya existen y estan pobladas:
`app_trips.sql` deriva is_assigned como
  trip_status NOT IN ('Creada','Aceptada','Control de salida') AND (patente O conductor)
que es literalmente la definicion que dio Pablo.

El cuarto NO se deriva de is_active, y ese es el punto: is_active exige que el
TMS haya reportado en los ultimos 7 dias, asi que un viaje que QAnalytics
abandona sin cerrar sale solo del Monitor justo cuando empieza a importar —
sin cierre en el TMS no llega la orden de compra. Es la regla 5 de Pablo.
"""

# Sin confirmar con operaciones (spec §11 item 5). Empata con el umbral de
# recencia de is_active a proposito: por debajo de eso el viaje sigue vivo en
# el Monitor y no hay nada que declarar.
DIAS_SIN_NOVEDAD = 7

# `problema` queda afuera a proposito: mezcla Cancelado y Sin Registros
# (terminales) con En Pana (que no lo es). Medido el 2026-08-18, excluirlo no
# cuesta nada — ninguna fila En Pana supera los 7 dias. Separar esa mezcla es
# un arreglo de catalogo, no de este servicio.
GRUPOS_NO_TERMINALES = ("en_ruta", "retornando", "en_local", "otro")

SQL_GRUPOS_CIERRE = f"""
WITH base AS (
    SELECT t.id AS trip_id, t.planning_date, t.client_name,
           t.source_system_trip_id, t.trip_status, t.unassigned_reason_id,
           t.is_active, t.is_assigned,
           EXTRACT(EPOCH FROM (now() - t.status_reported_at)) / 86400 AS dias_sin_novedad,
           s.group_id
    FROM app.trips t
    LEFT JOIN app.trip_statuses s ON s.id = t.trip_status
    WHERE t.planning_date <= $1::date
)
SELECT trip_id, planning_date, client_name, source_system_trip_id, trip_status,
       unassigned_reason_id, round(dias_sin_novedad::numeric, 1) AS dias_sin_novedad,
       CASE
           WHEN is_active AND NOT is_assigned AND planning_date = $1::date THEN 'hoy'
           WHEN is_active AND NOT is_assigned AND planning_date < $1::date THEN 'rezago'
           WHEN is_active AND is_assigned     AND planning_date < $1::date THEN 'en_curso'
           ELSE 'abandonado'
       END AS grupo
FROM base
WHERE (is_active AND NOT is_assigned)
   OR (is_active AND is_assigned AND planning_date < $1::date)
   OR (NOT is_active
       AND group_id IN {GRUPOS_NO_TERMINALES}
       AND dias_sin_novedad > {DIAS_SIN_NOVEDAD})
ORDER BY grupo, planning_date DESC
"""
