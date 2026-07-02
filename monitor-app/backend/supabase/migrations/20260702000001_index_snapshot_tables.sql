-- Indexa las tablas generadas por `dbt snapshot` (SCD2) que las vistas
-- silver.stg_qanalytics_trips / stg_sodimac_trips / stg_wingsuite_trips
-- consultan directamente. Confirmado vía pg_indexes/pg_constraint que
-- bronze.tms_trips_snapshot y silver.tms_milestone_trips no tenían
-- ningún índice ni constraint: dbt no los crea automáticamente al
-- generar snapshots, y bronze.tms_trips (la tabla base, ya indexada)
-- no es lo mismo que su snapshot SCD2.
--
-- Evidencia medida antes de este cambio: EXPLAIN ANALYZE sobre
-- `silver.stg_qanalytics_trips LIMIT 50` tardaba ~1.8s con seq scan +
-- sort a disco sobre bronze.tms_trips_snapshot (12.3k filas hoy).
--
-- Todos los índices son btree normales (NO UNIQUE): bajo SCD2 el mismo
-- viaje tiene múltiples filas legítimas a través del tiempo (una por
-- cambio de estado / dbt_valid_from-dbt_valid_to), por lo que un índice
-- UNIQUE sobre la llave natural rompería los inserts del snapshot. Los
-- índices parciales (WHERE dbt_valid_to IS NULL) coinciden exactamente
-- con el lookup que la estrategia `check` de dbt hace en cada corrida
-- para encontrar la fila vigente a cerrar.

-- bronze.tms_trips_snapshot: soporta el filtro (tms_name, product) +
-- el ROW_NUMBER() OVER (PARTITION BY trip_sk ORDER BY file_generated_at DESC)
-- que usan las 3 stg_* para determinar la versión vigente por viaje.
CREATE INDEX IF NOT EXISTS idx_tms_trips_snapshot_current_lookup
    ON bronze.tms_trips_snapshot (tms_name, product, source_trip_id, file_generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_trips_snapshot_valid_current
    ON bronze.tms_trips_snapshot (tms_name, source_client, product, source_trip_id)
    WHERE dbt_valid_to IS NULL;

-- silver.tms_milestone_trips: soporta el DISTINCT ON / ranking por
-- (source_trip_id, stop_location_name, updated_at DESC) que usan
-- stg_qanalytics_trips y stg_sodimac_trips para el join de milestones,
-- y el filtro por (tms_name, dbt_valid_to IS NULL) de
-- int_tms_trips_conformed.qanalytics_sap_only.
CREATE INDEX IF NOT EXISTS idx_tms_milestone_trips_lookup
    ON silver.tms_milestone_trips (source_trip_id, stop_location_name, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tms_milestone_trips_valid_current
    ON silver.tms_milestone_trips (tms_name, source_trip_id)
    WHERE dbt_valid_to IS NULL;
