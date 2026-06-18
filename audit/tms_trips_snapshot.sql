{% snapshot tms_trips_snapshot %}

{{
  config(
    target_schema='bronze',
    unique_key="tms_name || '|' || source_client || '|' || product || '|' || source_trip_id",
    strategy='check',
    check_cols=['payload_hash'],
    invalidate_hard_deletes=True
  )
}}

/*
  bronze.tms_trips_snapshot — SCD Type 2 del estado del viaje
  ──────────────────────────────────────────────────────────────
  Fuente: bronze.tms_trips (estado actual, UPSERT por viaje)
  unique_key: identidad del viaje SIN file_name

  dbt crea una nueva versión cuando cambia payload_hash (que incluye
  cualquier cambio en el payload, por lo tanto en trip_status).
  Cierra la versión anterior con dbt_valid_to = timestamp del run.

  Ciclo de vida de un viaje:
    INSERT → ASIGNADO  (dbt_valid_from=T1, dbt_valid_to=T2)
    UPDATE → RUTA      (dbt_valid_from=T2, dbt_valid_to=T3)
    UPDATE → EN LOCAL  (dbt_valid_from=T3, dbt_valid_to=T4)
    UPDATE → CERRADO   (dbt_valid_from=T4, dbt_valid_to=NULL) ← vigente

  Campos clave:
    payload_hash    → detecta cualquier cambio de estado
    file_name       → archivo fuente que reportó este estado (trazabilidad a GCS)
    file_generated_at → timestamp real del TMS (más preciso que dbt_valid_from)
    dbt_valid_from  → cuándo dbt detectó el cambio
    dbt_valid_to    → NULL = versión vigente del viaje
*/

SELECT
    -- Campos de identidad y estado
    tms_name,
    source_client,
    product,
    source_trip_id,
    payload,
    payload_hash,
    file_name,
    mage_run_id,

    -- Campos calculados para queries downstream
    CASE
        WHEN source_client = 'iansa'
            THEN payload->'trip_metadata'->>'Estado Rendicion'
            ELSE payload->'trip_metadata'->>'Estado'
    END AS trip_status,

    payload->'trip_metadata'->>'Patente'   AS patente,
    payload->'trip_metadata'->>'Conductor' AS conductor,

    -- Timestamp real del TMS (unix ts en el nombre del archivo)
    to_timestamp(
        regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint
    ) AT TIME ZONE 'America/Santiago' AS file_generated_at,

    -- Período que cubre el archivo
    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',2),
        'YYYYMMDD'
    ) AS file_period_from,

    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',3),
        'YYYYMMDD'
    ) AS file_period_to,

    first_seen_at,
    last_updated_at

FROM {{ source('bronze', 'tms_trips') }}

{% endsnapshot %}
