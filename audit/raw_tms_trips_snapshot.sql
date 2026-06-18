{% snapshot tms_trips_snapshot %}

{{
  config(
    target_schema='bronze',
    target_database=env_var('DBT_DATABASE', 'postgres'),
    unique_key="tms_name || '|' || source_client || '|' || product || '|' || source_trip_id",
    strategy='check',
    check_cols=['payload_hash'],
    invalidate_hard_deletes=True
  )
}}

/*
  bronze.tms_trips_snapshot — SCD Type 2 del ciclo de vida del viaje
  ────────────────────────────────────────────────────────────────────
  Fuente: bronze.tms_trips  (estado actual, 1 fila por viaje, UPSERT)
  unique_key: identidad del viaje — SIN file_name

  dbt abre una nueva versión cuando payload_hash cambia
  (cualquier cambio en el estado o datos del viaje).
  Cierra la versión anterior con dbt_valid_to = timestamp del run.

  Ciclo de vida de un viaje:
    1ª extracción → ASIGNADO  (valid_from=T1, valid_to=T2)
    cambio estado → RUTA      (valid_from=T2, valid_to=T3)
    cambio estado → EN LOCAL  (valid_from=T3, valid_to=T4)
    cambio estado → CERRADO   (valid_from=T4, valid_to=NULL) ← vigente

  Campos clave:
    payload_hash    → detecta cualquier cambio en el estado del viaje
    file_name       → archivo GCS que reportó este estado (trazabilidad)
    file_generated_at → timestamp real del TMS (extraído del nombre de archivo)
    dbt_valid_from  → cuándo dbt detectó el cambio (resolución = frecuencia del run)
    dbt_valid_to    → NULL = versión vigente del viaje

  Para re-procesar desde cero:
    dbt snapshot --select tms_trips_snapshot --full-refresh
*/

SELECT
    -- Surrogate key del viaje (estable, para joins con silver/gold)
    md5(tms_name || '|' || source_client || '|' || source_trip_id) AS trip_sk,
    md5(tms_name || '|' || source_client)                          AS tms_client_sk,

    -- Identidad de negocio
    tms_name,
    source_client,
    product,
    source_trip_id,

    -- Estado actual (check_col: cualquier cambio de payload dispara nueva versión)
    payload,
    payload_hash,
    file_name,
    mage_run_id,

    -- Timestamp real del TMS (unix ts embebido en el nombre de archivo de GCS)
    to_timestamp(
        regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint
    ) AT TIME ZONE 'America/Santiago'   AS file_generated_at,

    -- Período que cubre el archivo (posición 2 y 3 del nombre: YYYYMMDD)
    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',2),
        'YYYYMMDD'
    ) AS file_period_from,

    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',3),
        'YYYYMMDD'
    ) AS file_period_to,

    -- Estado extraído del payload (multi-cliente: iansa vs resto)
    CASE
        WHEN source_client = 'iansa'
            THEN payload->'trip_metadata'->>'Estado Rendicion'
            ELSE payload->'trip_metadata'->>'Estado'
    END AS trip_status,

    payload->'trip_metadata'->>'Patente'   AS patente,
    payload->'trip_metadata'->>'Conductor' AS conductor,

    -- Trazabilidad de ingesta
    first_seen_at,
    last_updated_at

FROM {{ source('bronze', 'tms_trips') }}

{% endsnapshot %}
