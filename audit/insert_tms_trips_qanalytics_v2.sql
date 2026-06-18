-- insert_tms_trips_qanalytics.sql (v2 — patrón UPSERT)
-- Destino: bronze.tms_trips (tabla de estado actual, 1 fila por viaje)
--
-- Comportamiento: UPSERT por (tms_name, source_client, product, source_trip_id)
--   Si el viaje no existe → INSERT
--   Si ya existe y el archivo fuente es más reciente → UPDATE estado
--   Si ya existe pero el archivo es más antiguo → DO NOTHING (no regresar estado)
--
-- El historial de cambios de estado lo gestiona dbt snapshot (bronze.tms_trips_snapshot).
-- GCS contiene el archivo original para replay si se necesita reauditar.

INSERT INTO bronze.tms_trips (
    tms_name,
    source_client,
    product,
    source_trip_id,
    payload,
    file_name,
    mage_run_id
)
SELECT DISTINCT ON (tms_name, source_client, product, payload::jsonb->>'trip_id')
    tms_name,
    source_client,
    product,
    payload::jsonb->>'trip_id'  AS source_trip_id,
    payload::jsonb,
    file_name,
    mage_run_id
FROM bronze.tmp_raw_qanalytics_trips
ORDER BY
    tms_name,
    source_client,
    product,
    payload::jsonb->>'trip_id',
    -- Si hay múltiples filas del mismo viaje en el archivo temporal, tomar la más reciente
    regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint DESC

ON CONFLICT (tms_name, source_client, product, source_trip_id)
DO UPDATE SET
    payload         = EXCLUDED.payload,
    file_name       = EXCLUDED.file_name,
    mage_run_id     = EXCLUDED.mage_run_id,
    last_updated_at = now()
WHERE
    -- Solo actualizar si el archivo nuevo es más reciente que el que ya está guardado
    -- Compara unix timestamps embebidos en el file_name (evita regresiones de estado)
    regexp_replace(split_part(EXCLUDED.file_name, '_', -1), '\.[^.]+$', '')::bigint
    > regexp_replace(split_part(bronze.tms_trips.file_name, '_', -1), '\.[^.]+$', '')::bigint;

DROP TABLE IF EXISTS bronze.tmp_raw_qanalytics_trips;
