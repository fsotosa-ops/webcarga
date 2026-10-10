-- La vuelta se cuenta por patente (minuta 09/10, ítem 7).
--
-- Pablo: si una empresa tiene dos tractos que hacen un viaje cada uno, son dos
-- patentes con una vuelta cada una, no dos vueltas. app.v_driver_daily_trip_legs
-- es la única definición de "vuelta" (la usan el reporte del Cierre y el filtro
-- "2ª vuelta" del Monitor) y contaba los viajes del día que compartían conductor
-- O tracto: un conductor que cambiaba de tracto (por una panne, por ejemplo) le
-- sumaba una vuelta al segundo tracto.
--
-- Ahora cuenta por tracto. Un viaje sin tracto resuelto cuenta por conductor,
-- entre los viajes de ese conductor que tampoco tienen tracto. El resto de la
-- vista no cambia (mismas columnas, mismo origen de la salida: 20260823190000).

BEGIN;

CREATE OR REPLACE VIEW app.v_driver_daily_trip_legs AS
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
            -- El primer origen del viaje (mismo criterio que la API:
            -- services/origen_del_viaje.py). Lo demás sólo desempata duplicados.
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
          -- La vuelta es de la PATENTE (minuta 09/10). Sin tracto resuelto, la
          -- del conductor entre sus viajes que tampoco tienen tracto.
          AND (
                (r.resolved_tractor_asset_id IS NOT NULL
                 AND r2.resolved_tractor_asset_id = r.resolved_tractor_asset_id)
             OR (r.resolved_tractor_asset_id IS NULL AND r2.resolved_tractor_asset_id IS NULL
                 AND r2.resolved_driver_id = r.resolved_driver_id)
          )
          AND (r2.departure_ts < r.departure_ts
               OR (r2.departure_ts = r.departure_ts AND r2.trip_id <= r.trip_id))
    ) AS leg_number
FROM resolved r;

COMMIT;
