-- FIX 2026-08-07 (bug 5.5, Diario 2.0): app.v_driver_daily_trip_legs
-- (20260718120000, reescrita en 20260802000000) hace
-- `LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type =
-- 'ORIGIN'` asumiendo a lo sumo 1 fila ORIGIN por viaje. Esa garantía no
-- existe realmente: mismo bug ya documentado en trips.py/_load_trip_stops
-- (dbt calcula trip_stops.stop_id = md5(trip_id + nombre_del_local + orden);
-- si el TMS corrige el nombre de la parada entre dos scrapes, el hash
-- cambia y el MERGE inserta una fila nueva en vez de actualizar la vieja,
-- dejando huérfanas filas duplicadas). Confirmado contra datos reales
-- 2026-08-07: 2 viajes con 2 filas ORIGIN cada uno — el LEFT JOIN sin
-- dedup hacía fan-out de esos 2 viajes a 2 filas en la vista, y el subquery
-- escalar `driver_leg_number` en GET /trips (trips.py, list_trips) —
-- que asume 1 fila por trip_id — reventaba con
-- "more than one row returned by a subquery used as an expression" en
-- cuanto uno de esos 2 viajes caía en la página pedida (reproducible con
-- Historial + paginación en offsets altos, según el orden).
--
-- Fix: resolver la fila ORIGIN vía LATERAL con el mismo criterio de
-- desempate que ya usa _stop_dedup_key en trips.py (más reciente primero,
-- updated_at > created_at > local no nulo > arrival_date no nulo) — una
-- sola fuente de verdad de "qué fila ORIGIN gana" en vez de que Python y
-- SQL diverjan en cuál usar. Garantiza estructuralmente ≤1 fila por
-- trip_id sin importar cuántas filas ORIGIN duplicadas acumule
-- trip_stops en el futuro (no un parche puntual para estos 2 viajes).
DROP VIEW app.v_driver_daily_trip_legs;

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
          AND (
              r2.departure_ts < r.departure_ts
              OR (r2.departure_ts = r.departure_ts AND r2.trip_id <= r.trip_id)
          )
    ) AS leg_number
FROM resolved r;
