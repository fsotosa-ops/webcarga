{{
    config(
        materialized='incremental',
        unique_key='id',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns',
        schema='app',
        alias='trips'
    )
}}

/*
  app_trips → app.trips
  ──────────────────────
  Granularidad : 1 fila por viaje (stops compactados en JSONB)
  Fuente       : silver.int_tms_trips_conformed (is_current = true)

  REGLAS CRÍTICAS DEL MERGE:
    - El pipeline SOLO escribe campos del bloque PIPELINE (inmutables)
    - Los campos OPERACIONALES (activo, trabajando, estado_manual, etc.)
      se inicializan en NULL/false en INSERT nuevos
    - En UPDATE, el trigger protect_manual_edits preserva los campos
      que están en manually_edited_fields
    - El pipeline NUNCA toca: fleet_link_id, manually_edited_fields,
      edited_by, edited_at, observaciones, comentarios

  WATERMARK:
    - Usa status_reported_at (file_generated_at del TMS)
    - No usa dbt_valid_from (timestamp técnico del pipeline, no de negocio)
*/

WITH base AS (
    SELECT *
    FROM {{ ref('int_tms_trips_conformed') }}
    WHERE is_current = true
),

aggregated AS (
    SELECT
        -- ── Identidad ────────────────────────────────────────────────────────
        otm_id                                          AS id,
        source_trip_id,
        tms_id,
        tms_client_id,
        tms_name,
        client_name,

        -- ── Estado del viaje ─────────────────────────────────────────────────
        -- milestone_trip_status (SAP) tiene prioridad cuando indica cierre/cancelación.
        -- En qanalytics el Monitor viajes no actualiza el status cuando SAP cierra el viaje:
        -- el camión sigue apareciendo como RETORNANDO aunque SAP ya lo cerró.
        -- Wingsuite y Sodimac usan vocabulario propio → se normaliza al estándar aquí.
        CASE
            WHEN MAX(milestone_trip_status) LIKE 'CERRADO%'
              OR MAX(milestone_trip_status) = 'CANCELADO'
            THEN MAX(milestone_trip_status)
            -- Wingsuite
            WHEN tms_name = 'wingsuite' AND MAX(status) = 'Ejecucion'         THEN 'RUTA'
            WHEN tms_name = 'wingsuite' AND MAX(status) = 'Terminado'         THEN 'CERRADO FINALIZADO'
            -- Sodimac
            WHEN tms_name = 'sodimac'   AND MAX(status) = 'Finalizada'        THEN 'CERRADO FINALIZADO'
            WHEN tms_name = 'sodimac'   AND MAX(status) = 'Publicada'         THEN 'ASIGNADO'
            WHEN tms_name = 'sodimac'   AND MAX(status) = 'Presentada'        THEN 'ASIGNADO'
            WHEN tms_name = 'sodimac'   AND MAX(status) = 'Rechazada en andén' THEN 'CANCELADO'
            WHEN tms_name = 'sodimac'   AND MAX(status) = 'Carga rechazada'   THEN 'CANCELADO'
            ELSE MAX(status)
        END                                             AS current_status_tms,
        MAX(milestone_trip_status)                      AS milestone_status_sap,
        MAX(cargo_type)                                 AS cargo_type,
        planning_date::date                             AS planning_date,
        MAX(origin)                                     AS origin,

        -- ── Timestamps de negocio ────────────────────────────────────────────
        -- status_reported_at = cuándo la TMS tomó la foto (file_generated_at)
        MAX(file_generated_at)                          AS status_reported_at,
        -- pipeline_updated_at = cuándo dbt procesó el cambio (dbt_valid_from)
        MAX(dbt_valid_from)                             AS pipeline_updated_at,

        -- ── Bloque de flota tal como lo reportó el TMS (inmutable) ───────────
        jsonb_build_object(
            'driver_name_tms',       MAX(driver),
            'driver_rut_tms',        MAX(dni_driver),
            'transporter_name_tms',  MAX(transport),
            'tractor_plate',         MAX(tractor_plate),
            'trailer_plate',         MAX(trailer_plate)
        )                                               AS fleet,

        -- ── Stops compactados ordenados cronológicamente ─────────────────────
        jsonb_agg(
            jsonb_build_object(
                -- Identidad del stop
                'stop_id',              stop_id,
                'local',                local,
                'destination_city',     destination_city,
                'destination_region',   destination_region_id,

                -- Cumplimiento
                'on_time_status',       on_time_status,
                -- Status SAP por stop: CERRADO FINALIZADO, CANCELADO, EN LOCAL, etc.
                -- NULL cuando el stop no tiene dato en silver.tms_milestone_trips
                'milestone_status',     milestone_trip_status,
                's2s',                  s2s,
                'temperature',          temperature,

                -- T1: planificación
                'planning_date',        planning_date,

                -- T2: eventos reales del TMS (inmutables)
                'arrival_date',         arrival_date,
                'departure_date',       departure_date,
                'gps_arrival_date',     gps_arrival_date,
                'gps_departure_date',   gps_departure_date,
                'unload_start',         unload_start,
                'unload_end',           unload_end
            )
            ORDER BY planning_date ASC NULLS LAST, stop_id
        )                                               AS stops

    FROM base
    GROUP BY
        otm_id, source_trip_id, tms_id, tms_client_id,
        tms_name, client_name, planning_date::date
)

