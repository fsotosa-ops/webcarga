{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_driver_docs
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_drivers (fila ganadora del dedupe por
                 rut_conductor, mismo criterio que stg_centralizer_drivers).
  Granularidad : 1 fila por (driver_rut, doc_code) — 14 doc_codes por conductor
                 (2 derivados de fecha + 12 de status).
  Status/fecha : copia_ci y licencia derivan status de la fecha de vencimiento
                 parseada ('ok' si >= hoy America/Santiago, 'actualizar' si <,
                 NULL si no parsea) y llevan expiry_date; el resto usa
                 silver.map_doc_status y expiry_date NULL.
  Membresía    : el JOIN a ref('stg_centralizer_drivers') excluye duplicados
                 perdedores y huérfanos (equivalente al DELETE del formato
                 anterior por bloques).
  Rejects      : valor_no_mapeado / fecha_invalida en 15_rejects.sql.
*/

WITH driver_ranked AS (
    SELECT
        d.*,
        app.normalize_rut(d.rut_conductor) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(d.rut_conductor)
            ORDER BY d.ctid
        ) AS rn
    FROM {{ source('bronze', 'raw_centralizer_drivers') }} d
    WHERE NULLIF(TRIM(d.rut_conductor), '') IS NOT NULL
),

-- MATERIALIZED: el ref() expande la cadena de vistas drivers→transporters→
-- info_contacto (window functions anidadas); sin materializar, el planner la
-- re-ejecuta por cada fila externa del unpivot (explosión multiplicativa,
-- >30s para ~1.100 filas — verificado con EXPLAIN el 2026-07-10).
winners AS MATERIALIZED (
    SELECT dr.*
    FROM driver_ranked dr
    JOIN {{ ref('stg_centralizer_drivers') }} s ON s.rut = dr.rut_norm
    WHERE dr.rn = 1
),

date_docs AS (
    SELECT
        w.rut_norm AS driver_rut,
        m.doc_code,
        CASE
            WHEN m.expiry_date IS NULL THEN NULL
            WHEN m.expiry_date >= (now() AT TIME ZONE 'America/Santiago')::date
                THEN 'ok'::app.compliance_status
            ELSE 'actualizar'::app.compliance_status
        END AS status,
        m.expiry_date
    FROM winners w
    CROSS JOIN LATERAL (VALUES
        ('copia_ci', silver.parse_centralizer_date(w."copia_c_i__vencimiento_")),
        ('licencia', silver.parse_centralizer_date(w."licencia__vencimiento_"))
    ) AS m(doc_code, expiry_date)
),

status_docs AS (
    SELECT
        w.rut_norm AS driver_rut,
        m.doc_code,
        silver.map_doc_status(m.raw_value) AS status,
        NULL::date AS expiry_date
    FROM winners w
    CROSS JOIN LATERAL (VALUES
        ('anexo_3_gc',                 w.anexo_gc_para_conductor),
        ('epp',                        w.epp),
        ('das_odi',                    w.das___odi),
        ('hoja_de_vida',               w.hoja_de_vida),
        ('cert_antecedentes',          w."cert__antecedentes"),
        ('validado_gc_driver',         w.validado_por_gc),
        ('contrato_trabajo',           w.contrato_de_trabajo),
        ('toma_conoc_plan_emergencia', w.toma_conoc__trab__plan_de_emergencia_del_mandante),
        ('toma_conoc_pts',             w.toma_conoc__trab__procedimiento_de_trabajo_seguro),
        ('capacitacion_epp',           w."capacitación_uso_y_mantención_de_epp"),
        ('creacion_gc_driver',         w."creación_en_gc"),
        ('f30_1',                      w.f30_1)
    ) AS m(doc_code, raw_value)
)

SELECT driver_rut, doc_code, status, expiry_date FROM date_docs
UNION ALL
SELECT driver_rut, doc_code, status, expiry_date FROM status_docs
