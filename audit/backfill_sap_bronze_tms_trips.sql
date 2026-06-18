-- backfill_sap_bronze_tms_trips.sql
-- Poblamos bronze.tms_trips con el último estado de cada viaje SAP
-- desde bronze.raw_tms_trips (product='cumplimiento-sap').
--
-- Ejecutar una sola vez en Supabase SQL Editor (o como migration).
-- Después de esto, los nuevos runs de Mage escriben directo a bronze.tms_trips.
--
-- NOTA: si source_trip_id está NULL en raw_tms_trips para SAP
--       (el INSERT original no lo seteaba), ajustar a payload->>'trip_id'

INSERT INTO bronze.tms_trips (
    tms_name,
    source_client,
    product,
    source_trip_id,
    payload,
    file_name,
    mage_run_id,
    first_seen_at,
    last_updated_at
)
SELECT DISTINCT ON (tms_name, source_client, product, source_trip_id)
    tms_name,
    source_client,
    product,
    -- Si source_trip_id está vacío en raw_tms_trips (el insert antiguo no lo seteaba),
    -- descomenta la siguiente línea y comenta la de arriba:
    -- COALESCE(source_trip_id, payload->>'trip_id') AS source_trip_id,
    source_trip_id,
    payload,
    file_name,
    mage_run_id,

    -- first_seen_at = la primera vez que apareció este viaje en cualquier archivo
    MIN(ingestion_timestamp) OVER (
        PARTITION BY tms_name, source_client, product, source_trip_id
    ) AS first_seen_at,

    -- last_updated_at = el archivo más reciente (el que ganó el DISTINCT ON)
    ingestion_timestamp AS last_updated_at

FROM bronze.raw_tms_trips
WHERE product = 'cumplimiento-sap'
  AND source_trip_id IS NOT NULL  -- excluir filas sin trip_id parseable
ORDER BY
    tms_name,
    source_client,
    product,
    source_trip_id,
    -- archivo más reciente por unix ts embebido en el file_name
    regexp_replace(split_part(file_name, '/', -1), '\.[^.]+$', '')::bigint DESC

ON CONFLICT (tms_name, source_client, product, source_trip_id)
DO NOTHING;  -- si ya existe (no debería), no sobreescribir

-- Verificación post-backfill:
-- SELECT product, COUNT(*) FROM bronze.tms_trips GROUP BY product;
-- Deberías ver:
--   trips            → ~1,729 (ya estaban)
--   cumplimiento-sap → N (recién backfilleados)