SELECT
    -- ── Identidad ────────────────────────────────────────────────────────────
    id,
    source_trip_id,
    tms_id,
    tms_client_id,
    tms_name,
    client_name,

    -- ── Estado (pipeline, inmutable) ─────────────────────────────────────────
    current_status_tms,
    milestone_status_sap,
    cargo_type,
    planning_date,
    origin,
    status_reported_at,
    pipeline_updated_at,

    -- ── Flota TMS (pipeline, inmutable) ──────────────────────────────────────
    fleet,

    -- ── Stops (pipeline, inmutable) ──────────────────────────────────────────
    stops,

    -- ── Campos operacionales ─────────────────────────────────────────────────
    -- En INSERT nuevos: valores por defecto
    -- En UPDATE: el trigger protect_manual_edits los preserva
    -- si están en manually_edited_fields
    false               AS activo,
    false               AS trabajando,
    false               AS asignado,
    false               AS primera_vuelta,
    NULL::varchar       AS estado_manual,
    NULL::text          AS observaciones,
    NULL::text          AS comentarios,

    -- ── Control de edición ───────────────────────────────────────────────────
    -- El pipeline NUNCA modifica estos en UPDATE (los maneja el trigger)
    ARRAY[]::text[]     AS manually_edited_fields,
    NULL::uuid          AS fleet_link_id,
    NULL::uuid          AS edited_by,
    NULL::timestamptz   AS edited_at,

    now()               AS created_at,
    now()               AS updated_at

FROM aggregated

{% if is_incremental() %}
-- Watermark por tms_name: cada TMS tiene su propio watermark independiente.
-- Sin esto, qanalytics (que corre más frecuente) sube el watermark global
-- y deja fuera los trips de wingsuite/sodimac con fechas más antiguas.
WHERE status_reported_at > (
    SELECT COALESCE(MAX(status_reported_at), '1900-01-01')
    FROM {{ this }}
    WHERE tms_name = aggregated.tms_name
)
-- OR 1: qanalytics sin origin → cumplimiento-SAP llegó después del watermark
OR (
    tms_name = 'qanalytics'
    AND origin IS NOT NULL
    AND id IN (SELECT id FROM {{ this }} WHERE tms_name = 'qanalytics' AND origin IS NULL)
)
-- OR 2: qanalytics con status SAP CERRADO/CANCELADO que aún no se actualizó en app.trips
OR (
    tms_name = 'qanalytics'
    AND (milestone_status_sap LIKE 'CERRADO%' OR milestone_status_sap = 'CANCELADO')
    AND id IN (
        SELECT id FROM {{ this }}
        WHERE tms_name = 'qanalytics'
          AND current_status_tms NOT LIKE 'CERRADO%'
          AND current_status_tms != 'CANCELADO'
    )
)
{% endif %}