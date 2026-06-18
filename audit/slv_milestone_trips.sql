{{
    config(
        materialized='incremental',
        unique_key='trip_stop_sk',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns',
        alias='tms_milestone_trips'
    )
}}

/*
  slv_milestone_trips → silver.tms_milestone_trips
  ──────────────────────────────────────────────────
  Fuente       : bronze.tms_sap_snapshot  (SCD Type 2, nivel stop)
  Granularidad : 1 fila por viaje × stop (estado más reciente)
  unique_key   : trip_stop_sk = md5(source_client | source_trip_id | stop_location_name)

  Watermark incremental: dbt_updated_at (cuándo dbt detectó el cambio)
  — NO file_generated_at, que puede ser menor al MAX en silver cuando
    un viaje antiguo recibe confirmación de arribo en una extracción nueva.
*/

WITH current_stops AS (
    SELECT *
    FROM {{ ref('tms_sap_snapshot') }}
    WHERE dbt_valid_to IS NULL  -- solo versión actual de cada stop
),

transformed_data AS (
    SELECT
        -- ✦ SK del stop (unique_key del modelo)
        {{ dbt_utils.generate_surrogate_key([
            'source_client',
            'source_trip_id',
            'stop_location_name'
        ]) }}                                                       AS trip_stop_sk,

        -- ✦ SKs de dimensiones
        trip_sk::uuid                                               AS otm_id,
        tms_client_sk::uuid                                         AS tms_client_id,

        -- Trazabilidad SCD2
        dbt_scd_id                                                  AS snapshot_version_id,
        dbt_valid_from,
        dbt_valid_to,
        dbt_updated_at,

        -- Identidad
        tms_name,
        product,
        source_client,
        source_trip_id,

        -- Cabecera del viaje
        trip_status,
        origin_location,
        carrier_name,
        conductor                                                   AS driver_name,
        is_external_fleet,
        tractor_plate,
        trailer_plate,

        -- Stop
        stop_location_name,
        destination_city,
        destination_region_id,

        -- ✦ Campos que el snapshot traza (cambian cuando se confirma el arribo)
        on_time_status,
        {{ parse_date_tms("fh_llegada",          'qanalytics') }}  AS actual_arrival_datetime,
        {{ parse_date_tms("raw_fh_planifica",    'qanalytics') }}  AS planned_datetime,

        -- Trazabilidad temporal
        file_generated_at,
        file_period_from,
        file_period_to,
        first_seen_at,
        last_updated_at,
        file_name,
        mage_run_id,

        file_generated_at   AS created_at,
        CURRENT_TIMESTAMP   AS updated_at

    FROM current_stops
),

ranked_stops AS (
    SELECT
        *,
        ROW_NUMBER() OVER (
            PARTITION BY trip_stop_sk
            ORDER BY file_generated_at DESC
        ) AS row_num
    FROM transformed_data
)

SELECT
    trip_stop_sk,
    otm_id,
    tms_client_id,
    snapshot_version_id,
    dbt_valid_from,
    dbt_valid_to,
    dbt_updated_at,
    tms_name,
    product,
    source_client,
    source_trip_id,
    trip_status,
    origin_location,
    carrier_name,
    driver_name,
    is_external_fleet,
    tractor_plate,
    trailer_plate,
    stop_location_name,
    destination_city,
    destination_region_id,
    on_time_status,
    actual_arrival_datetime,
    planned_datetime,
    file_generated_at,
    file_period_from,
    file_period_to,
    first_seen_at,
    last_updated_at,
    file_name,
    mage_run_id,
    created_at,
    updated_at
FROM ranked_stops
WHERE row_num = 1

{% if is_incremental() %}
  -- Watermark correcto: cuándo dbt detectó el cambio, no cuándo fue generado el archivo.
  -- Evita perder updates de viajes antiguos cuyo on_time_status se confirma tarde.
  AND dbt_updated_at > (
      SELECT COALESCE(MAX(dbt_updated_at), '1900-01-01'::timestamptz) FROM {{ this }}
  )
{% endif %}
