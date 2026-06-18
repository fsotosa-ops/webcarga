{{ config(materialized='view', schema='silver') }}

/*
  stg_qanalytics_trips
  ─────────────────────
  Fuente       : bronze.raw_tms_trips_snapshot
  Granularidad : 1 fila por viaje × archivo × stop
  is_current   : true = archivo más reciente para este viaje

  Contrato de columnas unificado con stg_sodimac_trips y stg_wingsuite_trips
  para permitir union_tms_sources en slv_tms_trips.
*/

WITH snapshot_ranked AS (
    SELECT
        *,
        md5(tms_name || '|' || source_client || '|' || source_trip_id)                 AS trip_sk,
        md5(tms_name || '|' || source_client)                                           AS tms_client_sk,
        md5(tms_name || '|' || source_client || '|' || product
            || '|' || source_trip_id || '|' || file_name)                              AS trip_file_identity,
        first_seen_at                                                                    AS ingestion_timestamp,
        ROW_NUMBER() OVER (
            PARTITION BY md5(tms_name || '|' || source_client || '|' || source_trip_id)
            ORDER BY file_generated_at DESC
        ) AS rn_current
    FROM {{ ref('tms_trips_snapshot') }}
    WHERE tms_name = 'qanalytics'
      AND product  = 'trips'
),

raw_flattened AS (
    SELECT
        snap.trip_file_identity,
        snap.trip_sk,
        snap.tms_client_sk,
        snap.dbt_scd_id                                 AS snapshot_version_id,
        snap.dbt_valid_from,
        snap.dbt_valid_to,
        (snap.rn_current = 1)                           AS is_current,
        snap.file_generated_at,
        snap.file_period_from,
        snap.file_period_to,
        snap.ingestion_timestamp,
        snap.source_trip_id,
        snap.tms_name,
        snap.source_client,
        snap.product,
        snap.file_name,
        snap.mage_run_id,
        snap.payload,
        parada.elemento->>'Local'           AS raw_local,
        parada.elemento->>'S2S'             AS raw_s2s,
        parada.elemento->>'T°'              AS raw_temp,
        parada.elemento->>'FH Llegada Tr'   AS raw_llegada_tr,
        parada.elemento->>'FH Salida Tr'    AS raw_salida_tr,
        parada.elemento->>'Ini Descarga'    AS raw_ini_descarga,
        parada.elemento->>'Fin Descarga'    AS raw_fin_descarga,
        parada.elemento->>'FH Llegada Gps'  AS raw_llegada_gps,
        parada.elemento->>'FH Salida Gps'   AS raw_salida_gps
    FROM snapshot_ranked snap
    LEFT JOIN LATERAL jsonb_array_elements(snap.payload->'stops') AS parada(elemento) ON true
    WHERE snap.tms_name = 'qanalytics'
      AND snap.product  = 'trips'
)

SELECT
    -- ── IDs ──────────────────────────────────────────────────────────────────
    trip_sk::uuid                                                               AS otm_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(payload->'trip_metadata'->>'Estado', ''))::uuid      AS status_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(REPLACE(raw_local, '*', ''), ''))::uuid              AS stop_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || file_name)::uuid                                              AS trip_version_id,
    tms_client_sk::uuid                                                         AS tms_client_id,
    md5(tms_name)::uuid                                                         AS tms_id,
    tms_name,
    source_client                                                               AS client_name,
    source_trip_id,

    -- ── Trazabilidad SCD2 ────────────────────────────────────────────────────
    snapshot_version_id,
    trip_file_identity,
    dbt_valid_from,
    dbt_valid_to,
    is_current,

    -- ── Timestamps ───────────────────────────────────────────────────────────
    file_generated_at,
    file_period_from,
    file_period_to,
    ingestion_timestamp,

    -- ── Negocio ──────────────────────────────────────────────────────────────
    payload->'trip_metadata'->>'Estado'                                         AS status,
    {{ clean_string("payload->'trip_metadata'->>'Control'") }}                  AS control,
    {{ clean_string("payload->'trip_metadata'->>'Nro SAP'") }}                  AS reference_number,
    {{ clean_string("payload->'trip_metadata'->>'Tipo Carga'") }}               AS cargo_type,
    {{ clean_string("payload->'trip_metadata'->>'Transporte'") }}               AS transport,
    {{ clean_string("REPLACE(raw_local, '*', '')") }}                           AS local,
    {{ clean_string("raw_s2s") }}                                               AS s2s,
    NULLIF(TRIM(raw_temp), '')::numeric                                         AS temperature,

    {{ parse_date_tms("payload->'trip_metadata'->>'FH Planifica'", 'qanalytics') }} AS planning_date,
    {{ parse_date_tms("raw_llegada_tr",   'qanalytics') }}                          AS arrival_date,
    {{ parse_date_tms("raw_salida_tr",    'qanalytics') }}                          AS departure_date,
    {{ parse_date_tms("raw_ini_descarga", 'qanalytics') }}                          AS unload_start,
    {{ parse_date_tms("raw_fin_descarga", 'qanalytics') }}                          AS unload_end,
    {{ parse_date_tms("raw_llegada_gps",  'qanalytics') }}                          AS gps_arrival_date,
    {{ parse_date_tms("raw_salida_gps",   'qanalytics') }}                          AS gps_departure_date,
    NULL::timestamptz                                                               AS departure_date_prog,

    {{ clean_string("SUBSTRING(payload->'trip_metadata'->>'Patente' FROM 'TRACTO:\\s*(\\w+)')") }}  AS tractor_plate,
    {{ clean_string("SUBSTRING(payload->'trip_metadata'->>'Patente' FROM 'TRAILER:\\s*(\\w+)')") }} AS trailer_plate,
    {{ clean_string("payload->'trip_metadata'->>'Conductor'") }}                AS driver,

    -- ── Campos extendidos (qanalytics no tiene estos) ────────────────────────
    NULL::varchar       AS origin,
    NULL::varchar       AS estimated_time,
    NULL::varchar       AS dni_driver,
    NULL::varchar       AS dni_tractor_company,
    NULL::varchar       AS dni_trailer_company,
    NULL::varchar       AS trip_type,
    NULL::varchar       AS transport_company,
    NULL::varchar       AS equipment_type,
    NULL::varchar       AS destination_city,
    NULL::varchar       AS destination_region_id,
    NULL::varchar       AS on_time_status,

    -- ── Auditoría ────────────────────────────────────────────────────────────
    jsonb_build_object(
        'file_name',           file_name,
        'snapshot_version',    snapshot_version_id,
        'file_generated_at',   file_generated_at,
        'ingestion_timestamp', ingestion_timestamp
    )                                                                           AS raw_file_metadata,
    file_generated_at   AS created_at,
    CURRENT_TIMESTAMP   AS updated_at

FROM raw_flattened