-- Task 6b: repuntar dependencias remanentes descubiertas por Task 7 (bloqueo real)
--
-- Contexto: al investigar el DROP CASCADE de Task 7, se encontró (vía pg_depend, no
-- solo pg_constraint) que:
--   (a) v_driver_eligibility / v_vehicle_eligibility todavía leen "quién es el
--       transportista actual" desde app.driver_assignments / app.vehicle_assignments
--       (tablas de historial de asignación) en vez de la columna transporter_id que
--       Task 2 agregó directo a app.drivers / app.vehicles para este propósito exacto.
--       Task 4 solo repunteó la fuente de ESTADO de documentos, no esta dependencia.
--   (b) app.v_sync_divergence (vista de reconciliación app.* vs pipeline externo,
--       congelado desde Task 6) lee app.compliance_documents directo — esa tabla se
--       dropea en Task 7.
--   (c) app.notifications tiene una FK real hacia app.entities — esa tabla también se
--       dropea en Task 7.
--
-- app.compliance_doc_catalog NO se toca: sigue siendo la fuente de metadata de
-- documentos requeridos para las 3 vistas de elegibilidad/cumplimiento, se mantiene
-- permanentemente (decisión de esta sesión, ver task-6b-brief.md).

-- =====================================================================================
-- Step 1: repuntar v_driver_eligibility / v_vehicle_eligibility a transporter_id directo
-- =====================================================================================
-- Único cambio respecto a la definición vigente (creada en 20260712130004): la CTE
-- active_assignment pasa de leer app.driver_assignments/app.vehicle_assignments
-- (WHERE valid_to IS NULL) a leer app.drivers.transporter_id/app.vehicles.transporter_id
-- directo. Resto de la fórmula (umbral, seguro, baja_override, blocking_reasons,
-- join con compliance_doc_catalog) queda exactamente igual.

CREATE OR REPLACE VIEW app.v_driver_eligibility AS
WITH threshold AS (
    SELECT COALESCE(
        (SELECT alert_thresholds.warning_days FROM app.alert_thresholds
         WHERE alert_thresholds.doc_type = 'compliance_min_pct'),
        90
    )::numeric AS min_pct
), active_assignment AS (
    SELECT d.id AS driver_id, d.transporter_id
    FROM app.drivers d
    WHERE d.transporter_id IS NOT NULL
), required_docs AS (
    SELECT DISTINCT d_1.id AS driver_id, r.doc_code
    FROM app.drivers d_1
    JOIN active_assignment aa_1 ON aa_1.driver_id = d_1.id
    JOIN app.transporter_client_accounts tca
        ON tca.transporter_id = aa_1.transporter_id AND tca.is_active_for_client
    JOIN app.client_document_requirements r
        ON r.client_name = tca.client_name AND r.required
    JOIN app.compliance_doc_catalog c
        ON c.doc_code = r.doc_code AND c.entity_type = 'driver'
), doc_status AS (
    SELECT rd.driver_id, rd.doc_code, dd.status
    FROM required_docs rd
    LEFT JOIN app.driver_documents dd
        ON dd.driver_id = rd.driver_id AND dd.doc_name = rd.doc_code
), counted AS (
    SELECT doc_status.driver_id,
        count(*) FILTER (WHERE doc_status.status IS DISTINCT FROM 'n_a'::app.compliance_status) AS required_docs,
        count(*) FILTER (WHERE doc_status.status = 'ok'::app.compliance_status) AS ok_docs
    FROM doc_status
    GROUP BY doc_status.driver_id
), insurance_status AS (
    SELECT aa_1.driver_id,
        bool_or(
            ii.status = 'vencida'::app.installment_status
            OR (ii.status = 'pendiente'::app.installment_status
                AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)
        ) AS has_overdue
    FROM active_assignment aa_1
    JOIN app.insurance_policies ip ON ip.transporter_id = aa_1.transporter_id
    JOIN app.insurance_installments ii ON ii.policy_id = ip.id
    GROUP BY aa_1.driver_id
), compliance AS (
    SELECT d_1.id AS driver_id,
        round(100.0 * COALESCE(c.ok_docs, 0::bigint)::numeric
              / NULLIF(COALESCE(c.required_docs, 0::bigint), 0)::numeric, 2) AS compliance_pct
    FROM app.drivers d_1
    LEFT JOIN counted c ON c.driver_id = d_1.id
)
SELECT
    d.id AS driver_id,
    d.rut,
    d.full_name,
    aa.transporter_id,
    cp.compliance_pct,
    th.min_pct AS compliance_threshold,
    NOT COALESCE(ist.has_overdue, false) AS insurance_ok,
    COALESCE(cp.compliance_pct, 0::numeric) >= th.min_pct
        AND NOT COALESCE(ist.has_overdue, false)
        AND aa.transporter_id IS NOT NULL
        AND NOT d.baja_override AS eligible,
    array_remove(ARRAY[
        CASE WHEN COALESCE(cp.compliance_pct, 0::numeric) < th.min_pct THEN 'docs_below_threshold' ELSE NULL END,
        CASE WHEN COALESCE(ist.has_overdue, false) THEN 'insurance_overdue' ELSE NULL END,
        CASE WHEN aa.transporter_id IS NULL THEN 'no_active_transporter' ELSE NULL END,
        CASE WHEN d.baja_override THEN 'baja_override' ELSE NULL END
    ], NULL::text) AS blocking_reasons
