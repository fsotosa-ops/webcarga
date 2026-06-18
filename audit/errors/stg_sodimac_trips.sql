{{ config(materialized='view', schema='silver') }}

/*
  stg_sodimac_trips
  ──────────────────
  Fuente       : bronze.raw_tms_sodimac_snapshot
  Granularidad : 1 fila por viaje × archivo (sodimac es plano, sin stops)
  is_current   : true = archivo más reciente para este viaje

  Sodimac no tiene array de stops — 1 destino por viaje en trip_metadata.
  HORA viene como "7:00 AM" sin fecha → arrival_date es NULL (no combinable).
  FECHA viene como "DD-MM-YYYY" → solo planning_date con fecha.

  Contrato de columnas unificado con stg_qanalytics_trips y stg_wingsuite_trips.
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
    WHERE tms_name = 'sodimac'
      AND product  = 'trips'
)

SELECT
    -- ── IDs ──────────────────────────────────────────────────────────────────
    trip_sk::uuid                                                               AS otm_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(payload->'trip_metadata'->>'ESTADO', ''))::uuid      AS status_id,
    -- Sodimac no tiene stops → stop_id basado en DESTINO
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(payload->'trip_metadata'->>'DESTINO', ''))::uuid     AS stop_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || file_name)::uuid                                              AS trip_version_id,
    tms_client_sk::uuid                                                         AS tms_client_id,
    md5(tms_name)::uuid                                                         AS tms_id,
    tms_name,
    source_client                                                               AS client_name,
    source_trip_id,

    -- ── Trazabilidad SCD2 ────────────────────────────────────────────────────
    dbt_scd_id                                                                  AS snapshot_version_id,
    trip_file_identity,
    dbt_valid_from,
    dbt_valid_to,
    (rn_current = 1)                                                            AS is_current,

    -- ── Timestamps ───────────────────────────────────────────────────────────
    file_generated_at,
    file_period_from,
    file_period_to,
    ingestion_timestamp,

    -- ── Negocio ──────────────────────────────────────────────────────────────
    {{ clean_string("payload->'trip_metadata'->>'ESTADO'") }}                   AS status,
    NULL::varchar                                                               AS control,
    {{ clean_string("payload->'trip_metadata'->>'Nº ID'") }}                    AS reference_number,
    'SECO'::varchar                                                             AS cargo_type,
    {{ clean_string("payload->'trip_metadata'->>'TRANSPORTISTA'") }}            AS transport,
    -- DESTINO = local (único stop de sodimac)
    {{ clean_string("payload->'trip_metadata'->>'DESTINO'") }}                  AS local,
    NULL::varchar                                                               AS s2s,
    NULL::numeric                                                               AS temperature,

    -- Fechas: FECHA=DD-MM-YYYY (solo fecha), HORA=H:MM AM/PM (solo hora sin fecha)
    {{ parse_date_tms("payload->'trip_metadata'->>'FECHA'", 'sodimac') }}       AS planning_date,
    NULL::timestamptz                                                           AS arrival_date,
    NULL::timestamptz                                                           AS departure_date,
    NULL::timestamptz                                                           AS unload_start,
    NULL::timestamptz                                                           AS unload_end,
    NULL::timestamptz                                                           AS gps_arrival_date,
    NULL::timestamptz                                                           AS gps_departure_date,
    NULL::timestamptz                                                           AS departure_date_prog,

    NULL::varchar                                                               AS tractor_plate,
    {{ clean_string("payload->'trip_metadata'->>'PATENTE'") }}                  AS trailer_plate,
    NULL::varchar                                                               AS driver,

    -- ── Campos extendidos ────────────────────────────────────────────────────
    {{ clean_string("payload->'trip_metadata'->>'ORIGEN'") }}                   AS origin,
    -- HORA planificada como estimated_time (no convertible a timestamp)
    {{ clean_string("payload->'trip_metadata'->>'HORA'") }}                     AS estimated_time,
    NULL::varchar                                                               AS dni_driver,
    NULL::varchar                                                               AS dni_tractor_company,
    NULL::varchar                                                               AS dni_trailer_company,
    NULL::varchar                                                               AS trip_type,
    NULL::varchar                                                               AS transport_company,
    {{ clean_string("payload->'trip_metadata'->>'TIPO DE EQUIPO'") }}           AS equipment_type,
    NULL::varchar                                                               AS destination_city,
    NULL::varchar                                                               AS destination_region_id,
    NULL::varchar                                                               AS on_time_status,

    -- ── Auditoría ────────────────────────────────────────────────────────────
    jsonb_build_object(
        'file_name',           file_name,
        'snapshot_version',    dbt_scd_id,
        'file_generated_at',   file_generated_at,
        'ingestion_timestamp', ingestion_timestamp
    )                                                                           AS raw_file_metadata,
    file_generated_at   AS created_at,
    CURRENT_TIMESTAMP   AS updated_at

FROM snapshot_ranked