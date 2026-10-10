-- Anulación con motivo de viajes manuales (spec 2026-10-10 anulación y firma versionada, §2).
--
-- Reemplaza el borrado físico: el viaje queda, con quién, cuándo y por qué se anuló.
-- Mismo patrón que unassigned_reason_id: la API escribe app.trips_manual y app.trips en
-- la misma transacción; la rama manual del modelo dbt `trips` las lleva desde
-- trips_manual y están en merge_exclude_columns. El modelo se actualiza en Mage en la
-- MISMA ventana entre corridas: con on_schema_change='sync_all_columns', una corrida
-- con el modelo viejo borra estas columnas de app.trips, y trips_del_dia (SQL sin
-- dependencias registradas) fallaría en tiempo de ejecución.

BEGIN;

ALTER TABLE app.trips_manual
    ADD COLUMN voided_at timestamptz,
    ADD COLUMN voided_by uuid,
    ADD COLUMN void_reason text,
    ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
        (voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

ALTER TABLE app.trips
    ADD COLUMN voided_at timestamptz,
    ADD COLUMN voided_by uuid,
    ADD COLUMN void_reason text,
    ADD CONSTRAINT ck_trips_void_complete CHECK (
        (voided_at IS NULL) = (voided_by IS NULL) AND (voided_at IS NULL) = (void_reason IS NULL));

COMMENT ON COLUMN app.trips.voided_at IS
    'Cuándo se anuló el viaje (solo manuales). NULL = vigente. Lo escribe la API; dbt no lo toca (merge_exclude_columns).';

-- Los viajes que ocupan el día D, sin los anulados. Mismo cuerpo que el vigente
-- (20260916233000 y sucesivas) más `t.voided_at IS NULL`.
CREATE OR REPLACE FUNCTION app.trips_del_dia(p_fecha date)
 RETURNS TABLE(trip_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
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
      AND t.voided_at IS NULL
      AND COALESCE(s.counts_as_load, true)
    GROUP BY t.id, t.planning_date, t.is_active, t.status_reported_at
    HAVING GREATEST(
        t.planning_date,
        (max(m.ts) AT TIME ZONE 'America/Santiago')::date,
        CASE WHEN t.is_active THEN t.status_reported_at::date END
    ) >= p_fecha
$function$;

COMMIT;
