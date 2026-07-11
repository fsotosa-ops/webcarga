{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_transporter_contacts
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_info_contacto (cruce por rut, misma fila ganadora
                 que stg_centralizer_transporters usa para rep_legal).
  Granularidad : 1 fila por (rut, role) — role IN ('operacional','finanzas','documentos').
  Alcance      : rep_legal NO se unpivota acá — se queda single-sourced en
                 stg_centralizer_transporters (es un atributo de identidad de
                 la empresa, no un contacto rotativo como los otros 3 roles).
  Rejects      : no aplica (no hay validación de formato en estos campos).
*/

WITH info_contacto_ranked AS (
    SELECT
        ic.*,
        app.normalize_rut(ic.rut) AS rut_norm,
        ROW_NUMBER() OVER (PARTITION BY app.normalize_rut(ic.rut) ORDER BY ic.ctid) AS rn
    FROM {{ source('bronze', 'raw_info_contacto') }} ic
    WHERE NULLIF(TRIM(ic.rut), '') IS NOT NULL
)

SELECT
    w.rut_norm AS rut,
    m.role,
    m.name,
    m.phone,
    m.email
FROM info_contacto_ranked w
CROSS JOIN LATERAL (VALUES
    ('operacional', NULLIF(TRIM(w.contacto_operacional), ''), NULLIF(TRIM(w."tel__contacto_ops"), ''), NULLIF(TRIM(w.correo_contacto_operacional), '')),
    ('finanzas',    NULLIF(TRIM(w.contacto_finanzas), ''),    NULLIF(TRIM(w.tel_finanzas), ''),         NULLIF(TRIM(w.correo_finanzas), '')),
    ('documentos',  NULLIF(TRIM(w.contacto_documentos), ''),  NULLIF(TRIM(w.telefono_documentos), ''),  NULLIF(TRIM(w.correo_documentos), ''))
) AS m(role, name, phone, email)
WHERE w.rn = 1
  AND (m.name IS NOT NULL OR m.phone IS NOT NULL OR m.email IS NOT NULL)
  AND EXISTS (
      SELECT 1
      FROM {{ ref('stg_centralizer_transporters') }} s
      WHERE s.rut = w.rut_norm
  )
