-- insert_raw_tms_trips_qanalytics.sql
-- Comportamiento: append-only por viaje × archivo
-- raw_tms_trips acumula TODAS las versiones de cada viaje en TODOS los archivos
-- Permite trazabilidad completa de cambios de estado en el tiempo

INSERT INTO bronze.raw_tms_trips (
    tms_name,
    product,
    source_client,
    file_name,
    mage_run_id,
    payload
)
SELECT DISTINCT ON (tms_name, source_client, product, payload::jsonb->>'trip_id', file_name)
    tms_name,
    product,
    source_client,
    file_name,
    mage_run_id,
    payload::jsonb
FROM bronze.tmp_raw_qanalytics_trips
ORDER BY
    tms_name,
    source_client,
    product,
    payload::jsonb->>'trip_id',
    file_name,
    -- Si hay duplicados del mismo viaje en el mismo archivo, gana el más reciente
    regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint DESC

ON CONFLICT (tms_name, source_client, product, source_trip_id, file_name)
    DO NOTHING;  -- mismo viaje × mismo archivo ya existe → ignorar

DROP TABLE IF EXISTS bronze.tmp_raw_qanalytics_trips;