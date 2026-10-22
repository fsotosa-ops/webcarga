/*
  fleet_daily
  ──────────────────────────────────────────────────────────────────
  Fuente       : gold.fct_fleet_daily_status + dimensiones de gold
  Granularidad : un conductor o equipo por día de negocio (lo que dice el Cierre de ese día).
  Consumidor   : asistencia, utilización y reporte de estatus histórico en el módulo Analítica.

  SIN DATOS PERSONALES: identifica al conductor por su id; el nombre está en dim_driver, no aquí.
  Los días firmados salen de su firma (is_provisional = false); los demás, de las líneas vivas.
  Solo las líneas que cuentan en el reporte del Cierre (in_report), las mismas que muestra la Reportería.
*/
SELECT
    s.fleet_day_key,
    s.business_date,
    d.year_month,
    d.iso_week,
    d.day_name,
    s.subject_type,
    s.driver_id,
    s.asset_id,
    a.license_plate,
    a.operation_type                     AS asset_operation_type,
    s.carrier_id,
    dc.carrier_name,
    s.status,
    s.category,
    r.label                              AS reason,
    r.group_id                           AS reason_group,
    hl.location_name                     AS home_origin,
    COALESCE((SELECT array_agg(c.client_name ORDER BY c.client_name)
              FROM {{ ref('dim_client') }} c WHERE c.client_id = ANY(s.client_ids)), '{}') AS client_names,
    s.is_provisional,
    s.signed_at
FROM {{ ref('fct_fleet_daily_status') }} s
LEFT JOIN {{ ref('dim_date') }} d ON d.date_key = s.date_key
LEFT JOIN {{ ref('dim_asset') }} a ON a.asset_id = s.asset_id
LEFT JOIN {{ ref('dim_carrier') }} dc
       ON dc.carrier_id = s.carrier_id
      AND s.business_date::timestamptz >= dc.valid_from AND s.business_date::timestamptz < dc.valid_to
LEFT JOIN {{ ref('dim_reason') }} r ON r.reason_id = s.reason_id
LEFT JOIN {{ ref('dim_location') }} hl ON hl.location_id = s.home_location_id
WHERE s.in_report
