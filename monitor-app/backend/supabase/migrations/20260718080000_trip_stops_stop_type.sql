-- Fase 1 del hardening del Diario (2026-07-18) — unificar origen como
-- "parada 0" en app.trip_stops. Paso 1 de 2 (aditivo): agrega stop_type
-- para distinguir ORIGIN/DESTINATION dentro de la misma tabla — todas las
-- filas existentes son destinos reales (el pipeline y el backend manual
-- solo escribían paradas de destino hasta ahora), así que el backfill es
-- trivial.
--
-- Las filas ORIGIN las va a emitir el modelo dbt actualizado
-- (app/trip_stops.sql, sincronizado a Mage aparte — el proyecto dbt real
-- vive solo ahí) para viajes TMS, y el backend (_insert_trip_stops) para
-- viajes manuales/CSV — mismo patrón dual que ya usan las paradas de
-- destino hoy.
--
-- Las columnas viejas de origen en app.trips (origin/origin_region/
-- origin_city/cag_inicio_at/cag_fin_at) NO se tocan en esta migración —
-- quedan como red de seguridad hasta verificar en vivo que el timeline
-- unificado funciona end-to-end (mismo criterio que Fase 2 dejó
-- app.trips.stops intacto sin uso). El DROP final es una migración aparte.

BEGIN;

ALTER TABLE app.trip_stops
    ADD COLUMN stop_type text NOT NULL DEFAULT 'DESTINATION'
        CHECK (stop_type IN ('ORIGIN', 'DESTINATION'));

ALTER TABLE app.trip_stops ALTER COLUMN stop_type DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_trip_stops_stop_type ON app.trip_stops (trip_id, stop_type);

COMMIT;
