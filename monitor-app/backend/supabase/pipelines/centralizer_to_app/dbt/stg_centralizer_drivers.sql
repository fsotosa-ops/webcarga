{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_drivers
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_drivers
  Granularidad : 1 fila por rut_conductor normalizado.
  Dedupe       : si el mismo conductor aparece en 2+ filas (±empresa), gana la
                 primera por orden estable (ctid); las perdedoras quedan fuera.
  Huérfanos    : rut_empresa sin match en stg_centralizer_transporters →
                 excluidos (el JOIN al ref() los filtra).
  Funciones    : silver.parse_centralizer_date (00_gate.sql), app.normalize_rut,
                 app.rut_dv.
  Nota `gc`    : la columna gc (Iansa/Walmart) es nombre de cliente, NO doc —
                 se ignora. El doc_code gc_driver del catálogo queda sin fuente
                 (brecha conocida, ver README).
  Rejects      : duplicado / huerfano / rut_dv_invalido / fecha_invalida se
                 re-detectan en 15_rejects.sql.
*/

WITH driver_ranked AS (
    SELECT
        d.*,
        app.normalize_rut(d.rut_conductor) AS rut_norm,
        app.normalize_rut(d.rut_empresa)   AS rut_empresa_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(d.rut_conductor)
            ORDER BY d.ctid
        ) AS rn
    FROM {{ source('bronze', 'raw_centralizer_drivers') }} d
    WHERE NULLIF(TRIM(d.rut_conductor), '') IS NOT NULL
),

-- MATERIALIZED: computa la vista de empresas una sola vez por scan en lugar
-- de re-expandirla (window + cruce info_contacto) por cada conductor.
empresas AS MATERIALIZED (
    SELECT rut FROM {{ ref('stg_centralizer_transporters') }}
)

SELECT
    dr.rut_norm                                                                 AS rut,
    UPPER(TRIM(dr.dv_conductor))                                                AS dv_conductor,
    (app.rut_dv(dr.rut_norm) = UPPER(TRIM(dr.dv_conductor)))                    AS rut_dv_valid,
    dr.nombre_completo                                                          AS full_name,
    dr.rut_empresa_norm                                                         AS rut_empresa,
    silver.parse_centralizer_date(dr."copia_c_i__vencimiento_")                 AS id_expiry,
    silver.parse_centralizer_date(dr."licencia__vencimiento_")                  AS license_expiry,
    NULLIF(NULLIF(TRIM(REPLACE(dr.avance_total, '%', '')), ''), '-')::numeric   AS avance_total
FROM driver_ranked dr
JOIN empresas t ON t.rut = dr.rut_empresa_norm
WHERE dr.rn = 1
