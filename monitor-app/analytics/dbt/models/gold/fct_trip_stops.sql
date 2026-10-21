{{
    config(
        materialized='incremental',
        unique_key='stop_id',
        incremental_strategy='merge',
        on_schema_change='sync_all_columns'
    )
}}
/*
  fct_trip_stops
  ──────────────────────────────────────────────────────────────────
  Fuente       : app.trip_stops (ref trip_stops) + app.trips (ref trips)
  Granularidad : una parada VIGENTE de un viaje: los destinos de la lista actual del viaje (app.trips.stops) y
                 sus orígenes (Sodimac tiene varios, todos reales). Las demás filas de trip_stops son versiones
                 viejas (el TMS cambió de base): son historia, viven en bronze.tms_trips_snapshot y no entran.
  unique_key   : stop_id. Si una parada deja de estar vigente, la siguiente corrida la marca is_current = false.
  Watermark    : viajes planificados en los últimos 60 días o cambiados desde la última corrida (igual que fct_trips).
  Consumidor   : entregas 1..n de la BDOT (región y comuna por destino), puntualidad por parada.
  Hitos: lo que registra Operaciones (manual) manda; después GPS; después el TMS.
*/
WITH viajes AS (
    SELECT t.id, t.shipper_id, t.planning_date, t.stops, t.updated_at
    FROM {{ ref('trips') }} t
    {% if is_incremental() %}
    WHERE t.planning_date >= current_date - 60
       OR t.updated_at > (SELECT max(source_updated_at) FROM {{ this }})
    {% endif %}
)
SELECT
    ts.stop_id,
    ts.trip_id,
    v.shipper_id                                            AS client_id,
    v.planning_date,
    ts.stop_type,
    ts.stop_order,
    -- Posición en la lista vigente (1 = primer destino); NULL para los orígenes.
    vig.n::int                                              AS destination_number,
    ts.local,
    app.location_operation_type(v.shipper_id, ts.local)     AS location_operation_type,
    app.operation_type_zone(app.location_operation_type(v.shipper_id, ts.local)) AS zone,
    ts.destination_city                                     AS city,
    ts.destination_region                                   AS region,
    ts.planning_date                                        AS planned_at,
    COALESCE(ts.gps_arrival_date_manual, ts.arrival_date_manual, ts.gps_arrival_date, ts.arrival_date)
                                                            AS arrived_at,
    COALESCE(ts.gps_departure_date_manual, ts.departure_date_manual, ts.gps_departure_date, ts.departure_date)
                                                            AS departed_at,
    CASE
        WHEN ts.gps_arrival_date_manual IS NOT NULL OR ts.arrival_date_manual IS NOT NULL THEN 'manual'
        WHEN ts.gps_arrival_date IS NOT NULL THEN 'gps'
        WHEN ts.arrival_date IS NOT NULL THEN 'tms'
    END                                                     AS arrival_source,
    ts.on_time_status,
    ts.is_manual_stop,
    (ts.stop_type = 'ORIGIN' OR vig.n IS NOT NULL)          AS is_current,
    v.updated_at                                            AS source_updated_at,
    now()                                                   AS loaded_at
FROM {{ ref('trip_stops') }} ts
JOIN viajes v ON v.id = ts.trip_id
LEFT JOIN LATERAL (
    SELECT e.n
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v.stops) = 'array' THEN v.stops END) WITH ORDINALITY AS e(value, n)
    WHERE e.value->>'stop_id' = ts.stop_id
    LIMIT 1
) vig ON true
