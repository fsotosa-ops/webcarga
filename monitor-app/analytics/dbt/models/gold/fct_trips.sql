{{
    config(
        materialized='incremental',
        unique_key='trip_id',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns'
    )
}}
/*
  fct_trips
  ──────────────────────────────────────────────────────────────────
  Fuente       : app.trips (ref trips) + app.trip_stops + app.v_trip_fleet_resolution + app.trip_fleet_links
                 + bridge_fleet_membership + dim_carrier + firmas del Cierre (app.closure_signature_*)
  Granularidad : un viaje de app.trips, incluidos los anulados (con su marca). Accumulating snapshot: una
                 columna por hito, que se completa a medida que el viaje avanza.
  unique_key   : trip_id (el id de app.trips; su continuidad es invariante del proyecto).
  Watermark    : se reprocesan los viajes planificados en los últimos 60 días y los que cambiaron desde la
                 última corrida. Más atrás, un viaje ya está cerrado y firmado.
  Consumidor   : analytics.bdot (la sábana), reportes estándar.

  Reglas que se reusan, no se reescriben (diseño de Analítica 21/10):
    - origen, último destino y zona: app.trip_origin_local / trip_last_destination_local / trip_destination_zone
      (migración 20261101090000, las mismas del Monitor y el Cierre);
    - flota y tipo de operación con su origen: app.v_trip_fleet_resolution;
    - empresa del viaje: la del vínculo de flota; si no hay, la del tracto o del conductor EN LA FECHA del viaje
      (bridge_fleet_membership, equivalente a app.carrier_of).
  Hitos de las paradas: lo que registra Operaciones (manual) manda; después GPS; después el TMS.
  Pendiente (fct_trip_status_events): publicado y asignado, que salen de la historia de estados del TMS.
*/
WITH viajes AS (
    SELECT t.*
    FROM {{ ref('trips') }} t
    {% if is_incremental() %}
    WHERE t.planning_date >= current_date - 60
       OR t.updated_at > (SELECT max(source_updated_at) FROM {{ this }})
    {% endif %}
),

paradas AS (
    -- Solo las vigentes: los destinos que están en la lista actual del viaje (trips.stops) y los orígenes.
    SELECT
        ts.trip_id, ts.stop_type, ts.stop_order, ts.local, ts.destination_city, ts.destination_region,
        ts.planning_date AS planned_at,
        COALESCE(ts.gps_arrival_date_manual, ts.arrival_date_manual, ts.gps_arrival_date, ts.arrival_date)
            AS arrived_at,
        COALESCE(ts.gps_departure_date_manual, ts.departure_date_manual, ts.gps_departure_date, ts.departure_date)
            AS departed_at
    FROM {{ ref('trip_stops') }} ts
    JOIN viajes v ON v.id = ts.trip_id
    WHERE ts.stop_type = 'ORIGIN'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.stops) = 'array' THEN v.stops END) e
                  WHERE e->>'stop_id' = ts.stop_id)
),

hitos AS (
    SELECT
        trip_id,
        min(planned_at)  FILTER (WHERE stop_type = 'ORIGIN')      AS planned_at,
        min(departed_at) FILTER (WHERE stop_type = 'ORIGIN')      AS origin_departed_at,
        min(arrived_at)  FILTER (WHERE stop_type = 'DESTINATION') AS first_destination_arrived_at,
        count(*)         FILTER (WHERE stop_type = 'DESTINATION') AS destination_count
    FROM paradas
    GROUP BY trip_id
),

ultimo_destino AS (
    SELECT DISTINCT ON (trip_id)
        trip_id, destination_city, destination_region, arrived_at, departed_at
    FROM paradas
    WHERE stop_type = 'DESTINATION'
    ORDER BY trip_id, stop_order DESC
),

firmas AS (
    SELECT cst.trip_id, min(cs.business_date) AS signed_business_date, min(cs.signed_at) AS signed_at
    FROM {{ source('closures', 'closure_signature_trips') }} cst
    JOIN {{ source('closures', 'closure_signatures') }} cs ON cs.id = cst.signature_id
    GROUP BY cst.trip_id
),

