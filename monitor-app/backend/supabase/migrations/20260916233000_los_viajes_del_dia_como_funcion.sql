-- Los viajes que ocuparon un día: función acotada en vez de vista
--
-- 20260916210000 creó `app.v_trip_activity_days`. Medida en producción antes
-- de que nadie la leyera: 91 ms para UN día, porque el filtro por fecha no
-- baja por debajo de generate_series y la vista expande toda la historia
-- (2.482 viajes). Crece con cada día que pasa, y el cierre, el reporte, el
-- pre-cierre y los disponibles del Diario la preguntan 13 veces.
--
-- La pregunta que hacen todos es la misma —"¿qué viajes ocuparon el día D?"—,
-- así que la definición pasa a ser una función que recibe D y puede acotar
-- ANTES de agregar las paradas: 53 ms y constante.
--
-- La cota: planning_date entre D - 45 y D. Sale del dato, no del gusto:
--   - el viaje más largo medido (agosto-septiembre) abarca 5 días;
--   - un viaje abierto sólo extiende su ocupación con reportes del TMS, e
--     is_active (dbt) se apaga a los 7 días sin reporte.
-- 45 días deja más de 6 veces ese margen.
--
-- Se retira la vista en la misma migración: no tiene lectores y dos
-- definiciones de la misma regla es como esta regla llegó a estar copiada en
-- 14 lugares.
--
-- La regla no cambia (ver 20260916210000):
--   - empieza en planning_date;
--   - termina en la última marca real de sus paradas, en hora de Chile, o en
--     el día de su último reporte si sigue activo (status_reported_at viene en
--     hora local de Chile, sin zona);
--   - excluye declarados y estados con counts_as_load = false;
--   - no filtra por TMS.

DROP VIEW IF EXISTS app.v_trip_activity_days;

CREATE OR REPLACE FUNCTION app.trips_del_dia(p_fecha date)
RETURNS TABLE (trip_id uuid)
LANGUAGE sql
STABLE
AS $$
    SELECT t.id
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
    WHERE t.planning_date BETWEEN p_fecha - 45 AND p_fecha
      AND t.unassigned_reason_id IS NULL
      -- Un estado que no está en el catálogo cuenta como carga: no saber qué
      -- significa no es evidencia de que el viaje no se hizo.
      AND COALESCE(s.counts_as_load, true)
    GROUP BY t.id, t.planning_date, t.is_active, t.status_reported_at
    HAVING GREATEST(
        t.planning_date,
        (max(m.ts) AT TIME ZONE 'America/Santiago')::date,
        CASE WHEN t.is_active THEN t.status_reported_at::date END
    ) >= p_fecha
$$;

COMMENT ON FUNCTION app.trips_del_dia(date) IS
    'Los viajes que ocuparon a su conductor y a su tracto el día p_fecha: desde '
    'planning_date hasta la última marca real de sus paradas (hora de Chile), '
    'o su último reporte si sigue activo. Excluye declarados y estados con '
    'counts_as_load = false. No filtra por TMS. Acotada a planning_date >= '
    'p_fecha - 45 (ver migración 20260916233000).';
