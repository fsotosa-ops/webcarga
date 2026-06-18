{{ config(materialized='view', schema='silver') }}

/*
  int_tms_trips_conformed
  ────────────────────────
  Capa intermedia que une los datos de viaje (stg_*_trips)
  con los datos de cumplimiento (tms_milestone_trips).

  Granularidad : 1 fila por viaje × archivo × stop
  Join key     : source_trip_id + local = stop_location_name

  Qué aporta cada fuente:
  ┌──────────────────┬───────────────────────────────────────────────────────┐
  │ stg_qanalytics   │ GPS, tiempos TR, unload, estado operacional, flota   │
  │ tms_milestone    │ origin, destination_city/region, on_time, SAP status │
  │ stg_sodimac      │ origin propio (ORIGEN del TMS), equipment_type       │
  │ stg_wingsuite    │ origin del stop Carga, departure_date_prog,          │
  │                  │ dni_driver, dni_tractor_company, trip_type            │
  └──────────────────┴───────────────────────────────────────────────────────┘

  Contrato UNION ALL — mismas columnas en el mismo orden en los 3 CTEs.
  Campos que una TMS no tiene → NULL del tipo correcto.
*/

-- ── Milestone: versión más reciente por viaje × stop ────────────────────────
WITH milestones AS (
    SELECT DISTINCT ON (source_trip_id, stop_location_name)
        source_trip_id,
        stop_location_name,
        origin_location,
        destination_city,
        destination_region_id,
        on_time_status,
        actual_arrival_datetime,
        trip_status         AS milestone_trip_status,
        carrier_name        AS milestone_carrier_name,
        is_external_fleet
    FROM {{ ref('slv_milestone_trips') }}
    ORDER BY source_trip_id, stop_location_name, updated_at DESC
),

-- ── qanalytics: enriquecido con milestone ────────────────────────────────────
qanalytics AS (
    SELECT
        -- Identidad y trazabilidad
        tr.otm_id,
        tr.status_id,
        tr.stop_id,
        tr.trip_version_id,
        tr.tms_client_id,
        tr.tms_id,
        tr.tms_name,
        tr.client_name,
        tr.source_trip_id,
        tr.snapshot_version_id,
        tr.trip_file_identity,
        tr.dbt_valid_from,
        tr.dbt_valid_to,
        tr.is_current,
        tr.file_generated_at,
        tr.file_period_from,
        tr.file_period_to,
        tr.ingestion_timestamp,

        -- Negocio
        tr.status,
        tr.control,
        tr.reference_number,
        tr.cargo_type,
        tr.transport,
        tr.local,
        tr.s2s,
        tr.temperature,

        -- Fechas operacionales (del TMS)
        tr.planning_date,
        tr.arrival_date,
        tr.departure_date,
        tr.departure_date_prog,     -- NULL en qanalytics
        tr.unload_start,
        tr.unload_end,
        tr.gps_arrival_date,
        tr.gps_departure_date,

        -- Flota (del TMS)
        tr.tractor_plate,
        tr.trailer_plate,
        tr.driver,

        -- Origin: viene del milestone (qanalytics no lo reporta en trips)
        ml.origin_location          AS origin,

        -- Cumplimiento (solo via milestone)
        ml.destination_city,
        ml.destination_region_id,
        ml.on_time_status,
        ml.actual_arrival_datetime,
        ml.milestone_trip_status,
        ml.milestone_carrier_name,
        ml.is_external_fleet,

        -- Campos exclusivos de otras TMS (NULL en qanalytics)
        NULL::varchar   AS estimated_time,
        NULL::varchar   AS dni_driver,
        NULL::varchar   AS dni_tractor_company,
        NULL::varchar   AS dni_trailer_company,
        NULL::varchar   AS trip_type,
        NULL::varchar   AS transport_company,
        NULL::varchar   AS equipment_type,

        tr.raw_file_metadata,
        tr.created_at,
        tr.updated_at

    FROM {{ ref('stg_qanalytics_trips') }} tr
    LEFT JOIN milestones ml
        ON  ml.source_trip_id     = tr.source_trip_id
        AND ml.stop_location_name = tr.local
),

