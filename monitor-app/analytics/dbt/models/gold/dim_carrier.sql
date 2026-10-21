/*
  dim_carrier
  ──────────────────────────────────────────────────────────────────
  Fuente       : silver.snapshot_carriers (historia desde su primera corrida) + public.carriers
  Granularidad : una versión de una empresa (SCD2). carrier_id es la clave durable; carrier_version_key, la de
                 la versión. Un hecho elige la versión vigente en su fecha (valid_from <= fecha < valid_to).
  Consumidor   : fct_trips (empresa del viaje), fct_fleet_daily_status; columnas "eett" de la BDOT.

  Antes de la primera corrida no hay historia: la primera versión se extiende hacia atrás hasta -infinity y
  queda con history_known = false (diseño de Analítica 21/10: no se inventa historia).
  El RUT de una empresa es dato del negocio (la BDOT lo trae); el de una persona natural también se ve aquí.
*/
WITH versiones AS (
    SELECT
        id, business_name, tax_id, operational_status, status_reason_id,
        dbt_valid_from, dbt_valid_to,
        row_number() OVER (PARTITION BY id ORDER BY dbt_valid_from) AS n
    FROM {{ ref('snapshot_carriers') }}
)
SELECT
    md5(v.id::text || '|' || v.dbt_valid_from::text)                    AS carrier_version_key,
    v.id                                                                AS carrier_id,
    v.business_name                                                     AS carrier_name,
    v.tax_id                                                            AS carrier_tax_id,
    v.operational_status                                                AS lifecycle_status,
    -- Mismas etiquetas que el glosario (schemas/states.py, lib/states.ts).
    CASE v.operational_status
        WHEN 'ACTIVE' THEN 'Activa'
        WHEN 'ONBOARDING' THEN 'En onboarding'
        WHEN 'INACTIVE' THEN 'Dada de baja'
    END                                                                 AS lifecycle_label,
    r.label                                                             AS status_reason,
    CASE WHEN v.n = 1 THEN '-infinity'::timestamptz ELSE v.dbt_valid_from END AS valid_from,
    COALESCE(v.dbt_valid_to, 'infinity'::timestamptz)                   AS valid_to,
    v.dbt_valid_to IS NULL                                              AS is_current,
    v.n > 1                                                             AS history_known
FROM versiones v
LEFT JOIN {{ source('app_catalogs', 'status_taxonomies') }} r ON r.id = v.status_reason_id
