{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_transporter_docs
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_transporter (fila ganadora del dedupe
                 por rut, mismo criterio que stg_centralizer_transporters:
                 Walmart primero, orden estable por ctid).
  Granularidad : 1 fila por (rut, doc_code) — 14 doc_codes por rut.
  Funciones    : silver.map_doc_status (creada por 00_gate.sql, que corre
                 antes en el DAG de Mage).
  Nota         : el ranking de dedupe se re-declara acá (los modelos dbt no
                 comparten tablas temp) — mismo predicado que el modelo de
                 transporters; el semi-join a ref() garantiza que solo salen
                 docs de ruts presentes en el stg final.
  Rejects      : valor_no_mapeado se re-detecta en 15_rejects.sql.
*/

WITH transporter_ranked AS (
    SELECT
        t.*,
        app.normalize_rut(t.rut) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(t.rut)
            ORDER BY (t.gc = 'Walmart') DESC, t.ctid
        ) AS rn
    FROM {{ source('bronze', 'raw_centralizer_transporter') }} t
    WHERE NULLIF(TRIM(t.rut), '') IS NOT NULL
)

SELECT
    w.rut_norm                        AS rut,
    m.doc_code,
    silver.map_doc_status(m.raw_value) AS status
FROM transporter_ranked w
CROSS JOIN LATERAL (VALUES
    ('rol_sii',            w.rol_sii),
    ('copia_ci_rep_legal', w.copia_c_i_rep__legal),
    ('anexo_2_walmart',    w.anexo_repleg__gc_),
    ('validado_gc',        w.validado_por_gc),
    ('contrato_webcarga',  w.contrato_webcarga),
    ('f30_multas',         w.f30__multas_),
    ('f43',                w.f43),
    ('politica_seguridad', w."política_de_seguridad"),
    ('cert_mutual',        w."cert__afiliación_mutual"),
    ('riohs_timbrado',     w.riohs_timbrado),
    ('carpeta_tributaria', w.carpeta_tributaria),
    ('cuenta_empresa',     w.cuenta_banco_empresa),
    ('pts_contratista',    w.procedimiento_de_trabajo_seguro_del_contratista),
    ('creacion_walmart',   w."creación__en_gc")
) AS m(doc_code, raw_value)
WHERE w.rn = 1
  AND EXISTS (
      SELECT 1
      FROM {{ ref('stg_centralizer_transporters') }} s
      WHERE s.rut = w.rut_norm
  )
