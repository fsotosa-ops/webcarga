{{ config(materialized='view', schema='silver') }}

/*
  stg_centralizer_transporters
  ────────────────────────────────────────────────────────
  Fuente       : bronze.raw_centralizer_transporter (+ cruce bronze.raw_info_contacto)
  Granularidad : 1 fila por rut normalizado.
  Dedupe       : gana la fila gc='Walmart' primero (orden estable por ctid);
                 clients = array de todas las GC vistas para ese rut.
  Funciones    : app.normalize_rut / app.rut_dv (migración 20260709100001).
  Exclusiones  : bloque de seguro EETT del centralizer (seguro_eett__rc__en_uf,
                 cobertura_rc, cuotas, vencimiento_cuota, estado) = REFERENCIAL,
                 canónico de seguros: raw_insurance_vehicles (stg_insurance_vehicles).
  Rejects      : NO se escriben acá (dbt es declarativo) — 15_rejects.sql
                 re-detecta rut_dv_invalido después de correr los modelos.
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
),

transporter_clients AS (
    SELECT
        app.normalize_rut(rut) AS rut_norm,
        ARRAY_AGG(DISTINCT gc) FILTER (WHERE NULLIF(TRIM(gc), '') IS NOT NULL) AS clients
    FROM {{ source('bronze', 'raw_centralizer_transporter') }}
    WHERE NULLIF(TRIM(rut), '') IS NOT NULL
    GROUP BY app.normalize_rut(rut)
),

info_contacto_ranked AS (
    SELECT
        ic.*,
        app.normalize_rut(ic.rut) AS rut_norm,
        ROW_NUMBER() OVER (PARTITION BY app.normalize_rut(ic.rut) ORDER BY ic.ctid) AS rn
    FROM {{ source('bronze', 'raw_info_contacto') }} ic
    WHERE NULLIF(TRIM(ic.rut), '') IS NOT NULL
)

SELECT
    w.rut_norm                                                                AS rut,
    UPPER(TRIM(w.dv))                                                         AS dv,
    (app.rut_dv(w.rut_norm) = UPPER(TRIM(w.dv)))                              AS rut_dv_valid,
    w."nombre___razón_social"                                                 AS business_name,
    COALESCE(ca.clients, '{}')                                                AS clients,
    NULLIF(NULLIF(TRIM(REPLACE(w.avance_80_20, '%', '')), ''), '-')::numeric  AS avance_80_20,
    NULLIF(NULLIF(TRIM(REPLACE(w.avance_total, '%', '')), ''), '-')::numeric  AS avance_total,
    w.link_de_sharepoint                                                      AS sharepoint_url,
    w.link_de_pago                                                            AS payment_url,
    (ic.rut_norm IS NOT NULL)                                                 AS in_admin,
    NULLIF(TRIM(ic.id_interno_admin::text), '')::numeric::int                 AS admin_internal_id,
    NULLIF(TRIM(ic.id_cuenta_eett::text), '')::numeric::int                   AS admin_account_id,
    NULLIF(TRIM(ic.representante_legal), '')                                  AS rep_legal_name,
    NULLIF(TRIM(ic."teléfono_rl"), '')                                        AS rep_legal_phone,
    NULLIF(TRIM(ic.correo_rl), '')                                            AS rep_legal_email,
    NULLIF(TRIM(ic.contacto_operacional), '')                                 AS operacional_name,
    NULLIF(TRIM(ic."tel__contacto_ops"), '')                                  AS operacional_phone,
    NULLIF(TRIM(ic.correo_contacto_operacional), '')                          AS operacional_email,
    NULLIF(TRIM(ic.contacto_finanzas), '')                                    AS finanzas_name,
    NULLIF(TRIM(ic.tel_finanzas), '')                                         AS finanzas_phone,
    NULLIF(TRIM(ic.correo_finanzas), '')                                      AS finanzas_email,
    NULLIF(TRIM(ic.contacto_documentos), '')                                  AS documentos_name,
    NULLIF(TRIM(ic.telefono_documentos), '')                                  AS documentos_phone,
    NULLIF(TRIM(ic.correo_documentos), '')                                    AS documentos_email
FROM transporter_ranked w
LEFT JOIN transporter_clients ca ON ca.rut_norm = w.rut_norm
LEFT JOIN info_contacto_ranked ic ON ic.rut_norm = w.rut_norm AND ic.rn = 1
WHERE w.rn = 1
