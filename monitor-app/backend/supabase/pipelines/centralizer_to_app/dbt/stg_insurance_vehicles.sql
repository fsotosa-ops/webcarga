{{ config(materialized='view', schema='silver') }}

/*
  stg_insurance_vehicles
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_insurance_vehicles (canónico de pólizas/cuotas —
                 decisión del plan; los bloques de seguro del centralizer son
                 referenciales).
  Granularidad : 1 fila por cuota (grano nativo de bronze).
  Filtros      : filas sin "póliza" o sin "cuota__número_" numérico quedan
                 fuera (se re-detectan como reject en 15_rejects.sql).
  Fechas       : silver.parse_insurance_date (D/M/YYYY confirmado en datos,
                 sin heurística de ambigüedad — 00_gate.sql).
  Estado cuota : PAGADA/PAGADO/PAGO → 'pagada'; si no y due_date < hoy
                 (America/Santiago) → 'vencida'; si no → 'pendiente'.
*/

WITH insurance_norm AS (
    SELECT
        iv.*,
        app.normalize_rut(iv.rut)                              AS rut_norm,
        NULLIF(TRIM(iv."póliza"), '')                          AS policy_number_clean,
        NULLIF(SPLIT_PART(iv."cuota__número_", ' de ', 1), '') AS installment_number_raw,
        NULLIF(SPLIT_PART(iv."cuota__número_", ' de ', 2), '') AS total_installments_raw
    FROM {{ source('bronze', 'raw_insurance_vehicles') }} iv
)

SELECT
    rut_norm                                                       AS rut_norm,
    NULLIF(TRIM(contratante), '')                                  AS contractor_name,
    NULLIF(TRIM(grupo), '')                                        AS client_group,
    NULLIF(TRIM("compañía"), '')                                   AS company,
    policy_number_clean                                            AS policy_number,
    NULLIF(TRIM(endoso::text), '')::numeric::int::text             AS endorsement,
    silver.parse_insurance_date(vigencia__desde_)                  AS valid_from,
    silver.parse_insurance_date(vigencia__hasta_)                  AS valid_to,
    NULLIF(TRIM(cobertura), '')                                    AS coverage,
    UPPER(SUBSTRING(cobertura FROM 'Patente:\s*([A-Za-z0-9]+)'))   AS plate,
    CASE
        WHEN cobertura ILIKE 'Patente:%' OR cobertura ILIKE '%VEHIC%' THEN 'rc_vehicular'
        WHEN cobertura ILIKE '%carga%'                                THEN 'carga'
        ELSE 'otro'
    END                                                            AS policy_type,
    installment_number_raw::int                                    AS installment_number,
    NULLIF(total_installments_raw, '')::int                        AS total_installments,
    NULLIF(TRIM(valor_cuota_uf::text), '')::numeric                AS amount_uf,
    silver.parse_insurance_date(vencimiento)                       AS due_date,
    CASE
        WHEN UPPER(TRIM(estado)) IN ('PAGADA', 'PAGADO', 'PAGO') THEN 'pagada'::app.installment_status
        WHEN silver.parse_insurance_date(vencimiento) < (now() AT TIME ZONE 'America/Santiago')::date
            THEN 'vencida'::app.installment_status
        ELSE 'pendiente'::app.installment_status
    END                                                            AS status
FROM insurance_norm
WHERE policy_number_clean IS NOT NULL
  AND installment_number_raw IS NOT NULL
  AND installment_number_raw ~ '^\d+$'
