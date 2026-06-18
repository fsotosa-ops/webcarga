-- insert_raw_tms_qanalytics_sap.sql (v2 — patrón UPSERT)
-- Destino: bronze.tms_trips (misma tabla que trips, product='cumplimiento-sap')
--
-- Por qué la misma tabla:
--   bronze.tms_trips tiene UNIQUE(tms_name, source_client, product, source_trip_id)
--   → un mismo trip_id puede coexistir como 'trips' Y como 'cumplimiento-sap'
--   → un solo staging table para todos los productos de todos los TMS
--
-- Comportamiento UPSERT:
--   Si el viaje SAP no existe → INSERT
--   Si ya existe y el archivo es más reciente → UPDATE payload (nuevos datos de stops/arribo)
--   Si el archivo es más antiguo → DO NOTHING (evita regresiones)
--
-- El historial de cambios (on_time_status, fh_llegada por stop) lo gestiona
-- dbt snapshot (bronze.tms_sap_snapshot) leyendo de esta tabla.

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
FROM bronze.tmp_raw_qanalytics_sap
ORDER BY
    tms_name,
    source_client,
    product,
    payload::jsonb->>'trip_id',
    -- Si hay múltiples filas del mismo viaje SAP en el tmp, tomar la más reciente
    regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint DESC

ON CONFLICT (tms_name, source_client, product, source_trip_id)
DO UPDATE SET
    payload         = EXCLUDED.payload,
    file_name       = EXCLUDED.file_name,
    mage_run_id     = EXCLUDED.mage_run_id,
    last_updated_at = now()
WHERE
    -- Solo actualizar si el archivo nuevo es más reciente
    -- Cumplimiento-SAP: archivos más recientes tienen datos de arribo confirmados
    regexp_replace(split_part(EXCLUDED.file_name, '_', -1), '\.[^.]+$', '')::bigint
    > regexp_replace(split_part(bronze.tms_trips.file_name, '_', -1), '\.[^.]+$', '')::bigint;

DROP TABLE IF EXISTS bronze.tmp_raw_qanalytics_sap;
