-- La salida del viaje es su PRIMER origen, no el que se escribió último.
--
-- `app.v_driver_daily_trip_legs` resuelve UNA fila ORIGIN por viaje con un
-- LATERAL, y desempataba por `updated_at DESC`. Ese criterio se escribió el
-- 2026-08-07 para un problema distinto: había viajes con DOS filas ORIGIN que
-- eran duplicados —el mismo origen escrito dos veces porque el hash del
-- `stop_id` cambió entre corridas—, y ante dos filas indistinguibles "la más
-- reciente" era un desempate tan bueno como cualquiera. El LATERAL sigue
-- siendo necesario: sin él, un viaje con dos filas ORIGIN hace fan-out y el
-- subquery escalar de `driver_leg_number` en GET /trips revienta con
-- "more than one row returned by a subquery used as an expression".
--
-- LO QUE CAMBIÓ: desde la Ronda 142 dos filas ORIGIN ya NO son necesariamente
-- duplicados. Sodimac es multiorigen —7 viajes vigentes de 402 cargan en dos
-- bodegas distintas, y el portal lo declara en su campo CONEXIONES— y el
-- pipeline ahora emite una fila por origen, con `stop_order` 0..k-1. Ante dos
-- orígenes REALES, "el más reciente" elige uno al azar: en la práctica el que
-- la última corrida de dbt tocó después.
--
-- Para esta vista —que calcula desde cuándo cuenta el tramo del conductor— el
-- origen correcto es el PRIMERO. Así que `stop_order` pasa al frente del
-- desempate. Los criterios que ya estaban se conservan íntegros detrás: siguen
-- resolviendo el caso de duplicados reales, que comparten `stop_order` y por
-- lo tanto empatan en el primer criterio.
--
-- Sigue devolviendo exactamente una fila, así que el fan-out que la migración
-- de agosto vino a evitar no vuelve.
DROP VIEW IF EXISTS app.v_driver_daily_trip_legs;

CREATE VIEW app.v_driver_daily_trip_legs AS
WITH resolved AS (
    SELECT
        t.id AS trip_id,
        t.planning_date,
        fr.resolved_driver_id,
        fr.resolved_tractor_asset_id,
        COALESCE(
            ots.departure_date, ots.gps_departure_date, ots.desc_inicio_manual,
            ots.departure_date_prog, ots.planning_date, t.created_at
        ) AS departure_ts
    FROM app.trips t
    JOIN app.v_trip_fleet_resolution fr ON fr.trip_id = t.id
    LEFT JOIN LATERAL (
        SELECT ts.*
        FROM app.trip_stops ts
        WHERE ts.trip_id = t.id AND ts.stop_type = 'ORIGIN'
        ORDER BY
            -- El primer origen del viaje. Lo demás sólo desempata duplicados.
            ts.stop_order ASC,
            ts.updated_at IS NOT NULL DESC, ts.updated_at DESC,
            ts.created_at IS NOT NULL DESC, ts.created_at DESC,
            ts.local IS NOT NULL DESC,
            ts.arrival_date IS NOT NULL DESC
        LIMIT 1
    ) ots ON true
    WHERE fr.resolved_driver_id IS NOT NULL OR fr.resolved_tractor_asset_id IS NOT NULL
)
SELECT
    r.trip_id,
    r.resolved_driver_id AS driver_id,
    r.planning_date,
    (
        SELECT count(*)
        FROM resolved r2
        WHERE r2.planning_date = r.planning_date
          AND (
                (r.resolved_driver_id IS NOT NULL AND r2.resolved_driver_id = r.resolved_driver_id)
             OR (r.resolved_tractor_asset_id IS NOT NULL AND r2.resolved_tractor_asset_id = r.resolved_tractor_asset_id)
          )
          AND (r2.departure_ts < r.departure_ts
               OR (r2.departure_ts = r.departure_ts AND r2.trip_id <= r.trip_id))
    ) AS leg_number
FROM resolved r;
