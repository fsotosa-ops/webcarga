-- ==============================================================================
-- PIPELINE: centralizer_to_app — local_apply_views.sql
--
-- HELPER SOLO PARA VALIDACIÓN LOCAL DEL ORQUESTADOR. En producción las
-- vistas silver.stg_* las materializa dbt dentro de Mage Pro (modelos en
-- dbt/, con source()/ref()); este archivo NO se porta a Mage ni a dbt.
--
-- Contiene los 7 modelos como CREATE OR REPLACE VIEW con los nombres de
-- tabla reales en vez de {{ source(...) }} / {{ ref(...) }}, en orden de
-- dependencias. El SELECT de cada vista debe mantenerse IDÉNTICO al del
-- modelo dbt correspondiente — si editas uno, edita el otro.
--
-- Requiere 00_gate.sql ejecutado antes (funciones silver.parse_* /
-- silver.map_doc_status). El primer bloque DO limpia restos del formato
-- anterior (tablas físicas silver.stg_* creadas por los antiguos bloques
-- 10-13), porque CREATE OR REPLACE VIEW falla si existe una TABLA homónima.
-- ==============================================================================

DO $$
DECLARE
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'stg_centralizer_transporter_docs',
    'stg_centralizer_driver_docs',
    'stg_centralizer_vehicle_docs',
    'stg_centralizer_drivers',
    'stg_centralizer_vehicles',
    'stg_centralizer_transporters',
    'stg_insurance_vehicles'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'silver' AND c.relname = v_name AND c.relkind = 'r'
    ) THEN
      EXECUTE format('DROP TABLE silver.%I CASCADE', v_name);
    END IF;
  END LOOP;
END $$;

-- ── 1. silver.stg_centralizer_transporters ───────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_transporters AS
WITH transporter_ranked AS (
    SELECT
        t.*,
        app.normalize_rut(t.rut) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(t.rut)
            ORDER BY (t.gc = 'Walmart') DESC, t.ctid
        ) AS rn
    FROM bronze.raw_centralizer_transporter t
    WHERE NULLIF(TRIM(t.rut), '') IS NOT NULL
),
transporter_clients AS (
    SELECT
        app.normalize_rut(rut) AS rut_norm,
        ARRAY_AGG(DISTINCT gc) FILTER (WHERE NULLIF(TRIM(gc), '') IS NOT NULL) AS clients
    FROM bronze.raw_centralizer_transporter
    WHERE NULLIF(TRIM(rut), '') IS NOT NULL
    GROUP BY app.normalize_rut(rut)
),
info_contacto_ranked AS (
    SELECT
        ic.*,
        app.normalize_rut(ic.rut) AS rut_norm,
        ROW_NUMBER() OVER (PARTITION BY app.normalize_rut(ic.rut) ORDER BY ic.ctid) AS rn
    FROM bronze.raw_info_contacto ic
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
WHERE w.rn = 1;

-- ── 2. silver.stg_centralizer_transporter_docs ───────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_transporter_docs AS
WITH transporter_ranked AS (
    SELECT
        t.*,
        app.normalize_rut(t.rut) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(t.rut)
            ORDER BY (t.gc = 'Walmart') DESC, t.ctid
        ) AS rn
    FROM bronze.raw_centralizer_transporter t
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
      FROM silver.stg_centralizer_transporters s
      WHERE s.rut = w.rut_norm
  );

