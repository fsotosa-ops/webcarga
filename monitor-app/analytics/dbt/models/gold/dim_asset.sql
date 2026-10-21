/*
  dim_asset
  ──────────────────────────────────────────────────────────────────
  Fuente       : public.assets + public.asset_types + catálogos (app.status_taxonomies)
  Granularidad : un equipo (tracto o rampla). SCD1.
  Consumidor   : fct_trips (tracto y rampla del viaje), fct_fleet_daily_status; "patente_camion/_rampla".

  Tipo de equipo y tracto/no tracto por código del catálogo (public.asset_types), nunca por etiqueta.
  El tipo de operación del equipo es el registrado hoy; el del VIAJE vive en el hecho (puede venir del cliente o
  declararse), así que este dato no decide nada histórico.
*/
SELECT
    a.id                            AS asset_id,
    a.license_plate                 AS license_plate,
    a.asset_type                    AS asset_type_code,
    at.label                        AS asset_type,
    COALESCE(at.is_power_unit, false) AS is_power_unit,
    a.manufacture_year,
    wot.code                        AS operation_type_code,
    wot.label                       AS operation_type,
    fst.label                       AS fleet_service_type,
    a.operational_status            AS lifecycle_status,
    a.created_at
FROM {{ source('directory', 'assets') }} a
LEFT JOIN {{ source('directory', 'asset_types') }} at ON at.code = a.asset_type
LEFT JOIN {{ source('app_catalogs', 'status_taxonomies') }} wot ON wot.id = a.webcarga_operation_type_id
LEFT JOIN {{ source('app_catalogs', 'status_taxonomies') }} fst ON fst.id = a.fleet_service_type_id
