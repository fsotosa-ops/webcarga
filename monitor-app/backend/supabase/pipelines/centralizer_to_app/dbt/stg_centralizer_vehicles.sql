{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_vehicles
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_vehicles
  Granularidad : 1 fila por patente normalizada (upper, sin espacios).
  Dedupe       : duplicados de patente → gana la primera por orden estable
                 (ctid); las perdedoras quedan fuera.
  Huérfanos    : rut_empresa sin match en stg_centralizer_transporters →
                 excluidos (JOIN al ref()).
  Kind         : TRACTOCAMION→tracto, RAMPLA→rampla, otro→'otro' (el reject
                 valor_no_mapeado del caso 'otro' vive en 15_rejects.sql).
  Exclusiones  : bloques de cuotas RC vehicular / seguro de carga
                 (cobertura_rc, cuotas, vencimiento_cuota, estado,
                 link_de_pago_rc_vehicular, cobertura_sc, cuotas_1,
                 vencimiento_cuota_1, estado_1, link_de_pago_seguro_de_carga)
                 = REFERENCIALES; canónico: raw_insurance_vehicles.
*/

WITH vehicle_ranked AS (
    SELECT
        v.*,
        UPPER(REPLACE(v.patente, ' ', ''))  AS plate_norm,
        app.normalize_rut(v.rut_empresa)    AS rut_empresa_norm,
        CASE UPPER(TRIM(v.tipo_de_equipo))
            WHEN 'TRACTOCAMION' THEN 'tracto'
            WHEN 'RAMPLA'       THEN 'rampla'
            ELSE 'otro'
        END AS kind,
        ROW_NUMBER() OVER (
            PARTITION BY UPPER(REPLACE(v.patente, ' ', ''))
            ORDER BY v.ctid
        ) AS rn
    FROM {{ source('bronze', 'raw_centralizer_vehicles') }} v
    WHERE NULLIF(TRIM(v.patente), '') IS NOT NULL
),

-- MATERIALIZED: mismo fix que stg_centralizer_drivers (una sola expansión
-- de la vista de empresas por scan).
empresas AS MATERIALIZED (
    SELECT rut FROM {{ ref('stg_centralizer_transporters') }}
)

SELECT
    vr.plate_norm                                                 AS plate,
    vr.kind                                                       AS kind,
    vr.tipo_de_equipo                                             AS type_label,
    NULLIF(SPLIT_PART(vr."año", '.', 1), '')::int                 AS year,
    vr.rut_empresa_norm                                           AS rut_empresa,
    silver.parse_centralizer_date(vr."p__circulación")            AS circ_permit_expiry,
    silver.parse_centralizer_date(vr."re__técnica")               AS tech_inspection_expiry,
    silver.parse_centralizer_date(vr.gases_contaminantes)         AS gas_emissions_expiry,
    silver.parse_centralizer_date(vr."seguro__soap_")             AS soap_insurance_expiry
FROM vehicle_ranked vr
JOIN empresas t ON t.rut = vr.rut_empresa_norm
WHERE vr.rn = 1
