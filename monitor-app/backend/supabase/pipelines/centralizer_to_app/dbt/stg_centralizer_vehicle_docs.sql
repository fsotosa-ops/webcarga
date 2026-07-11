{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_vehicle_docs
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_vehicles (fila ganadora del dedupe por
                 patente, mismo criterio que stg_centralizer_vehicles).
  Granularidad : 1 fila por (plate, doc_code) — hasta 11 doc_codes por vehículo
                 (4 derivados de fecha + 6 de status + creacion_walmart_vehicle
                 condicional).
  Excepción    : creacion_gc_vehicle ("creación_en_gc") trae 'Sodimac'
                 (nombre de cliente) en datos reales — si map_doc_status no
                 mapea, NO se emite fila (y 15_rejects.sql tampoco lo reporta;
                 única excepción a la regla valor_no_mapeado).
  Membresía    : el JOIN a ref('stg_centralizer_vehicles') excluye duplicados
                 perdedores y huérfanos.
*/

WITH vehicle_ranked AS (
    SELECT
        v.*,
        UPPER(REPLACE(v.patente, ' ', '')) AS plate_norm,
        ROW_NUMBER() OVER (
            PARTITION BY UPPER(REPLACE(v.patente, ' ', ''))
            ORDER BY v.ctid
        ) AS rn
    FROM {{ source('bronze', 'raw_centralizer_vehicles') }} v
    WHERE NULLIF(TRIM(v.patente), '') IS NOT NULL
),

-- MATERIALIZED: evita re-ejecutar la cadena de vistas anidadas por fila del
-- unpivot (mismo fix que stg_centralizer_driver_docs, ver ese modelo).
winners AS MATERIALIZED (
    SELECT vr.*
    FROM vehicle_ranked vr
    JOIN {{ ref('stg_centralizer_vehicles') }} s ON s.plate = vr.plate_norm
    WHERE vr.rn = 1
),

date_docs AS (
    SELECT
        w.plate_norm AS plate,
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
        ('permiso_circulacion', silver.parse_centralizer_date(w."p__circulación")),
        ('revision_tecnica',    silver.parse_centralizer_date(w."re__técnica")),
        ('gases',               silver.parse_centralizer_date(w.gases_contaminantes)),
        ('soap',                silver.parse_centralizer_date(w."seguro__soap_"))
    ) AS m(doc_code, expiry_date)
),

status_docs AS (
    SELECT
        w.plate_norm AS plate,
        m.doc_code,
        silver.map_doc_status(m.raw_value) AS status,
        NULL::date AS expiry_date
    FROM winners w
    CROSS JOIN LATERAL (VALUES
        ('padron',                 w."padrón"),
        ('gps',                    w.gps),
        ('mantencion_camara_frio', w."mantención_cámara_frío"),
        ('resolucion_sanitaria',   w.resolucion_sanitaria),
        ('poliza_rc',              w."póliza_vehicular_con_rc"),
        ('seguro_carga',           w.seguro_de_carga)
    ) AS m(doc_code, raw_value)
),

creacion_gc AS (
    SELECT
        w.plate_norm AS plate,
        'creacion_gc_vehicle'::text AS doc_code,
        silver.map_doc_status(w."creación_en_gc") AS status,
        NULL::date AS expiry_date
    FROM winners w
    WHERE silver.map_doc_status(w."creación_en_gc") IS NOT NULL
)

SELECT plate, doc_code, status, expiry_date FROM date_docs
UNION ALL
SELECT plate, doc_code, status, expiry_date FROM status_docs
UNION ALL
SELECT plate, doc_code, status, expiry_date FROM creacion_gc
