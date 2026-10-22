/*
  bdot
  ──────────────────────────────────────────────────────────────────
  Fuente       : gold.fct_trips + dimensiones de gold
  Granularidad : un viaje (la sábana de la BDOT, reconstruida desde la app).
  Consumidor   : módulo Analítica de la app (API /analytics), y más adelante la herramienta de BI.

  SIN DATOS PERSONALES: el nombre y el RUT del conductor están en analytics.bdot_people, con otro permiso.
  Presentación pura (diseño de Analítica 21/10): solo uniones y renombres. Un cálculo nuevo va en gold.
  Las marcas de hora van en UTC (timestamptz); los *_date son el día de Chile.
*/
SELECT
    f.trip_id,
    f.trip_code,
    f.source_system,
    -- Fechas
    f.planning_date,
    d.year_month                         AS planning_year_month,
    d.iso_week                           AS planning_iso_week,
    d.day_name                           AS planning_day_name,
    f.planned_at,
    f.origin_departed_at,
    f.first_destination_arrived_at,
    f.last_destination_arrived_at,
    f.delivered_at,
    f.delivered_date,
    -- Cliente
    f.client_id,
    COALESCE(c.client_name, f.client_name_in_source || ' · sin vincular') AS client_name,
    -- Empresa (la de la fecha del viaje)
    f.carrier_id,
    dc.carrier_name,
    dc.carrier_tax_id,
    f.carrier_source,
    -- Equipos
    tr.license_plate                     AS tractor_plate,
    rm.license_plate                     AS trailer_plate,
    -- Tipo de operación del viaje
    ot.label                             AS operation_type,
    f.operation_type_source,
    f.operation_type_conflict,
    -- Lugares
    f.origin_local,
    f.last_destination_local,
    f.destination_zone,
    f.last_destination_city,
    f.last_destination_region,
    f.destination_count,
    -- Estado
    f.trip_status_id,
    st.label                             AS trip_status,
    st.status_group                      AS trip_status_group,
    f.is_active,
    f.is_assigned,
    ur.label                             AS unassigned_reason,
    f.is_voided,
    f.voided_at,
    vr.label                             AS void_reason,
    f.tms_missing_since,
    f.tms_absence_kind,
    -- Cierre
    f.signed_business_date,
    f.signed_at,
    f.loaded_at
FROM {{ ref('fct_trips') }} f
LEFT JOIN {{ ref('dim_date') }} d ON d.date_key = f.planning_date_key
LEFT JOIN {{ ref('dim_client') }} c ON c.client_id = f.client_id
LEFT JOIN {{ ref('dim_carrier') }} dc ON dc.carrier_version_key = f.carrier_version_key
LEFT JOIN {{ ref('dim_asset') }} tr ON tr.asset_id = f.tractor_asset_id
LEFT JOIN {{ ref('dim_asset') }} rm ON rm.asset_id = f.trailer_asset_id
LEFT JOIN {{ ref('dim_reason') }} ot ON ot.reason_id = f.operation_type_id
LEFT JOIN {{ ref('dim_trip_status') }} st ON st.trip_status_id = f.trip_status_id
LEFT JOIN {{ ref('dim_reason') }} ur ON ur.reason_id = f.unassigned_reason_id
LEFT JOIN {{ ref('dim_reason') }} vr ON vr.reason_id = f.void_reason_id
