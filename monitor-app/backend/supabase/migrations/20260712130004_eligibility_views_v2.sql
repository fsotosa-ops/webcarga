-- ==============================================================================
-- CHECKPOINT A — Task 4: repuntar vistas de elegibilidad + vista de estado
-- operativo
--
-- app.compliance_documents (genérica, entity_type+entity_id) es reemplazada
-- como fuente de estado de documentos por las 3 tablas angostas creadas en
-- Task 3 (app.transporter_documents / driver_documents / vehicle_documents,
-- PK compuesta entidad+doc_name). compliance_doc_catalog sigue existiendo en
-- este punto del checkpoint (se dropea en Task 7) y las vistas siguen
-- haciendo JOIN contra ella para resolver qué doc_code pertenece a cada
-- entity_type — eso no cambia.
--
-- Es un repunte de fuente de datos, no un rediseño de la fórmula de
-- elegibilidad: el único cambio de lógica es agregar `AND NOT <entidad>.
-- baja_override` a la condición de `eligible` (con su blocking_reason
-- correspondiente, siguiendo el mismo patrón que 'inactive'/
-- 'no_active_transporter'), reflejando las columnas agregadas en Task 1.
--
-- Verificado: doc_name en las tablas nuevas es exactamente doc_code de
-- compliance_documents (ver INSERT de Task 3), y las tablas nuevas solo
-- contienen filas con status NO NULO — igual que el resultado de un
-- LEFT JOIN contra compliance_documents para las filas sin match. Por lo
-- tanto el repunte es transparente: mismo (transporter_id, eligible) /
-- (driver_id, eligible) / (vehicle_id, eligible) para el 100% de las filas,
-- confirmado por checksum antes/después (baja_override es false para el
-- 100% de las filas en este punto, ver task-4-report.md).
-- ==============================================================================

-- ------------------------------------------------------------------
-- app.v_transporter_compliance — fuente de compliance_pct/compliance_80_20_pct
-- consumida por v_transporter_eligibility. Único cambio: doc_status ahora
-- sale de app.transporter_documents en vez de app.compliance_documents.
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_transporter_compliance AS
WITH required_docs AS (
  SELECT t.id AS transporter_id,
    r.doc_code,
    r.weight_80_20
  FROM app.transporters t
    JOIN app.transporter_client_accounts tca ON tca.transporter_id = t.id AND tca.is_active_for_client
    JOIN app.client_document_requirements r ON r.client_name = tca.client_name AND r.required
    JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'transporter'
), doc_status AS (
  SELECT DISTINCT rd.transporter_id,
    rd.doc_code,
    rd.weight_80_20,
    td.status
  FROM required_docs rd
    LEFT JOIN app.transporter_documents td
      ON td.transporter_id = rd.transporter_id AND td.doc_name = rd.doc_code
), counted AS (
  SELECT doc_status.transporter_id,
    count(*) FILTER (WHERE doc_status.status IS DISTINCT FROM 'n_a'::app.compliance_status) AS required_docs,
    count(*) FILTER (WHERE doc_status.status = 'ok'::app.compliance_status) AS ok_docs,
    count(*) FILTER (WHERE doc_status.weight_80_20 > 0::numeric AND doc_status.status IS DISTINCT FROM 'n_a'::app.compliance_status) AS required_8020_docs,
    count(*) FILTER (WHERE doc_status.weight_80_20 > 0::numeric AND doc_status.status = 'ok'::app.compliance_status) AS ok_8020_docs
  FROM doc_status
  GROUP BY doc_status.transporter_id
)
SELECT t.id AS transporter_id,
  t.rut,
  t.business_name,
  COALESCE(c.required_docs, 0::bigint) AS required_docs,
  COALESCE(c.ok_docs, 0::bigint) AS ok_docs,
  round(100.0 * COALESCE(c.ok_docs, 0::bigint)::numeric / NULLIF(COALESCE(c.required_docs, 0::bigint), 0)::numeric, 2) AS compliance_pct,
  round(100.0 * COALESCE(c.ok_8020_docs, 0::bigint)::numeric / NULLIF(COALESCE(c.required_8020_docs, 0::bigint), 0)::numeric, 2) AS compliance_80_20_pct
FROM app.transporters t
  LEFT JOIN counted c ON c.transporter_id = t.id;

-- ------------------------------------------------------------------
-- app.v_transporter_eligibility — no consulta compliance_documents
-- directamente (lo hace vía v_transporter_compliance, arriba). Único
-- cambio acá: agregar `AND NOT t.baja_override` a `eligible` y el
-- blocking_reason correspondiente.
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_transporter_eligibility AS
WITH threshold AS (
  SELECT COALESCE((SELECT alert_thresholds.warning_days
            FROM app.alert_thresholds
           WHERE alert_thresholds.doc_type = 'compliance_min_pct'), 90)::numeric AS min_pct
), insurance_status AS (
  SELECT ip.transporter_id,
    bool_or(ii.status = 'vencida'::app.installment_status
      OR (ii.status = 'pendiente'::app.installment_status AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)) AS has_overdue
  FROM app.insurance_policies ip
    JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  WHERE ip.transporter_id IS NOT NULL
  GROUP BY ip.transporter_id
)
SELECT t.id AS transporter_id,
  t.rut,
  t.business_name,
  t.is_active,
  vc.compliance_pct,
  th.min_pct AS compliance_threshold,
  NOT COALESCE(ist.has_overdue, false) AS insurance_ok,
  COALESCE(vc.compliance_pct, 0::numeric) >= th.min_pct
    AND NOT COALESCE(ist.has_overdue, false)
    AND t.is_active
    AND NOT t.baja_override AS eligible,
  array_remove(ARRAY[
    CASE WHEN COALESCE(vc.compliance_pct, 0::numeric) < th.min_pct THEN 'docs_below_threshold' ELSE NULL END,
    CASE WHEN COALESCE(ist.has_overdue, false) THEN 'insurance_overdue' ELSE NULL END,
    CASE WHEN NOT t.is_active THEN 'inactive' ELSE NULL END,
    CASE WHEN t.baja_override THEN 'baja_override' ELSE NULL END
  ], NULL::text) AS blocking_reasons
