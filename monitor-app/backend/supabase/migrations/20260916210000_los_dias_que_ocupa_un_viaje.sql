-- Qué días ocupa un viaje: una sola definición, determinista
--
-- Solicitud de Cambios Diario 2.0 (16/09). El cierre decidía si un viaje
-- ocupaba el día D con
--
--     planning_date = D OR (planning_date < D AND is_active)
--
-- y `is_active` es el valor de AHORA, no el de D. El mismo día daba cifras
-- distintas según cuándo se abría:
--   - Efrain Suarez, viaje 2051880 del 11/09 con entregas el 12 y el 13: una
--     vez cerrado por el TMS, el 13/09 lo mostraba "No asignado".
--   - Un viaje CERRADO FINALIZADO del 07/09 seguía apareciendo en el 09/09
--     mientras estuvo marcado activo.
-- Medido del 01 al 15/09: 83 de 476 viajes abarcan más de un día y 78 ya no
-- están activos, así que sus días posteriores dejaban de contar.
--
-- Y la condición no miraba el estado: 50 de 51 viajes CANCELADO desde el 15/08
-- tienen is_assigned = true, y su conductor figuraba "Asignado".
--
-- La regla nueva sale de la evidencia del propio viaje:
--   - empieza en planning_date;
--   - termina en la última marca real de sus paradas (llegadas, salidas, GPS,
--     descarga, y sus correcciones manuales), en hora de Chile;
--   - si el TMS lo sigue informando, también en el día de su último reporte
--     (status_reported_at viene en hora local de Chile, sin zona: el 2051880
--     reportó 15:45 con GPS a las 18:16 UTC = 15:16 en Chile).
-- Datos al 16/09: ninguna marca futura, el viaje más largo abarca 5 días.
--
-- Qué NO es carga lo dice el catálogo de estados, no un literal en la vista:
-- columna nueva `app.trip_statuses.counts_as_load`. Los grupos existentes no
-- sirven para esto — CANCELADO comparte `problema` con EN PANA y DEVUELTO, y
-- en esos el conductor sí trabajó.
--
-- Un viaje declarado "no lo tomamos" (unassigned_reason_id) tampoco es carga:
-- mismo criterio que ya aplicaban las CTE del cierre desde el 14/09.
-- Sodimac NO se filtra acá: es decisión de cada pantalla (el cierre lo excluye
-- porque no resuelve tracto por la misma cadena; el paso Viajes no).

ALTER TABLE app.trip_statuses
    ADD COLUMN counts_as_load boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN app.trip_statuses.counts_as_load IS
    'false = un viaje en este estado no ocupó a su conductor ni a su tracto '
    '(nunca se hizo). Lo lee app.v_trip_activity_days.';

-- Tres estados que llegan del TMS y no estaban catalogados.
INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order, active)
VALUES
    ('Cancelado',                         'Cancelado',                         '#fee2e2', '#b00020', 'problema', 900, true),
    ('CERRADO FINALIZADO TR',             'CERRADO FINALIZADO TR',             '#f3f4f6', '#9ca3af', 'cerrado',  901, true),
    ('CERRADO INCOMPLETO POR OTRO VIAJE', 'CERRADO INCOMPLETO POR OTRO VIAJE', '#fef3c7', '#d97706', 'cerrado',  902, true)
ON CONFLICT (id) DO NOTHING;

UPDATE app.trip_statuses
SET counts_as_load = false
WHERE id IN ('CANCELADO', 'Cancelado', 'Declinada', 'Removida');

CREATE OR REPLACE VIEW app.v_trip_activity_days AS
WITH marcas AS (
    SELECT
        t.id AS trip_id,
        t.planning_date,
        t.is_active,
        t.status_reported_at,
        max(m.ts) AS ultima_marca
    FROM app.trips t
    LEFT JOIN app.trip_statuses s ON s.id = t.trip_status
    LEFT JOIN app.trip_stops st ON st.trip_id = t.id
    LEFT JOIN LATERAL (VALUES
        (st.arrival_date), (st.departure_date),
        (st.gps_arrival_date), (st.gps_departure_date),
        (st.unload_start), (st.unload_end),
        (st.desc_inicio_manual), (st.desc_fin_manual),
        (st.arrival_date_manual), (st.departure_date_manual),
        (st.gps_arrival_date_manual), (st.gps_departure_date_manual)
    ) AS m(ts) ON true
    WHERE t.planning_date IS NOT NULL
      AND t.unassigned_reason_id IS NULL
      -- Un estado que no está en el catálogo cuenta como carga: no saber qué
      -- significa no es evidencia de que el viaje no se hizo.
      AND COALESCE(s.counts_as_load, true)
    GROUP BY t.id, t.planning_date, t.is_active, t.status_reported_at
)
SELECT
    trip_id,
    dia::date AS activity_date
FROM marcas
CROSS JOIN LATERAL generate_series(
    planning_date,
    GREATEST(
        planning_date,
        (ultima_marca AT TIME ZONE 'America/Santiago')::date,
        CASE WHEN is_active THEN status_reported_at::date END
    ),
    interval '1 day'
) AS dia;

COMMENT ON VIEW app.v_trip_activity_days IS
    'Una fila por (viaje, día) en que el viaje ocupó a su conductor y a su '
    'tracto. Desde planning_date hasta la última marca real de sus paradas '
    '(hora de Chile), o su último reporte si sigue activo. Excluye declarados '
    'y estados con counts_as_load = false. No filtra por TMS.';
