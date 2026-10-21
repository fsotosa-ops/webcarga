/*
  fct_fleet_daily_status
  ──────────────────────────────────────────────────────────────────
  Fuente       : firmas del Cierre (app.closure_signatures + closure_signature_lines) y, para los días sin firma,
                 las líneas vivas (app.closure_lines). Empresa del día: bridge_fleet_membership.
  Granularidad : un sujeto (conductor o equipo) en un día de negocio. Periodic snapshot.
  Consumidor   : reporte de estatus histórico, asistencia y utilización, F30-1 (empresa × conductores × mes).

  Un día firmado sale de la ÚLTIMA versión de su firma, que es inmutable: no cambia en la analítica aunque el día
  se reabra (mismo criterio que "no reabrir un día firmado para corregir"). Un día nunca firmado sale de las líneas
  vivas y queda con is_provisional = true.
  La categoría es la misma regla del Cierre: app.closure_line_category (migración 20261102090000).
  Se reconstruye entera en cada corrida: son ~10.000 filas y así no hay desfase con una firma nueva.
*/
WITH ultima_firma AS (
    SELECT DISTINCT ON (business_date) id AS signature_id, business_date, version, signed_at
    FROM {{ source('closures', 'closure_signatures') }}
    ORDER BY business_date, version DESC
),

firmadas AS (
    SELECT f.business_date, l.subject_type, l.subject_id, l.status, l.reason_id, l.home_location_id,
           l.reason_from_driver_id, f.signature_id, f.version AS signature_version, f.signed_at,
           false AS is_provisional
    FROM ultima_firma f
    JOIN {{ source('closures', 'closure_signature_lines') }} l ON l.signature_id = f.signature_id
),

vivas AS (
    SELECT l.business_date, l.subject_type, l.subject_id, l.status, l.reason_id, l.home_location_id,
           l.reason_from_driver_id, NULL::bigint AS signature_id, NULL::int AS signature_version,
           NULL::timestamptz AS signed_at, true AS is_provisional
    FROM {{ source('closures', 'closure_lines') }} l
    WHERE NOT EXISTS (SELECT 1 FROM ultima_firma f WHERE f.business_date = l.business_date)
),

lineas AS (
    SELECT * FROM firmadas
    UNION ALL
    SELECT * FROM vivas
)

SELECT
    md5(l.business_date::text || '|' || l.subject_type || '|' || l.subject_id::text) AS fleet_day_key,
    l.business_date,
    to_char(l.business_date, 'YYYYMMDD')::int                AS date_key,
    l.subject_type,
    l.subject_id,
    CASE WHEN l.subject_type = 'DRIVER' THEN l.subject_id END AS driver_id,
    CASE WHEN l.subject_type = 'ASSET' THEN l.subject_id END  AS asset_id,
    m.counterpart_id                                          AS carrier_id,
    l.status,
    app.closure_line_category(l.status, l.reason_id)          AS category,
    l.reason_id,
    l.reason_from_driver_id,
    l.home_location_id,
    l.is_provisional,
    l.signature_id,
    l.signature_version,
    l.signed_at
FROM lineas l
LEFT JOIN {{ ref('bridge_fleet_membership') }} m
       ON m.relation = CASE l.subject_type WHEN 'DRIVER' THEN 'DRIVER_CARRIER' ELSE 'ASSET_CARRIER' END
      AND m.subject_id = l.subject_id
      AND l.business_date >= m.valid_from AND l.business_date < m.valid_to