FROM app.transporters t
  CROSS JOIN threshold th
  LEFT JOIN app.v_transporter_compliance vc ON vc.transporter_id = t.id
  LEFT JOIN insurance_status ist ON ist.transporter_id = t.id;

-- ------------------------------------------------------------------
-- app.v_driver_eligibility — doc_status ahora sale de
-- app.driver_documents en vez de app.compliance_documents, y se agrega
-- `AND NOT d.baja_override` a `eligible`.
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_driver_eligibility AS
WITH threshold AS (
  SELECT COALESCE((SELECT alert_thresholds.warning_days
            FROM app.alert_thresholds
           WHERE alert_thresholds.doc_type = 'compliance_min_pct'), 90)::numeric AS min_pct
), active_assignment AS (
  SELECT da.driver_id,
    da.transporter_id
  FROM app.driver_assignments da
  WHERE da.valid_to IS NULL
), required_docs AS (
  SELECT DISTINCT d.id AS driver_id,
    r.doc_code
  FROM app.drivers d
    JOIN active_assignment aa ON aa.driver_id = d.id
    JOIN app.transporter_client_accounts tca ON tca.transporter_id = aa.transporter_id AND tca.is_active_for_client
    JOIN app.client_document_requirements r ON r.client_name = tca.client_name AND r.required
    JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'driver'
), doc_status AS (
  SELECT rd.driver_id,
    rd.doc_code,
    dd.status
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
  SELECT aa.driver_id,
    bool_or(ii.status = 'vencida'::app.installment_status
      OR (ii.status = 'pendiente'::app.installment_status AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)) AS has_overdue
  FROM active_assignment aa
    JOIN app.insurance_policies ip ON ip.transporter_id = aa.transporter_id
    JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  GROUP BY aa.driver_id
), compliance AS (
  SELECT d.id AS driver_id,
    round(100.0 * COALESCE(c.ok_docs, 0::bigint)::numeric / NULLIF(COALESCE(c.required_docs, 0::bigint), 0)::numeric, 2) AS compliance_pct
  FROM app.drivers d
    LEFT JOIN counted c ON c.driver_id = d.id
)
SELECT d.id AS driver_id,
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

-- ------------------------------------------------------------------
-- app.v_vehicle_eligibility — doc_status ahora sale de
-- app.vehicle_documents en vez de app.compliance_documents, y se agrega
-- `AND NOT v.baja_override` a `eligible`.
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_vehicle_eligibility AS
WITH threshold AS (
  SELECT COALESCE((SELECT alert_thresholds.warning_days
            FROM app.alert_thresholds
           WHERE alert_thresholds.doc_type = 'compliance_min_pct'), 90)::numeric AS min_pct
), active_assignment AS (
  SELECT va.vehicle_id,
    va.transporter_id
  FROM app.vehicle_assignments va
  WHERE va.valid_to IS NULL
), required_docs AS (
  SELECT DISTINCT v.id AS vehicle_id,
    r.doc_code
  FROM app.vehicles v
    JOIN active_assignment aa ON aa.vehicle_id = v.id
    JOIN app.transporter_client_accounts tca ON tca.transporter_id = aa.transporter_id AND tca.is_active_for_client
    JOIN app.client_document_requirements r ON r.client_name = tca.client_name AND r.required
    JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'vehicle'
), doc_status AS (
  SELECT rd.vehicle_id,
    rd.doc_code,
    vd.status
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
  SELECT v.id AS vehicle_id,
    bool_or(ii.status = 'vencida'::app.installment_status
      OR (ii.status = 'pendiente'::app.installment_status AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)) AS has_overdue
  FROM app.vehicles v
    LEFT JOIN active_assignment aa ON aa.vehicle_id = v.id
    JOIN app.insurance_policies ip ON ip.plate = v.plate OR ip.transporter_id = aa.transporter_id
    JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  GROUP BY v.id
), compliance AS (
  SELECT v.id AS vehicle_id,
    round(100.0 * COALESCE(c.ok_docs, 0::bigint)::numeric / NULLIF(COALESCE(c.required_docs, 0::bigint), 0)::numeric, 2) AS compliance_pct
  FROM app.vehicles v
    LEFT JOIN counted c ON c.vehicle_id = v.id
)
SELECT v.id AS vehicle_id,
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

-- ------------------------------------------------------------------
-- app.v_transporter_operational_status — nueva. 100% 'no_operativa' en
-- este punto del checkpoint es esperado (last_matched_upload_id es NULL
-- para todos, se llena en un task posterior de matching de uploads).
-- ------------------------------------------------------------------
CREATE OR REPLACE VIEW app.v_transporter_operational_status AS
SELECT
  t.id AS transporter_id,
  ve.eligible,
  ve.blocking_reasons,
  (t.last_matched_upload_id IS NOT NULL) AS matched_by_upload,
  CASE
    WHEN ve.eligible AND t.last_matched_upload_id IS NOT NULL THEN 'operativa'
    ELSE 'no_operativa'
  END AS operational_status
FROM app.transporters t
  JOIN app.v_transporter_eligibility ve ON ve.transporter_id = t.id;
