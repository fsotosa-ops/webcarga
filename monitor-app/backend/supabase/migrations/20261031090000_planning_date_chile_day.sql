-- La fecha de planificación de un viaje es el día de Chile (21/10).
--
-- Defecto: dbt/tms/macros/trip_planning_date.sql (en Mage) hacía `planned_departure_at::date` en la sesión
-- UTC de la base. Las horas del TMS ya se leen como hora de Chile (parse_date_tms); lo que estaba mal era sacar
-- el día en UTC. Un viaje planificado desde las 20:00/21:00 de Chile quedaba con el día siguiente. Ejemplo: el
-- viaje 2079231 de Walmart, "FH Planifica" 20/10/2026 21:33, quedaba como del 21/10.
--
-- La regla se corrigió en el macro el mismo día (sincronizado a Mage antes de esta migración, para que la
-- ingesta no devuelva la fecha vieja). Esto corrige los viajes que la carga incremental ya no vuelve a procesar:
-- 212 al 21/10 (208 QAnalytics, 3 Wingsuite, 1 Sodimac), todos exactamente un día atrás.
--
-- Decisión del usuario (21/10): corregir también hacia atrás, incluidos 49 viajes de días firmados. Las firmas
-- (closure_signature_*) guardan su propia copia y no cambian. La base no recalcula días cerrados
-- (app.enqueue_closure_recompute), y los días abiertos de los últimos 45 se recalculan solos.
--
-- Cada cambio queda en audit_log. El id del viaje no depende de la fecha, así que no se pierde trazabilidad.
-- En una base sin silver (la copia local) no hace nada.

BEGIN;

DO $$
BEGIN
    IF to_regclass('silver.int_tms_trips_conformed') IS NULL THEN
        RAISE NOTICE 'Sin silver.int_tms_trips_conformed: nada que corregir';
        RETURN;
    END IF;

    CREATE TEMP TABLE planning_date_fix ON COMMIT DROP AS
    SELECT t.id, t.planning_date AS old_date, c.new_date
    FROM app.trips t
    JOIN (
        SELECT trip_id,
               COALESCE(
                   (planned_departure_at AT TIME ZONE 'America/Santiago')::date,
                   ((trip_stops->0->>'planned_arrival_at')::timestamptz AT TIME ZONE 'America/Santiago')::date,
                   ((trip_stops->0->>'actual_arrival_at')::timestamptz AT TIME ZONE 'America/Santiago')::date
               ) AS new_date
        FROM silver.int_tms_trips_conformed
        WHERE is_current = true
    ) c ON c.trip_id = t.id
    WHERE c.new_date IS NOT NULL AND c.new_date IS DISTINCT FROM t.planning_date;

    INSERT INTO public.audit_log (occurred_at, entity_type, entity_id, action, field, old_value, new_value, source)
    SELECT now(), 'TRIP', id, 'fix_planning_date_timezone', 'planning_date', to_jsonb(old_date), to_jsonb(new_date),
           'migration'
    FROM planning_date_fix;

    UPDATE app.trips t SET planning_date = f.new_date FROM planning_date_fix f WHERE f.id = t.id;
END $$;

COMMIT;
