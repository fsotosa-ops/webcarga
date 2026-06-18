{{ config(materialized='view', schema='silver') }}

/*
  stg_wingsuite_trips
  ────────────────────
  Fuente       : bronze.raw_tms_trips_snapshot (WHERE tms_name='wingsuite')
  Granularidad : 1 fila por viaje × archivo × stop Descarga

  Estructura de stops wingsuite (siempre 2):
    accion='Carga'    → origen del viaje (CD Tambores, PILU-UHT, etc.)
                        se extrae como campo origin, NO se expande como fila
    accion='Descarga' → destino del viaje (CD San Bernardo, etc.)
                        se expande como fila con todos sus horarios

  Mapeo de horarios del stop Descarga:
    horario_entrada_prog → planning_date     cuándo se planificó llegar
    horario_entrada_real → arrival_date      cuándo llegó realmente
    horario_salida_prog  → departure_date_prog  cuándo se planificó salir
    horario_salida_real  → departure_date    cuándo salió realmente
    duracion_real        → estimated_time    duración real en el stop (HH:MM:SS)
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
    WHERE tms_name = 'wingsuite'
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

        -- ✦ Origen: nombre_geocerca del stop Carga
        (
            SELECT s->>'nombre_geocerca'
            FROM jsonb_array_elements(snap.payload->'stops') s
            WHERE s->>'accion' = 'Carga'
            LIMIT 1
        )                                               AS raw_origin,

        -- Horarios del stop Carga (para trazabilidad en raw_file_metadata)
        (
            SELECT s->>'horario_salida_real'
            FROM jsonb_array_elements(snap.payload->'stops') s
            WHERE s->>'accion' = 'Carga'
            LIMIT 1
        )                                               AS raw_carga_salida_real,

        (
            SELECT s->>'horario_salida_prog'
            FROM jsonb_array_elements(snap.payload->'stops') s
            WHERE s->>'accion' = 'Carga'
            LIMIT 1
        )                                               AS raw_carga_salida_prog,

        -- ✦ Stop Descarga: todos los campos de horario
        parada->>'nombre_geocerca'                      AS raw_local,
        parada->>'accion'                               AS raw_accion,
        parada->>'id_accion'                            AS raw_id_accion,

        -- T1: planificación de llegada al destino
        parada->>'horario_entrada_prog'                 AS raw_planning_date,

        -- T2: llegada real al destino
        parada->>'horario_entrada_real'                 AS raw_arrival,

        -- T2: salida planificada del destino
        parada->>'horario_salida_prog'                  AS raw_departure_prog,

        -- T2: salida real del destino
        parada->>'horario_salida_real'                  AS raw_departure,

        -- Duración real en el stop (formato HH:MM:SS como string)
        parada->>'duracion_real'                        AS raw_duracion,

        parada->>'citas'                                AS raw_citas

    FROM snapshot_ranked snap,
         LATERAL jsonb_array_elements(snap.payload->'stops') AS parada
    -- Solo stops Descarga — Carga es el origen, no una parada de entrega
    WHERE parada->>'accion' = 'Descarga'
)

SELECT
    -- ── IDs ──────────────────────────────────────────────────────────────────
    trip_sk::uuid                                                               AS otm_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(payload->'trip_metadata'->>'ESTADO_VIAJE', ''))::uuid AS status_id,
    md5(tms_name || '|' || source_client || '|' || source_trip_id
        || '|' || COALESCE(raw_local, ''))::uuid                                AS stop_id,
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
    payload->'trip_metadata'->>'ESTADO_VIAJE'                                   AS status,
    NULL::varchar                                                               AS control,
    {{ clean_string("payload->'trip_metadata'->>'CODIGO_VIAJE'") }}             AS reference_number,
    {{ clean_string("payload->'trip_metadata'->>'TIPO_CARGA'") }}               AS cargo_type,
    {{ clean_string("payload->'trip_metadata'->>'NOMBRE_EMPRESA_TTA'") }}       AS transport,
    {{ clean_string("raw_local") }}                                             AS local,
    NULL::varchar                                                               AS s2s,
    NULL::numeric                                                               AS temperature,

    -- ── Fechas del stop Descarga (todos los horarios) ─────────────────────────
    -- T1: planificación de llegada
    {{ parse_date_tms("raw_planning_date",   'wingsuite') }}                    AS planning_date,

    -- T2: llegada real al destino
    {{ parse_date_tms("raw_arrival",         'wingsuite') }}                    AS arrival_date,

    -- T2: salida real del destino
    {{ parse_date_tms("raw_departure",       'wingsuite') }}                    AS departure_date,

    -- T2: salida planificada (dato extra de wingsuite, sin equivalente en otras TMS)
    {{ parse_date_tms("raw_departure_prog",  'wingsuite') }}                    AS departure_date_prog,

    -- wingsuite no tiene GPS ni datos de descarga separados
    NULL::timestamptz                                                           AS unload_start,
    NULL::timestamptz                                                           AS unload_end,
    NULL::timestamptz                                                           AS gps_arrival_date,
    NULL::timestamptz                                                           AS gps_departure_date,

    {{ clean_string("payload->'trip_metadata'->>'PATENTE_TRACTO'") }}           AS tractor_plate,
    {{ clean_string("payload->'trip_metadata'->>'PATENTE_RAMPLA'") }}           AS trailer_plate,
    {{ clean_string("COALESCE(payload->'trip_metadata'->>'NOMBRE_PERSONAL','') || ' ' || COALESCE(payload->'trip_metadata'->>'APELLIDO_PERSONAL','')") }} AS driver,

    -- ── Campos extendidos ────────────────────────────────────────────────────
    -- ✦ origin = CD de origen (stop Carga)
    {{ clean_string("raw_origin") }}                                            AS origin,

    -- Duración real en el stop como string HH:MM:SS
    -- duracion_real puede venir como '::' cuando no está disponible → se limpia
    NULLIF(TRIM(raw_duracion), '::')                                            AS estimated_time,

    {{ clean_string("payload->'trip_metadata'->>'RUT_PERSONAL'") }}             AS dni_driver,
    {{ clean_string("payload->'trip_metadata'->>'RUT_EMPRESA_TTA'") }}          AS dni_tractor_company,
    {{ clean_string("payload->'trip_metadata'->>'NOMBRE_DUENIO_RAMPLA'") }}     AS dni_trailer_company,
    {{ clean_string("payload->'trip_metadata'->>'NOMBRE_PLANTILLA'") }}         AS trip_type,
    {{ clean_string("payload->'trip_metadata'->>'EMPRESA_MANDANTE'") }}         AS transport_company,
    NULL::varchar                                                               AS equipment_type,
    NULL::varchar                                                               AS destination_city,
    NULL::varchar                                                               AS destination_region_id,
    NULL::varchar                                                               AS on_time_status,

    -- ── Auditoría ────────────────────────────────────────────────────────────
    jsonb_build_object(
        'file_name',            file_name,
        'snapshot_version',     snapshot_version_id,
        'file_generated_at',    file_generated_at,
        'ingestion_timestamp',  ingestion_timestamp,
        'accion_parada',        raw_accion,
        'id_accion',            raw_id_accion,
        'carga_salida_real',    raw_carga_salida_real,
        'carga_salida_prog',    raw_carga_salida_prog,
        'departure_prog',       raw_departure_prog,
        'citas',                raw_citas
    )                                                                           AS raw_file_metadata,

    file_generated_at   AS created_at,
    CURRENT_TIMESTAMP   AS updated_at

FROM raw_flattened