FROM app.drivers d
CROSS JOIN threshold th
LEFT JOIN active_assignment aa ON aa.driver_id = d.id
LEFT JOIN compliance cp ON cp.driver_id = d.id
LEFT JOIN insurance_status ist ON ist.driver_id = d.id;

CREATE OR REPLACE VIEW app.v_vehicle_eligibility AS
WITH threshold AS (
    SELECT COALESCE(
        (SELECT alert_thresholds.warning_days FROM app.alert_thresholds
         WHERE alert_thresholds.doc_type = 'compliance_min_pct'),
        90
    )::numeric AS min_pct
), active_assignment AS (
    SELECT v.id AS vehicle_id, v.transporter_id
    FROM app.vehicles v
    WHERE v.transporter_id IS NOT NULL
), required_docs AS (
    SELECT DISTINCT v_1.id AS vehicle_id, r.doc_code
    FROM app.vehicles v_1
    JOIN active_assignment aa_1 ON aa_1.vehicle_id = v_1.id
    JOIN app.transporter_client_accounts tca
        ON tca.transporter_id = aa_1.transporter_id AND tca.is_active_for_client
    JOIN app.client_document_requirements r
        ON r.client_name = tca.client_name AND r.required
    JOIN app.compliance_doc_catalog c
        ON c.doc_code = r.doc_code AND c.entity_type = 'vehicle'
), doc_status AS (
    SELECT rd.vehicle_id, rd.doc_code, vd.status
    FROM required_docs rd
    LEFT JOIN app.vehicle_documents vd
        ON vd.vehicle_id = rd.vehicle_id AND vd.doc_name = rd.doc_code
), counted AS (
    SELECT doc_status.vehicle_id,
        count(*) FILTER (WHERE doc_status.status IS DISTINCT FROM 'n_a'::app.compliance_status) AS required_docs,
        count(*) FILTER (WHERE doc_status.status = 'ok'::app.compliance_status) AS ok_docs
    FROM doc_status
    GROUP BY doc_status.vehicle_id
), insurance_status AS (
    SELECT v_1.id AS vehicle_id,
        bool_or(
            ii.status = 'vencida'::app.installment_status
            OR (ii.status = 'pendiente'::app.installment_status
                AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)
        ) AS has_overdue
    FROM app.vehicles v_1
    LEFT JOIN active_assignment aa_1 ON aa_1.vehicle_id = v_1.id
    JOIN app.insurance_policies ip ON ip.plate = v_1.plate OR ip.transporter_id = aa_1.transporter_id
    JOIN app.insurance_installments ii ON ii.policy_id = ip.id
    GROUP BY v_1.id
), compliance AS (
    SELECT v_1.id AS vehicle_id,
        round(100.0 * COALESCE(c.ok_docs, 0::bigint)::numeric
              / NULLIF(COALESCE(c.required_docs, 0::bigint), 0)::numeric, 2) AS compliance_pct
    FROM app.vehicles v_1
    LEFT JOIN counted c ON c.vehicle_id = v_1.id
)
SELECT
    v.id AS vehicle_id,
    v.plate,
    v.kind,
    aa.transporter_id,
    cp.compliance_pct,
    th.min_pct AS compliance_threshold,
    NOT COALESCE(ist.has_overdue, false) AS insurance_ok,
    COALESCE(cp.compliance_pct, 0::numeric) >= th.min_pct
        AND NOT COALESCE(ist.has_overdue, false)
        AND aa.transporter_id IS NOT NULL
        AND NOT v.baja_override AS eligible,
    array_remove(ARRAY[
        CASE WHEN COALESCE(cp.compliance_pct, 0::numeric) < th.min_pct THEN 'docs_below_threshold' ELSE NULL END,
        CASE WHEN COALESCE(ist.has_overdue, false) THEN 'insurance_overdue' ELSE NULL END,
        CASE WHEN aa.transporter_id IS NULL THEN 'no_active_transporter' ELSE NULL END,
        CASE WHEN v.baja_override THEN 'baja_override' ELSE NULL END
    ], NULL::text) AS blocking_reasons
FROM app.vehicles v
CROSS JOIN threshold th
LEFT JOIN active_assignment aa ON aa.vehicle_id = v.id
LEFT JOIN compliance cp ON cp.vehicle_id = v.id
LEFT JOIN insurance_status ist ON ist.vehicle_id = v.id;

-- =====================================================================================
-- Step 2: retirar v_sync_divergence
-- =====================================================================================
-- Vista de reconciliación app.* vs silver.stg_centralizer_* (pipeline congelado desde
-- Task 6). Reemplazada conceptualmente por el flujo upload+diff+aprobación de
-- Checkpoint D, que aún no existe — queda aceptado sin reemplazo 1:1 por ahora.
DROP VIEW IF EXISTS app.v_sync_divergence;

-- =====================================================================================
-- Step 3: soltar la FK de notifications hacia entities
-- =====================================================================================
-- app.notifications tiene 0 filas (confirmado en auditoría de esta sesión). Se relaja
-- la integridad referencial sobre una tabla sin uso real todavía; app.entities se
-- dropea en Task 7.
ALTER TABLE app.notifications DROP CONSTRAINT IF EXISTS notifications_entity_fkey;
