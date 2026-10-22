{{ config(tags=['analytics']) }}
-- Los clientes del día de cada conductor o equipo en gold son los de sus viajes de ese día en fct_trips
-- (mismo criterio que client_names de la Reportería: viajes planificados ese día). 0 filas = verde.
WITH esperado AS (
    SELECT s.fleet_day_key,
           COALESCE((
               SELECT array_agg(DISTINCT f.client_id ORDER BY f.client_id)
               FROM {{ ref('fct_trips') }} f
               WHERE f.planning_date = s.business_date AND f.client_id IS NOT NULL
                 AND ((s.subject_type = 'DRIVER' AND f.driver_id = s.subject_id)
                   OR (s.subject_type = 'ASSET' AND f.tractor_asset_id = s.subject_id))
           ), '{}') AS ids
    FROM {{ ref('fct_fleet_daily_status') }} s
)
SELECT e.fleet_day_key, e.ids AS esperado, s.client_ids AS en_gold
FROM esperado e
JOIN {{ ref('fct_fleet_daily_status') }} s USING (fleet_day_key)
WHERE e.ids IS DISTINCT FROM s.client_ids
