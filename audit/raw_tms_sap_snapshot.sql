{% snapshot tms_sap_snapshot %}

{{
  config(
    target_schema='bronze',
    unique_key='sap_stop_identity',
    strategy='check',
    check_cols=['on_time_status', 'fh_llegada'],
    invalidate_hard_deletes=True
  )
}}

/*
  tms_sap_snapshot  (renombrado de raw_tms_sap_snapshot)
  ────────────────────────────────────────────────────────
  Fuente       : bronze.tms_trips WHERE product = 'cumplimiento-sap'
                 → 1 fila por viaje, UPSERT, ya deduplicado
  Granularidad : 1 fila por viaje × stop (igual que antes)
  unique_key   : tms | client | source_trip_id | stop_location_name
  check_cols   : campos que cambian cuando se confirma el arribo de un stop
                   - on_time_status  NULL → ON TIME / OFF TIME
                   - fh_llegada      NULL → fecha/hora real de llegada

  La CTE 'deduped' original existía porque raw_tms_trips era append-only
  (207 filas del mismo viaje SAP acumuladas). Con bronze.tms_trips (UPSERT)
  hay exactamente 1 fila por viaje → no hay qué deduplicar.

  Cómo detecta cambios (SCD Type 2):
    Extracción A → stop "Santiago" on_time_status=NULL  → INSERT snapshot
    Extracción B → stop "Santiago" on_time_status='ON TIME'
      → on_time_status cambió → dbt cierra versión A (dbt_valid_to=T2)
      → INSERT nueva versión (dbt_valid_from=T2, dbt_valid_to=NULL)

  Para re-procesar desde cero:
    dbt snapshot --select tms_sap_snapshot --full-refresh
*/

SELECT
    -- ✦ Clave de identidad: viaje × stop (unique_key del snapshot)
    t.tms_name || '|' || t.source_client || '|' || t.source_trip_id
        || '|' || REPLACE(parada->>'Local', '*', '')         AS sap_stop_identity,

    -- ✦ SKs downstream
    md5(t.tms_name || '|' || t.source_client || '|' || t.source_trip_id)
                                                             AS trip_sk,
    md5(t.tms_name || '|' || t.source_client)               AS tms_client_sk,

    -- Identidad
    t.source_trip_id,
    t.id                                                     AS bronze_row_id,
    t.tms_name,
    t.product,
    t.source_client,
    t.file_name,
    t.mage_run_id,

    -- Trazabilidad de ingesta (reemplaza ingestion_timestamp de raw_tms_trips)
    t.first_seen_at,
    t.last_updated_at,

    -- Timestamps derivados del nombre de archivo GCS (unix ts en el sufijo)
    to_timestamp(
        split_part(
            regexp_replace(split_part(t.file_name, '/', -1), '\.[^.]+$', ''),
            '_', -1
        )::bigint
    ) AT TIME ZONE 'America/Santiago'                        AS file_generated_at,

    to_date(
        split_part(regexp_replace(split_part(t.file_name,'/',-1),'\.[^.]+$',''),'_',2),
        'YYYYMMDD'
    )                                                        AS file_period_from,

    to_date(
        split_part(regexp_replace(split_part(t.file_name,'/',-1),'\.[^.]+$',''),'_',3),
        'YYYYMMDD'
    )                                                        AS file_period_to,

    -- Cabecera del viaje (no cambia — cumplimiento-sap solo reporta viajes CERRADOS)
    t.payload->'trip_metadata'->>'Estado'                    AS trip_status,
    t.payload->'trip_metadata'->>'Origen'                    AS origin_location,
    t.payload->'trip_metadata'->>'Transporte'                AS carrier_name,
    t.payload->'trip_metadata'->>'Conductor'                 AS conductor,
    t.payload->'trip_metadata'->>'FH Planifica'              AS raw_fh_planifica,
    UPPER(TRIM(t.payload->'trip_metadata'->>'Externo')) = 'SI'
                                                             AS is_external_fleet,
    SUBSTRING(t.payload->'trip_metadata'->>'Patente' FROM 'TRACTO:\s*(\w+)')
                                                             AS tractor_plate,
    SUBSTRING(t.payload->'trip_metadata'->>'Patente' FROM 'TRAILER:\s*(\w+)')
                                                             AS trailer_plate,

    -- ✦ Stop — los únicos campos que evolucionan (check_cols)
    REPLACE(parada->>'Local', '*', '')                       AS stop_location_name,
    parada->>'Localidad'                                     AS destination_city,
    parada->>'Denominacion_Region'                           AS destination_region_id,
    NULLIF(TRIM(parada->>'Arribo'), '')                      AS on_time_status,   -- check_col 1
    NULLIF(TRIM(parada->>'FH Llegada'), '')                  AS fh_llegada        -- check_col 2

FROM {{ source('bronze', 'tms_trips') }} t,
     LATERAL jsonb_array_elements(t.payload->'stops') AS parada
WHERE t.product = 'cumplimiento-sap'

{% endsnapshot %}
