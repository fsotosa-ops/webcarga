{{ config(tags=['analytics']) }}
-- Un día firmado en gold tiene exactamente las líneas de su última firma (diseño de Analítica 21/10).
-- Devuelve los días que no cuadran; 0 filas = verde.
WITH ultima AS (
    SELECT DISTINCT ON (business_date) id, business_date
    FROM {{ source('closures', 'closure_signatures') }}
    ORDER BY business_date, version DESC
),
esperado AS (
    SELECT u.business_date, count(*) AS n
    FROM ultima u JOIN {{ source('closures', 'closure_signature_lines') }} l ON l.signature_id = u.id
    GROUP BY u.business_date
),
en_gold AS (
    SELECT business_date, count(*) AS n
    FROM {{ ref('fct_fleet_daily_status') }}
    WHERE NOT is_provisional
    GROUP BY business_date
)
SELECT COALESCE(e.business_date, g.business_date) AS business_date, e.n AS en_la_firma, g.n AS en_gold
FROM esperado e
FULL JOIN en_gold g ON g.business_date = e.business_date
WHERE e.n IS DISTINCT FROM g.n
