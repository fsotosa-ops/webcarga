{{ config(tags=['analytics']) }}
-- fct_trips tiene exactamente los viajes de app.trips (diseño de Analítica 21/10, tests mínimos).
-- Devuelve los que sobran o faltan; 0 filas = verde.
SELECT 'falta en gold' AS problema, t.id AS trip_id
FROM {{ ref('trips') }} t
LEFT JOIN {{ ref('fct_trips') }} f ON f.trip_id = t.id
WHERE f.trip_id IS NULL
UNION ALL
SELECT 'sobra en gold', f.trip_id
FROM {{ ref('fct_trips') }} f
LEFT JOIN {{ ref('trips') }} t ON t.id = f.trip_id
WHERE t.id IS NULL
