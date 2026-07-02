{{ config(materialized='view', schema='silver') }}

/*
  int_tms_trips_conformed (delgada)
  ──────────────────────────────────────────────────────────────────
  UNION ALL de 4 modelos pares, todos con el mismo contrato de
  columnas (grano por viaje, trip_stops jsonb): stg_qanalytics_trips,
  stg_sodimac_trips, stg_wingsuite_trips (~95%/~/~5% del volumen
  operativo) y stg_qanalytics_sap_only_trips (viajes visibles solo en
  cumplimiento SAP — ver ese modelo, mismo patrón estructural
  trips_metadata + stops_timeline que las demás stg_*).

  stg_wingsuite_trips expone menos columnas que las otras 3 (no tiene
  join a milestones, es la única fuente sin ese dato) — se completan
  aquí con NULL del tipo correcto. Esto es alineación de contrato para
  el UNION ALL, no extracción/agregación cruda (esa vive en cada stg_*,
  todas congeladas).

  Único trabajo propio de esta capa además del UNION: homologar
  vocabulario de estado entre fuentes (trip_status_normalized) — único
  lugar donde debe vivir esa lógica (antes duplicada entre el
  gold.v_diario_trips muerto y el borrador viejo de app_trips.sql).
  trip_status ya prioriza SAP sobre el estado crudo del Monitor cuando
  existe milestone (COALESCE hecho dentro de stg_qanalytics_trips /
  stg_sodimac_trips) — aquí solo se homologa el vocabulario propio de
  wingsuite/sodimac (Ejecucion/Terminado/Finalizada/Publicada/
  Presentada/Rechazada en andén/Carga rechazada) al estándar.

  Validado contra la base real (2026-07-02): 1917 filas, trip_id único
  globalmente, sodimac 283/323 y wingsuite 12/12 filas normalizadas
  (qanalytics no tiene reglas propias, pasa trip_status sin cambios).
*/

WITH qanalytics AS (
    SELECT * FROM {{ ref('stg_qanalytics_trips') }}
),

sodimac AS (
    SELECT * FROM {{ ref('stg_sodimac_trips') }}
),

-- wingsuite no tiene join a milestones ni metadatos SCD2 extendidos: se
-- completa con NULL del tipo correcto lo que esa fuente no reporta.
-- trip_stops de wingsuite mezcla paradas PICKUP (origen, "Carga") y
-- DELIVERY (destino, "Descarga") en el mismo array — a diferencia de
-- qanalytics/sodimac, donde trip_stops SIEMPRE es solo destinos. Se
-- filtra aquí a solo DELIVERY para igualar el contrato semántico:
-- "stops" representa destinos/entregas, el origen ya está capturado
-- por separado en origin_location_name. Verificado contra la base
-- real: las 12 filas de wingsuite tenían exactamente 1 parada PICKUP
-- cada una mezclada con las de entrega.
wingsuite AS (
    SELECT
        trip_id,
        NULL::uuid                AS status_sk,
        NULL::uuid                AS trip_version_id,
        source_client_id,
        NULL::uuid                AS source_system_id,
        source_system, client_name, source_system_trip_id,
        NULL::varchar             AS tms_internal_trip_id,
        trip_reference_number, trip_status, cargo_type, trip_type,
        origin_location_name, planned_departure_at, actual_departure_at,
        shipper_name, shipper_tax_id, carrier_name, carrier_tax_id,
        driver_document_id,
        NULL::varchar             AS driver_first_name,
        NULL::varchar             AS driver_last_name,
        driver_name,
        vehicle_plate,
        NULL::varchar             AS vehicle_internal_id,
        NULL::varchar             AS vehicle_owner_name,
        trailer_plate,
        NULL::varchar             AS trailer_internal_id,
        NULL::varchar             AS trailer_owner_name,
        (
            SELECT jsonb_agg(elem ORDER BY elem->>'planned_arrival_at')
            FROM jsonb_array_elements(w.trip_stops) AS elem
            WHERE elem->>'action_type' = 'DELIVERY'
        )                          AS trip_stops,
        NULL::varchar             AS custom_dt,
        NULL::varchar             AS custom_num,
        NULL::varchar             AS custom_trip_appointments,
        NULL::varchar             AS custom_external_status,
        NULL::varchar             AS custom_gps_status,
        NULL::boolean             AS custom_is_external_fleet,
        NULL::varchar             AS custom_control,
        NULL::text                AS snapshot_version_id,
        NULL::text                AS trip_file_identity,
        NULL::timestamp           AS dbt_valid_from,
        NULL::timestamp           AS dbt_valid_to,
        is_current,
        NULL::timestamp           AS file_generated_at,
        NULL::date                AS file_period_from,
        NULL::date                AS file_period_to,
        NULL::timestamptz         AS ingestion_timestamp,
        raw_file_metadata, created_at, updated_at
    FROM {{ ref('stg_wingsuite_trips') }} w
),

qanalytics_sap_only AS (
    SELECT * FROM {{ ref('stg_qanalytics_sap_only_trips') }}
),

unioned AS (
    SELECT * FROM qanalytics
    UNION ALL
    SELECT * FROM sodimac
    UNION ALL
    SELECT * FROM wingsuite
    UNION ALL
    SELECT * FROM qanalytics_sap_only
)

SELECT
    u.*,
    CASE
        WHEN u.source_system = 'wingsuite' AND u.trip_status = 'Ejecucion'          THEN 'RUTA'
        WHEN u.source_system = 'wingsuite' AND u.trip_status = 'Terminado'          THEN 'CERRADO FINALIZADO'
        WHEN u.source_system = 'sodimac'   AND u.trip_status = 'Finalizada'         THEN 'CERRADO FINALIZADO'
        WHEN u.source_system = 'sodimac'   AND u.trip_status = 'Publicada'          THEN 'ASIGNADO'
        WHEN u.source_system = 'sodimac'   AND u.trip_status = 'Presentada'         THEN 'ASIGNADO'
        WHEN u.source_system = 'sodimac'   AND u.trip_status = 'Rechazada en andén' THEN 'CANCELADO'
        WHEN u.source_system = 'sodimac'   AND u.trip_status = 'Carga rechazada'    THEN 'CANCELADO'
        ELSE u.trip_status
    END                                              AS trip_status_normalized
FROM unioned u
