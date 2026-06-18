-- backfill_tms_sap_snapshot.sql
-- Migra las versiones históricas cerradas de raw_tms_sap_snapshot → tms_sap_snapshot.
--
-- PREREQUISITO: dbt snapshot --select tms_sap_snapshot  (debe haber corrido primero)
-- CUÁNDO: Una vez, inmediatamente después del primer dbt snapshot run.
--
-- Por qué es necesario:
--   raw_tms_sap_snapshot tiene 1,463 versiones cerradas (dbt_valid_to IS NOT NULL)
--   que representan confirmaciones reales de arribo (on_time_status: NULL → ON TIME/OFF TIME).
--   Son eventos de negocio irreproducibles que se perderían si el nuevo snapshot
--   arranca solo con el estado actual desde bronze.tms_trips.
--
-- Las versiones vigentes (dbt_valid_to IS NULL) ya las insertó dbt en el primer run
-- de tms_sap_snapshot — solo migramos las cerradas.
--
-- Los dbt_scd_id del snapshot antiguo son seguros de reusar porque tms_sap_snapshot
-- es una tabla nueva — no puede haber colisión con los scd_id que dbt generó en el
-- primer run (dbt usa NOW() como componente del hash, que difiere del historico).

INSERT INTO bronze.tms_sap_snapshot (
    sap_stop_identity,
    trip_sk,
    tms_client_sk,
    source_trip_id,
    bronze_row_id,
    tms_name,
    product,
    source_client,
    file_name,
    mage_run_id,
    first_seen_at,
    last_updated_at,
    file_generated_at,
    file_period_from,
    file_period_to,
    trip_status,
    origin_location,
    carrier_name,
    conductor,
    raw_fh_planifica,
    is_external_fleet,
    tractor_plate,
    trailer_plate,
    stop_location_name,
    destination_city,
    destination_region_id,
    on_time_status,
    fh_llegada,
    dbt_scd_id,
    dbt_updated_at,
    dbt_valid_from,
    dbt_valid_to
)
SELECT
    s.sap_stop_identity,
    s.trip_sk,
    s.tms_client_sk,
    s.source_trip_id,
    -- bronze_row_id apunta ahora a bronze.tms_trips (no a raw_tms_trips)
    t.id                                         AS bronze_row_id,
    s.tms_name,
    'cumplimiento-sap'                           AS product,
    s.source_client,
    s.file_name,
    s.mage_run_id,
    -- first_seen_at / last_updated_at: reemplazan ingestion_timestamp del schema antiguo
    s.ingestion_timestamp                        AS first_seen_at,
    s.ingestion_timestamp                        AS last_updated_at,
    s.file_generated_at,
    s.file_period_from,
    s.file_period_to,
    s.trip_status,
    s.origin_location,
    s.carrier_name,
    s.conductor,
    s.raw_fh_planifica,
    s.is_external_fleet,
    s.tractor_plate,
    s.trailer_plate,
    s.stop_location_name,
    s.destination_city,
    s.destination_region_id,
    s.on_time_status,
    s.fh_llegada,
    -- Reusar el dbt_scd_id del snapshot antiguo (no hay colisión — tabla nueva)
    s.dbt_scd_id,
    s.dbt_updated_at,
    s.dbt_valid_from,
    s.dbt_valid_to

FROM bronze.raw_tms_sap_snapshot s
LEFT JOIN bronze.tms_trips t
    ON  t.source_trip_id = s.source_trip_id
    AND t.product        = 'cumplimiento-sap'

WHERE s.dbt_valid_to IS NOT NULL  -- solo versiones históricas cerradas

ON CONFLICT DO NOTHING;           -- idempotente

-- Verificación post-backfill:
-- SELECT
--     COUNT(*) FILTER (WHERE dbt_valid_to IS NULL)     AS vigentes,
--     COUNT(*) FILTER (WHERE dbt_valid_to IS NOT NULL) AS historicas
-- FROM bronze.tms_sap_snapshot;
-- Esperado: ~2,922 vigentes (dbt) + 1,463 históricas (este backfill)
