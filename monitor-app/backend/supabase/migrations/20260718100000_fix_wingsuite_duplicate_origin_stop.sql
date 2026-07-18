-- Fase 1 del hardening del Diario (2026-07-18) — corrección puntual: los
-- 12 viajes de Wingsuite (100% de ese TMS, volumen mínimo — 0.4% del
-- total) tenían `app.trips.stops` congelado desde antes del fix del bug de
-- Wingsuite en la Fase 0 (origen mezclado como parada, corregido en
-- stg_wingsuite_trips.sql). app.trips es TAMBIÉN incremental con el mismo
-- problema de watermark que trip_stops — nunca se reprocesaron porque no
-- tuvieron actividad reciente del pipeline, así que el backfill de la
-- migración anterior (20260718090000) copió fielmente ese residuo: cada
-- uno de estos 12 viajes terminó con el origen duplicado (una vez como
-- ORIGIN correcto, calculado en vivo desde int_tms_trips_conformed; otra
-- vez como la primera DESTINATION, heredada del stops jsonb viejo).
--
-- Verificado antes de aplicar: los 12 casos son exactamente
-- stop_order=1 con el mismo `local` que la fila ORIGIN de su viaje — sin
-- ambigüedad, no requiere heurística.

BEGIN;

-- Capturar el set exacto de viajes afectados ANTES de borrar, para no
-- depender de ninguna suposición sobre "todo wingsuite" al cerrar el hueco
-- de stop_order después.
CREATE TEMP TABLE _affected_trips ON COMMIT DROP AS
SELECT DISTINCT d.trip_id
FROM app.trip_stops o
JOIN app.trip_stops d
    ON d.trip_id = o.trip_id AND d.stop_type = 'DESTINATION' AND d.local = o.local
WHERE o.stop_type = 'ORIGIN';

DELETE FROM app.trip_stops ts
USING app.trip_stops o
WHERE o.stop_type = 'ORIGIN'
  AND ts.trip_id = o.trip_id
  AND ts.stop_type = 'DESTINATION'
  AND ts.local = o.local;

-- Cerrar el hueco de stop_order dejado por la fila borrada, solo para los
-- viajes que realmente tenían el duplicado.
UPDATE app.trip_stops ts
SET stop_order = ts.stop_order - 1,
    updated_at = now()
FROM _affected_trips a
WHERE ts.trip_id = a.trip_id
  AND ts.stop_type = 'DESTINATION'
  AND ts.stop_order > 1;

COMMIT;