-- ── sodimac: sin milestone, origin propio del TMS ────────────────────────────
sodimac AS (
    SELECT
        -- Identidad y trazabilidad
        tr.otm_id,
        tr.status_id,
        tr.stop_id,
        tr.trip_version_id,
        tr.tms_client_id,
        tr.tms_id,
        tr.tms_name,
        tr.client_name,
        tr.source_trip_id,
        tr.snapshot_version_id,
        tr.trip_file_identity,
        tr.dbt_valid_from,
        tr.dbt_valid_to,
        tr.is_current,
        tr.file_generated_at,
        tr.file_period_from,
        tr.file_period_to,
        tr.ingestion_timestamp,

        -- Negocio
        tr.status,
        tr.control,
        tr.reference_number,
        tr.cargo_type,
        tr.transport,
        tr.local,
        tr.s2s,
        tr.temperature,

        -- Fechas operacionales
        tr.planning_date,
        tr.arrival_date,
        tr.departure_date,
        tr.departure_date_prog,     -- NULL en sodimac
        tr.unload_start,
        tr.unload_end,
        tr.gps_arrival_date,
        tr.gps_departure_date,

        -- Flota
        tr.tractor_plate,
        tr.trailer_plate,
        tr.driver,

        -- Origin propio de sodimac (campo ORIGEN del TMS)
        tr.origin,

        -- Sin milestone → todo NULL
        NULL::text          AS destination_city,
        NULL::text          AS destination_region_id,
        NULL::text          AS on_time_status,
        NULL::timestamptz   AS actual_arrival_datetime,
        NULL::text          AS milestone_trip_status,
        NULL::text          AS milestone_carrier_name,
        NULL::boolean       AS is_external_fleet,

        -- Campos extendidos
        tr.estimated_time,
        NULL::varchar   AS dni_driver,
        NULL::varchar   AS dni_tractor_company,
        NULL::varchar   AS dni_trailer_company,
        NULL::varchar   AS trip_type,
        NULL::varchar   AS transport_company,
        tr.equipment_type,

        tr.raw_file_metadata,
        tr.created_at,
        tr.updated_at

    FROM {{ ref('stg_sodimac_trips') }} tr
),

-- ── wingsuite: sin milestone, origin del stop Carga ──────────────────────────
wingsuite AS (
    SELECT
        -- Identidad y trazabilidad
        tr.otm_id,
        tr.status_id,
        tr.stop_id,
        tr.trip_version_id,
        tr.tms_client_id,
        tr.tms_id,
        tr.tms_name,
        tr.client_name,
        tr.source_trip_id,
        tr.snapshot_version_id,
        tr.trip_file_identity,
        tr.dbt_valid_from,
        tr.dbt_valid_to,
        tr.is_current,
        tr.file_generated_at,
        tr.file_period_from,
        tr.file_period_to,
        tr.ingestion_timestamp,

        -- Negocio
        tr.status,
        tr.control,
        tr.reference_number,
        tr.cargo_type,
        tr.transport,
        tr.local,
        tr.s2s,
        tr.temperature,

        -- Fechas operacionales
        -- wingsuite tiene horarios completos: entrada_prog/real + salida_prog/real
        tr.planning_date,           -- horario_entrada_prog del stop Descarga
        tr.arrival_date,            -- horario_entrada_real del stop Descarga
        tr.departure_date,          -- horario_salida_real del stop Descarga
        tr.departure_date_prog,     -- horario_salida_prog del stop Descarga
        tr.unload_start,            -- NULL (wingsuite no tiene datos de descarga)
        tr.unload_end,              -- NULL
        tr.gps_arrival_date,        -- NULL (wingsuite no tiene GPS)
        tr.gps_departure_date,      -- NULL

        -- Flota
        tr.tractor_plate,
        tr.trailer_plate,
        tr.driver,

        -- Origin: nombre_geocerca del stop Carga (primer stop)
        tr.origin,

        -- Sin milestone → todo NULL
        NULL::text          AS destination_city,
        NULL::text          AS destination_region_id,
        NULL::text          AS on_time_status,
        NULL::timestamptz   AS actual_arrival_datetime,
        NULL::text          AS milestone_trip_status,
        NULL::text          AS milestone_carrier_name,
        NULL::boolean       AS is_external_fleet,

        -- Campos extendidos (wingsuite tiene RUTs completos)
        tr.estimated_time,          -- duracion_real del stop Descarga
        tr.dni_driver,              -- RUT_PERSONAL
        tr.dni_tractor_company,     -- RUT_EMPRESA_TTA
        tr.dni_trailer_company,     -- NOMBRE_DUENIO_RAMPLA
        tr.trip_type,               -- NOMBRE_PLANTILLA
        tr.transport_company,       -- EMPRESA_MANDANTE
        NULL::varchar   AS equipment_type,

        tr.raw_file_metadata,
        tr.created_at,
        tr.updated_at

    FROM {{ ref('stg_wingsuite_trips') }} tr
),

