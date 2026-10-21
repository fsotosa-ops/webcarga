/*
  dim_driver
  ──────────────────────────────────────────────────────────────────
  Fuente       : public.drivers (Directorio › Conductores)
  Granularidad : un conductor. SCD1.
  Consumidor   : fct_trips, fct_fleet_daily_status.

  DATOS PERSONALES: nombre y RUT viven SOLO en esta dimensión. La presentación (analytics) no los expone salvo en
  la vista con permiso (analytics.bdot_people). El origen habitual de un día está congelado en el hecho diario
  (closure_lines.home_location_id), por eso aquí basta el vigente.
*/
SELECT
    d.id                    AS driver_id,
    d.full_name             AS driver_name,
    d.tax_id                AS driver_tax_id,
    d.operational_status    AS lifecycle_status,
    d.home_location_id      AS home_location_id,
    d.created_at
FROM {{ source('directory', 'drivers') }} d