flota AS (
    SELECT
        v.id AS trip_id,
        vfr.resolved_carrier_id, vfr.resolved_driver_id, vfr.resolved_tractor_asset_id,
        fl.trailer_asset_id, vfr.link_source,
        vfr.resolved_operation_type_id, vfr.operation_type_source, vfr.operation_type_conflict
    FROM viajes v
    LEFT JOIN {{ source('app_catalogs', 'v_trip_fleet_resolution') }} vfr ON vfr.trip_id = v.id
    LEFT JOIN {{ source('app_catalogs', 'trip_fleet_links') }} fl ON fl.trip_id = v.id
)

SELECT
    v.id                                                     AS trip_id,
    v.source_system,
    v.source_system_trip_id                                  AS trip_code,
    v.shipper_id                                             AS client_id,
    v.client_name                                            AS client_name_in_source,

    -- Fechas e hitos (marcas en UTC; los *_date son el día de Chile).
    v.planning_date,
    to_char(v.planning_date, 'YYYYMMDD')::int                AS planning_date_key,
    h.planned_at,
    h.origin_departed_at,
    h.first_destination_arrived_at,
    ud.arrived_at                                            AS last_destination_arrived_at,
    ud.departed_at                                           AS last_destination_departed_at,
    COALESCE(ud.departed_at, ud.arrived_at)                  AS delivered_at,
    (COALESCE(ud.departed_at, ud.arrived_at) AT TIME ZONE 'America/Santiago')::date AS delivered_date,
    f.signed_business_date,
    f.signed_at,
    v.voided_at,

    -- Lugares.
    app.trip_origin_local(v.id)                              AS origin_local,
    app.trip_last_destination_local(v.id)                    AS last_destination_local,
    app.trip_destination_zone(v.id)                          AS destination_zone,
    ud.destination_city                                      AS last_destination_city,
    ud.destination_region                                    AS last_destination_region,
    COALESCE(h.destination_count, 0)                         AS destination_count,

    -- Flota (la empresa, en la fecha del viaje).
    COALESCE(fx.resolved_carrier_id, mt.counterpart_id, md.counterpart_id) AS carrier_id,
    CASE
        WHEN fx.resolved_carrier_id IS NOT NULL THEN 'trip_link'
        WHEN mt.counterpart_id IS NOT NULL THEN 'tractor_membership'
        WHEN md.counterpart_id IS NOT NULL THEN 'driver_membership'
    END                                                      AS carrier_source,
    dc.carrier_version_key,
    fx.resolved_driver_id                                    AS driver_id,
    fx.resolved_tractor_asset_id                             AS tractor_asset_id,
    fx.trailer_asset_id,
    fx.link_source                                           AS fleet_link_source,
    fx.resolved_operation_type_id                            AS operation_type_id,
    fx.operation_type_source,
    COALESCE(fx.operation_type_conflict, false)              AS operation_type_conflict,

    -- Estado.
    v.trip_status                                            AS trip_status_id,
    v.is_active,
    v.is_assigned,
    v.unassigned_reason_id,
    v.void_reason_id,
    v.voided_at IS NOT NULL                                  AS is_voided,
    v.tms_missing_since,
    v.tms_absence_kind,

    v.updated_at                                             AS source_updated_at,
    now()                                                    AS loaded_at
FROM viajes v
LEFT JOIN hitos h ON h.trip_id = v.id
LEFT JOIN ultimo_destino ud ON ud.trip_id = v.id
LEFT JOIN firmas f ON f.trip_id = v.id
LEFT JOIN flota fx ON fx.trip_id = v.id
LEFT JOIN {{ ref('bridge_fleet_membership') }} mt
       ON mt.relation = 'ASSET_CARRIER' AND mt.subject_id = fx.resolved_tractor_asset_id
      AND v.planning_date >= mt.valid_from AND v.planning_date < mt.valid_to
LEFT JOIN {{ ref('bridge_fleet_membership') }} md
       ON md.relation = 'DRIVER_CARRIER' AND md.subject_id = fx.resolved_driver_id
      AND v.planning_date >= md.valid_from AND v.planning_date < md.valid_to
LEFT JOIN {{ ref('dim_carrier') }} dc
       ON dc.carrier_id = COALESCE(fx.resolved_carrier_id, mt.counterpart_id, md.counterpart_id)
      AND COALESCE(h.planned_at, v.planning_date::timestamptz) >= dc.valid_from
      AND COALESCE(h.planned_at, v.planning_date::timestamptz) < dc.valid_to
