-- Fase 1 del hardening del Diario (2026-07-18) — backfill de una sola vez
-- para el resto del historial que el run incremental de hoy de
-- app/trip_stops.sql (ya sincronizado y corrido en Mage) no alcanzó a
-- reprocesar.
--
-- Motivo: app/trip_stops.sql es incremental, filtra por
-- `app.trips.updated_at > MAX(updated_at) FROM {{ this }}`. La corrida de
-- hoy ya escribió filas con updated_at=hoy, así que el watermark del
-- modelo avanzó — cualquier corrida FUTURA solo va a alcanzar viajes con
-- updated_at posterior a hoy. El resto del historial (viajes cerrados
-- hace tiempo, sin actividad reciente del pipeline) nunca se va a
-- reprocesar solo. Verificado en vivo: el viaje 398410 (caso de prueba del
-- bug de Wingsuite, Fase 0) se quedó con la numeración vieja y sin fila
-- ORIGIN.
--
-- Se hace acá (SQL directo) y no con `dbt run --full-refresh` a propósito:
-- un full-refresh de trip_stops ignora merge_exclude_columns (solo protege
-- en el MERGE incremental, no en un DROP+CREATE) y hubiera borrado
-- cualquier desc_inicio_manual/desc_fin_manual real ya cargado por
-- operaciones — mismo tipo de incidente ya confirmado con
-- app.trips.fleet_link_id en la ronda anterior. Este backfill no toca
-- ninguna fila DESTINATION existente salvo para correrle el stop_order.

BEGIN;

-- Paso 1: insertar la fila ORIGIN para los viajes que dbt no reprocesó.
INSERT INTO app.trip_stops
    (stop_id, trip_id, stop_order, stop_type, local, planning_date, departure_date, created_at, updated_at)
SELECT
    md5(c.trip_id::text || COALESCE(c.origin_location_name, '') || '|origin'),
    c.trip_id,
    0,
    'ORIGIN',
    c.origin_location_name,
    c.planned_departure_at,
    c.actual_departure_at,
    now(),
    now()
FROM silver.int_tms_trips_conformed c
WHERE c.is_current = true
  AND c.origin_location_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM app.trips t WHERE t.id = c.trip_id)
  AND NOT EXISTS (
      SELECT 1 FROM app.trip_stops ts WHERE ts.trip_id = c.trip_id AND ts.stop_type = 'ORIGIN'
  );

-- Paso 2: correr +1 el stop_order de los destinos que quedaron con la
-- numeración vieja (0-based) para los viajes que AHORA tienen origen —
-- deja lugar a la parada 0. Los viajes ya reprocesados hoy por dbt (que
-- arrancan en 1) no matchean min(stop_order)=0, así que no se tocan dos
-- veces. Los viajes sin match de origen tampoco se tocan (no hay nada que
-- correr).
WITH needs_shift AS (
    SELECT ts.trip_id
    FROM app.trip_stops ts
    WHERE ts.stop_type = 'DESTINATION'
    GROUP BY ts.trip_id
    HAVING min(ts.stop_order) = 0
       AND EXISTS (
           SELECT 1 FROM app.trip_stops o WHERE o.trip_id = ts.trip_id AND o.stop_type = 'ORIGIN'
       )
)
UPDATE app.trip_stops ts
SET stop_order = ts.stop_order + 1,
    updated_at = now()
FROM needs_shift ns
WHERE ts.trip_id = ns.trip_id AND ts.stop_type = 'DESTINATION';

COMMIT;
