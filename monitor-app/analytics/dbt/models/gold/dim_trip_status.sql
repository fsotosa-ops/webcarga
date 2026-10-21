/*
  dim_trip_status
  ──────────────────────────────────────────────────────────────────
  Fuente       : app.trip_statuses (estados que reportan los TMS, configurables)
  Granularidad : un estado.
  Consumidor   : fct_trips, fct_trip_status_events; "estado_envio" de la BDOT.
*/
SELECT
    s.id            AS trip_status_id,
    s.label,
    s.group_id      AS status_group,
    s.sort_order,
    s.active,
    COALESCE(s.counts_as_load, true) AS counts_as_load
FROM {{ source('app_catalogs', 'trip_statuses') }} s
