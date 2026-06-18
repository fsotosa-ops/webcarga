-- ==============================================================================
-- MIGRACIÓN: DROP tablas bronze deprecadas
-- Reemplazadas por: bronze.tms_trips (UPSERT) + bronze.tms_trips_snapshot (dbt SCD2)
-- Migración 20260618000005 backfilleó todos los datos. Pipeline ya usa tms_trips.
-- No hay referencias en frontend ni en monitor-api.
-- ==============================================================================

-- 1. RLS policy sobre raw_tms_trips (creada en 20260618000001_security_critical)
DROP POLICY IF EXISTS "bronze_trips_read" ON bronze.raw_tms_trips;

-- 2. Tabla SCD2 antigua (generada por dbt snapshot sobre raw_tms_trips)
--    Los índices sobre esta tabla (en 20260618000002) caen con CASCADE.
DROP TABLE IF EXISTS bronze.raw_tms_trips_snapshot CASCADE;

-- 3. Tabla append-only original (todos los datos migrados a bronze.tms_trips)
--    Los índices (idx_bronze_pending, idx_bronze_mage_run, etc.) caen con CASCADE.
DROP TABLE IF EXISTS bronze.raw_tms_trips CASCADE;
