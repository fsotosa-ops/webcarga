-- ==============================================================================
-- MIGRACIÓN: UBICACIÓN DE ORIGEN COMPLEMENTARIA (REGIÓN / CIUDAD)
--
-- Pedido UAT 2026-07-06: asignar región y ciudad (dropdown comuna/región de
-- Chile) a los viajes desde el frontend — creación manual, detalle del viaje
-- y filtro del monitor.
--
-- Diseño: columnas COMPLEMENTARIAS, no reemplazan `origin` (texto que reporta
-- cada TMS). El pipeline nunca las escribe:
--   - app.trips: pobladas solo vía API (PATCH/creación manual). En el modelo
--     dbt van en merge_exclude_columns (mismo patrón que observaciones/
--     comentarios) para que el MERGE incremental no las pise.
--   - app.trips_manual: fuente de verdad para viajes manuales — sobreviven
--     al full-refresh vía la rama UNION del modelo.
--   - Destinos: reutilizan las claves destination_city/destination_region
--     que ya existen en el jsonb stops (hoy solo qanalytics las trae).
-- ==============================================================================

ALTER TABLE app.trips        ADD COLUMN IF NOT EXISTS origin_region text;
ALTER TABLE app.trips        ADD COLUMN IF NOT EXISTS origin_city   text;

ALTER TABLE app.trips_manual ADD COLUMN IF NOT EXISTS origin_region text;
ALTER TABLE app.trips_manual ADD COLUMN IF NOT EXISTS origin_city   text;