-- ── qanalytics SAP-only: trips en cumplimiento-SAP sin fila en Monitor viajes ─
-- Estos viajes cerraron antes de que el Monitor los ingiriera (o solo existen
-- en el dataset de cumplimiento). Se usan los datos de slv_milestone_trips como
-- fuente primaria y se genera un otm_id determinístico desde source_trip_id.
qanalytics_sap_only AS (
    SELECT
        -- Identidad: otm_id determinístico cuando el SAP no lo provee
        COALESCE(
            ml.otm_id,
            (
                left(md5('sap:' || ml.source_trip_id), 8) || '-' ||
                substr(md5('sap:' || ml.source_trip_id), 9, 4) || '-' ||
                substr(md5('sap:' || ml.source_trip_id), 13, 4) || '-' ||
                substr(md5('sap:' || ml.source_trip_id), 17, 4) || '-' ||
                right(md5('sap:' || ml.source_trip_id), 12)
            )::uuid
        )                                               AS otm_id,
        (
            left(ml.trip_stop_sk, 8) || '-' ||
            substr(ml.trip_stop_sk, 9, 4) || '-' ||
            substr(ml.trip_stop_sk, 13, 4) || '-' ||
            substr(ml.trip_stop_sk, 17, 4) || '-' ||
            right(ml.trip_stop_sk, 12)
        )::uuid                                         AS status_id,
        NULL::uuid                                      AS stop_id,
        NULL::uuid                                      AS trip_version_id,
        ml.tms_client_id,
        NULL::uuid                                      AS tms_id,
        ml.tms_name,
        ml.source_client                                AS client_name,
        ml.source_trip_id,
        ml.snapshot_version_id,
        NULL::text                                      AS trip_file_identity,
        ml.dbt_valid_from,
        ml.dbt_valid_to,
        (ml.dbt_valid_to IS NULL)                       AS is_current,
        ml.file_generated_at,
        ml.file_period_from,
        ml.file_period_to,
        ml.first_seen_at        AS ingestion_timestamp,

        -- El status SAP es la única fuente de verdad para estos viajes
        ml.trip_status                                  AS status,
        NULL::varchar                                   AS control,
        NULL::varchar                                   AS reference_number,
        NULL::varchar                                   AS cargo_type,
        ml.carrier_name                                 AS transport,
        ml.stop_location_name                           AS local,
        NULL::varchar                                   AS s2s,
        NULL::numeric                                   AS temperature,

        -- Fechas: planned_datetime del SAP → planning_date; actual_arrival del SAP → arrival
        ml.planned_datetime                             AS planning_date,
        ml.actual_arrival_datetime                      AS arrival_date,
        NULL::timestamptz                               AS departure_date,
        NULL::timestamptz                               AS departure_date_prog,
        NULL::timestamptz                               AS unload_start,
        NULL::timestamptz                               AS unload_end,
        NULL::timestamptz                               AS gps_arrival_date,
        NULL::timestamptz                               AS gps_departure_date,

        -- Flota
        ml.tractor_plate,
        ml.trailer_plate,
        ml.driver_name                                  AS driver,

        -- Origin: viene directo del SAP (no hay JOIN necesario)
        ml.origin_location                              AS origin,

        -- Cumplimiento (fuente principal)
        ml.destination_city,
        ml.destination_region_id,
        ml.on_time_status,
        ml.actual_arrival_datetime,
        ml.trip_status                                  AS milestone_trip_status,
        ml.carrier_name                                 AS milestone_carrier_name,
        ml.is_external_fleet,

        -- Campos exclusivos de otras TMS (NULL)
        NULL::varchar                                   AS estimated_time,
        NULL::varchar                                   AS dni_driver,
        NULL::varchar                                   AS dni_tractor_company,
        NULL::varchar                                   AS dni_trailer_company,
        NULL::varchar                                   AS trip_type,
        NULL::varchar                                   AS transport_company,
        NULL::varchar                                   AS equipment_type,

        NULL::jsonb                                     AS raw_file_metadata,
        ml.created_at::timestamptz                      AS created_at,
        ml.updated_at::timestamptz                      AS updated_at

    FROM {{ ref('slv_milestone_trips') }} ml
    WHERE ml.dbt_valid_to IS NULL
      AND ml.tms_name = 'qanalytics'
      -- Excluir trips que ya existen en el Monitor de viajes
      AND NOT EXISTS (
          SELECT 1 FROM {{ ref('stg_qanalytics_trips') }} qa
          WHERE qa.source_trip_id = ml.source_trip_id
      )
)

-- ── UNION ALL ────────────────────────────────────────────────────────────────
SELECT * FROM qanalytics
UNION ALL
SELECT * FROM sodimac
UNION ALL
SELECT * FROM wingsuite
UNION ALL
SELECT * FROM qanalytics_sap_only