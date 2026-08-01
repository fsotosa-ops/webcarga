-- FIX 2026-08-02 (Fase 0.3, HU Cierre del Día §7.3): "segunda/tercera vuelta"
-- es un conteo abierto (2ª, 3ª, 4ª... no se topa en 3, ese número en la HU
-- era solo ilustrativo) y debe dispararse por "el mismo conductor (RUT) O la
-- misma patente de tracto" en dos o más viajes del mismo día — no solo por
-- conductor. La vista original (20260718120000) tenía 2 gaps reales frente a
-- esa regla:
--   1. Solo miraba app.trip_fleet_links.driver_id CRUDO (92% de cobertura
--      real, ver comentario original) — ignoraba la resolución en vivo por
--      patente/vehicle_driver_assignments/nombre que sí usa el resto del
--      backend (app.v_trip_fleet_resolution, migración 20260722030000). Un
--      viaje sin driver_id explícito en trip_fleet_links pero resoluble por
--      patente quedaba afuera del conteo de vueltas aunque el operador
--      hiciera 2 viajes reales ese día.
--   2. No consideraba el tracto en absoluto — un conductor no resuelto pero
--      con la misma patente en 2 viajes (o un mismo tracto con 2 conductores
--      distintos ese día) no contaba como "misma vuelta series".
--
-- Fix: resolver contra app.v_trip_fleet_resolution (misma cadena de 3
-- niveles que ya usa el resto del backend) y contar, por viaje, cuántos
-- viajes del mismo día comparten SU conductor resuelto O SU tracto
-- resuelto, hasta ese momento cronológico inclusive. No es una tabla ni un
-- trigger — sigue siendo una vista simple (no materializada), mismo patrón
-- ya usado en el archivo original y en v_trip_fleet_resolution.
--
-- Limitación conocida y aceptada para Fase 0: el conteo es pairwise (compara
-- cada viaje contra los demás por SUS propias claves), no un cierre
-- transitivo completo. Un caso A-B comparten conductor, B-C comparten
-- tracto pero A-C no comparten ninguna clave, contaría como 2 series
-- separadas en vez de una cadena de 3 — escenario extremadamente raro
-- (implica que el conductor Y el tracto cambiaron a la vez entre A y C) y
-- no reportado en ninguna casuística real hasta la fecha.
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
    LEFT JOIN app.trip_stops ots ON ots.trip_id = t.id AND ots.stop_type = 'ORIGIN'
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
