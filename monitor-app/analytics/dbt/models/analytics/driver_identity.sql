{{ config(grants={'select': ['analytics_personal_reader']}) }}
/*
  driver_identity
  ──────────────────────────────────────────────────────────────────
  Fuente       : gold.dim_driver
  Granularidad : un conductor.
  Consumidor   : solo con permiso de datos personales (rol analytics_personal_reader; en la app,
                 analytics.personal_data). Se une por driver_id a analytics.bdot y a analytics.fleet_daily.

  DATOS PERSONALES: nombre y RUT del conductor. Es la única tabla de analytics que los tiene (reemplaza a
  bdot_people, 22/10: una sola tabla sirve a Viajes y a Flota por día).
*/
SELECT
    d.driver_id,
    d.driver_name,
    d.driver_tax_id
FROM {{ ref('dim_driver') }} d
