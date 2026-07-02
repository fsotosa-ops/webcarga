{{ config(materialized='view', schema='silver') }}

/*
  stg_qanalytics_sap_only_trips
  ──────────────────────────────────────────────────────────────────
  Viajes visibles en silver.tms_milestone_trips (cumplimiento SAP) sin
  fila correspondiente en stg_qanalytics_trips — SAP cerró/reportó el
  viaje antes de que el Monitor lo capturara, o el viaje solo existe en
  el dataset de cumplimiento.

  Mismo contrato de columnas y mismo patrón estructural que
  stg_qanalytics_trips / stg_sodimac_trips / stg_wingsuite_trips
  (trips_metadata + stops_timeline, JOIN por identidad de viaje) para
  que silver.int_tms_trips_conformed sea un UNION ALL trivial de 4
  modelos pares — no vive lógica de extracción/agregación cruda dentro
  de la capa conformada.

  CONTINUIDAD DE trip_id (crítico para trazabilidad): trip_id se deriva
  con la MISMA fórmula que trip_sk en las otras 3 stg_* —
  md5(tms_name||'|'||source_client||'|'||source_trip_id) — usando las
  columnas de identidad estable de silver.tms_milestone_trips, NO
  ml.otm_id (un UUID calculado de forma independiente dentro del
  pipeline de cumplimiento SAP, sin relación con esa fórmula). Así, si
  un viaje visto aquí como "solo SAP" es luego capturado por el Monitor
  (aparece en stg_qanalytics_trips), ambas fuentes producen el MISMO
  trip_id para el mismo viaje real — la fila se resuelve limpio en el
  UNION ALL (este modelo deja de emitirla por el NOT EXISTS) sin romper
  la trazabilidad ni dejar una fila huérfana con otro id en app.trips.

  Fuente       : silver.tms_milestone_trips (grano 1 fila por viaje × stop)
  Grano salida : 1 fila por viaje (trip_id = md5(tms_name|source_client|source_trip_id))
*/

WITH sap_only_stops AS (
    SELECT ml.*
    FROM {{ ref('slv_milestone_trips') }} ml
    WHERE ml.dbt_valid_to IS NULL
      AND ml.tms_name = 'qanalytics'
      -- excluir viajes que ya existen en el Monitor de viajes
      AND NOT EXISTS (
          SELECT 1 FROM {{ ref('stg_qanalytics_trips') }} qa
          WHERE qa.source_system_trip_id = ml.source_trip_id
      )
),

-- ✦ 1 fila por viaje: dedup determinístico (NO MAX() sobre denormalizado) ─────
trips_metadata AS (
    SELECT DISTINCT ON (otm_id)
        otm_id, tms_client_id, tms_name, source_client, source_trip_id,
        trip_status, origin_location, planned_datetime, carrier_name, driver_name,
        tractor_plate, trailer_plate, snapshot_version_id,
        dbt_valid_from, dbt_valid_to, file_generated_at, file_period_from,
        file_period_to, first_seen_at, updated_at
    FROM sap_only_stops
    ORDER BY otm_id, file_generated_at DESC
),

-- ✦ Paradas agregadas por viaje ────────────────────────────────────────────────
stops_timeline AS (
    SELECT
        otm_id,
        bool_or(is_external_fleet) AS is_external_fleet,
        jsonb_agg(
            jsonb_build_object(
                'location_name',                stop_location_name,
                'action_type',                  'DELIVERY',
                'raw_action_type',               'SAP',
                'actual_arrival_at',             actual_arrival_datetime,
                'actual_departure_at',           NULL,
                'custom_s2s',                    NULL,
                'custom_temperature',            NULL,
                'custom_unload_start_at',        NULL,
                'custom_unload_end_at',          NULL,
                'custom_gps_arrival_at',         NULL,
                'custom_gps_departure_at',       NULL,
                'milestone_destination_city',    destination_city,
                'milestone_destination_region',  destination_region_id,
                'milestone_on_time_status',      on_time_status,
                'milestone_actual_arrival_at',   actual_arrival_datetime
            ) ORDER BY actual_arrival_datetime ASC NULLS LAST
        ) AS trip_stops
    FROM sap_only_stops
    GROUP BY otm_id
)

-- ✦ Contrato idéntico a stg_qanalytics_trips / stg_sodimac_trips / stg_wingsuite_trips
SELECT
    md5(t.tms_name || '|' || t.source_client || '|' || t.source_trip_id)::uuid
                                                       AS trip_id,
    NULL::uuid                                        AS status_sk,
    NULL::uuid                                        AS trip_version_id,
    t.tms_client_id                                   AS source_client_id,
    md5(t.tms_name)::uuid                             AS source_system_id,
    t.tms_name                                        AS source_system,
    t.source_client                                   AS client_name,
    t.source_trip_id                                  AS source_system_trip_id,
    NULL::varchar                                     AS tms_internal_trip_id,
    t.source_trip_id                                  AS trip_reference_number,
    t.trip_status                                     AS trip_status,
    NULL::varchar                                     AS cargo_type,
    NULL::varchar                                     AS trip_type,
    t.origin_location                                 AS origin_location_name,
    t.planned_datetime                                AS planned_departure_at,
    NULL::timestamptz                                 AS actual_departure_at,
    NULL::varchar                                     AS shipper_name,
    NULL::varchar                                     AS shipper_tax_id,
    t.carrier_name                                    AS carrier_name,
    NULL::varchar                                     AS carrier_tax_id,
    NULL::varchar                                     AS driver_document_id,
    NULL::varchar                                     AS driver_first_name,
    NULL::varchar                                     AS driver_last_name,
    t.driver_name                                     AS driver_name,
    t.tractor_plate                                   AS vehicle_plate,
    NULL::varchar                                     AS vehicle_internal_id,
    NULL::varchar                                     AS vehicle_owner_name,
    t.trailer_plate                                   AS trailer_plate,
    NULL::varchar                                     AS trailer_internal_id,
    NULL::varchar                                     AS trailer_owner_name,
    s.trip_stops,
    NULL::varchar                                     AS custom_dt,
    NULL::varchar                                     AS custom_num,
    NULL::varchar                                     AS custom_trip_appointments,
    NULL::varchar                                     AS custom_external_status,
    NULL::varchar                                     AS custom_gps_status,
    s.is_external_fleet                               AS custom_is_external_fleet,
    NULL::varchar                                     AS custom_control,
    t.snapshot_version_id,
    NULL::text                                        AS trip_file_identity,
    t.dbt_valid_from,
    t.dbt_valid_to,
    true                                               AS is_current,
    t.file_generated_at,
    t.file_period_from,
    t.file_period_to,
    t.first_seen_at                                   AS ingestion_timestamp,
    NULL::jsonb                                        AS raw_file_metadata,
    t.file_generated_at                               AS created_at,
    t.updated_at                                       AS updated_at
FROM trips_metadata t
LEFT JOIN stops_timeline s ON t.otm_id = s.otm_id
