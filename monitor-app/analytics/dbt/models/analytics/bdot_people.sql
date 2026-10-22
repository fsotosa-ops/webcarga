{{ config(grants={'select': ['analytics_personal_reader']}) }}
/*
  bdot_people
  ──────────────────────────────────────────────────────────────────
  Fuente       : gold.fct_trips + gold.dim_driver
  Granularidad : un viaje con su conductor.
  Consumidor   : solo con permiso de datos personales (rol analytics_personal_reader; en la app,
                 analytics.export_personal_data). Se une a analytics.bdot por trip_id.

  DATOS PERSONALES: nombre y RUT del conductor. Es la única vista de analytics que los tiene.
*/
SELECT
    f.trip_id,
    f.driver_id,
    dr.driver_name,
    dr.driver_tax_id
FROM {{ ref('fct_trips') }} f
LEFT JOIN {{ ref('dim_driver') }} dr ON dr.driver_id = f.driver_id
