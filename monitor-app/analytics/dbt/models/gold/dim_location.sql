/*
  dim_location
  ──────────────────────────────────────────────────────────────────
  Fuente       : public.locations (locales y CD de cada cliente)
  Granularidad : un local. SCD1.
  Consumidor   : fct_trips (CD de origen, último destino), fct_trip_stops; "region/comuna" de la BDOT.

  La zona (RM, Z0, Región) sale de la misma función de la base que usan el Monitor y el Cierre
  (app.operation_type_zone, migración 20261101090000): una sola regla.
*/
SELECT
    l.id                                    AS location_id,
    l.entity_id                             AS client_id,
    l.name                                  AS location_name,
    l.site_number,
    l.format,
    l.region_name,
    l.region_number,
    l.operation_type                        AS location_operation_type,
    app.operation_type_zone(l.operation_type) AS zone,
    COALESCE(l.is_origin, false)            AS is_origin,
    l.operational_status                    AS status
FROM {{ source('directory', 'locations') }} l
WHERE l.entity_type = 'SHIPPER'
