/*
  dim_client
  ──────────────────────────────────────────────────────────────────
  Fuente       : public.shippers (Directorio › Clientes)
  Granularidad : un cliente. SCD1: el nombre vigente (renombrar un cliente no cambia su historia de viajes).
  Consumidor   : fct_trips, fct_trip_stops; columna "gc" de la BDOT.
*/
SELECT
    s.id                                         AS client_id,
    s.name                                       AS client_name,
    s.status                                     AS client_status,
    s.operation_types                            AS operation_types,
    -- El tipo de un viaje sale del cliente cuando trabaja con uno solo (regla de v_trip_fleet_resolution).
    cardinality(s.operation_types) = 1           AS has_single_operation_type,
    s.created_at
FROM {{ source('directory', 'shippers') }} s