-- ── 3. silver.stg_centralizer_drivers ────────────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_drivers AS
WITH driver_ranked AS (
    SELECT
        d.*,
        app.normalize_rut(d.rut_conductor) AS rut_norm,
        app.normalize_rut(d.rut_empresa)   AS rut_empresa_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(d.rut_conductor)
            ORDER BY d.ctid
        ) AS rn
    FROM bronze.raw_centralizer_drivers d
    WHERE NULLIF(TRIM(d.rut_conductor), '') IS NOT NULL
),
empresas AS MATERIALIZED (
    SELECT rut FROM silver.stg_centralizer_transporters
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
WHERE dr.rn = 1;

-- ── 4. silver.stg_centralizer_driver_docs ────────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_driver_docs AS
WITH driver_ranked AS (
    SELECT
        d.*,
        app.normalize_rut(d.rut_conductor) AS rut_norm,
        ROW_NUMBER() OVER (
            PARTITION BY app.normalize_rut(d.rut_conductor)
            ORDER BY d.ctid
        ) AS rn
    FROM bronze.raw_centralizer_drivers d
    WHERE NULLIF(TRIM(d.rut_conductor), '') IS NOT NULL
),
winners AS MATERIALIZED (
    SELECT dr.*
    FROM driver_ranked dr
    JOIN silver.stg_centralizer_drivers s ON s.rut = dr.rut_norm
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
        ('anexo_3_walmart',            w.anexo_gc_para_conductor),
        ('epp',                        w.epp),
        ('das_odi',                    w.das___odi),
        ('hoja_de_vida',               w.hoja_de_vida),
        ('cert_antecedentes',          w."cert__antecedentes"),
        ('validado_walmart',           w.validado_por_gc),
        ('contrato_trabajo',           w.contrato_de_trabajo),
        ('toma_conoc_plan_emergencia', w.toma_conoc__trab__plan_de_emergencia_del_mandante),
        ('toma_conoc_pts',             w.toma_conoc__trab__procedimiento_de_trabajo_seguro),
        ('capacitacion_epp',           w."capacitación_uso_y_mantención_de_epp"),
        ('creacion_walmart_driver',    w."creación_en_gc"),
        ('f30_1',                      w.f30_1)
    ) AS m(doc_code, raw_value)
)
SELECT driver_rut, doc_code, status, expiry_date FROM date_docs
UNION ALL
SELECT driver_rut, doc_code, status, expiry_date FROM status_docs;

-- ── 5. silver.stg_centralizer_vehicles ───────────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_vehicles AS
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
    FROM bronze.raw_centralizer_vehicles v
    WHERE NULLIF(TRIM(v.patente), '') IS NOT NULL
),
empresas AS MATERIALIZED (
    SELECT rut FROM silver.stg_centralizer_transporters
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
WHERE vr.rn = 1;

-- ── 6. silver.stg_centralizer_vehicle_docs ───────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_centralizer_vehicle_docs AS
WITH vehicle_ranked AS (
    SELECT
        v.*,
        UPPER(REPLACE(v.patente, ' ', '')) AS plate_norm,
        ROW_NUMBER() OVER (
            PARTITION BY UPPER(REPLACE(v.patente, ' ', ''))
            ORDER BY v.ctid
        ) AS rn
    FROM bronze.raw_centralizer_vehicles v
    WHERE NULLIF(TRIM(v.patente), '') IS NOT NULL
),
winners AS MATERIALIZED (
    SELECT vr.*
    FROM vehicle_ranked vr
    JOIN silver.stg_centralizer_vehicles s ON s.plate = vr.plate_norm
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
creacion_walmart AS (
    SELECT
        w.plate_norm AS plate,
        'creacion_walmart_vehicle'::text AS doc_code,
        silver.map_doc_status(w."creación_en_gc") AS status,
        NULL::date AS expiry_date
    FROM winners w
    WHERE silver.map_doc_status(w."creación_en_gc") IS NOT NULL
)
SELECT plate, doc_code, status, expiry_date FROM date_docs
UNION ALL
SELECT plate, doc_code, status, expiry_date FROM status_docs
UNION ALL
SELECT plate, doc_code, status, expiry_date FROM creacion_walmart;

-- ── 7. silver.stg_insurance_vehicles ─────────────────────────────────────────
CREATE OR REPLACE VIEW silver.stg_insurance_vehicles AS
WITH insurance_norm AS (
    SELECT
        iv.*,
        app.normalize_rut(iv.rut)                              AS rut_norm,
        NULLIF(TRIM(iv."póliza"), '')                          AS policy_number_clean,
        NULLIF(SPLIT_PART(iv."cuota__número_", ' de ', 1), '') AS installment_number_raw,
        NULLIF(SPLIT_PART(iv."cuota__número_", ' de ', 2), '') AS total_installments_raw
    FROM bronze.raw_insurance_vehicles iv
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
  AND installment_number_raw ~ '^\d+$';
