-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (F) VISTAS + UMBRAL + RLS
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.7
--
-- Umbral de cumplimiento: app.alert_thresholds tiene PK doc_type y columnas
-- warning_days/error_days (umbrales EN DÍAS para vencimientos, ver
-- 20260529000002_config_tables.sql) — no tiene una columna de porcentaje.
-- DESVIACIÓN respecto al plan literal: se reutiliza `warning_days` para
-- almacenar el valor del umbral (90 = 90%) bajo doc_type='compliance_min_pct',
-- en vez de alterar la tabla (fuera de alcance de esta fase: "no toques
-- ninguna tabla existente salvo el INSERT en alert_thresholds"). Las vistas
-- de elegibilidad leen ese valor por su nombre semántico, no por su tipo de
-- columna. Si más adelante se agrega una columna dedicada, este INSERT y las
-- vistas se ajustan en una migración aparte.
INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES
  ('compliance_min_pct', 'Cumplimiento mínimo para habilitar empresa (%)', 90, 0)
ON CONFLICT (doc_type) DO NOTHING;

-- ══════════════════════════════════════════════════════════════════════════
-- VISTAS DE CUMPLIMIENTO Y ELEGIBILIDAD
-- ══════════════════════════════════════════════════════════════════════════

-- ── app.v_transporter_compliance ───────────────────────────────────────────
-- % de docs 'ok' sobre los doc_codes del catálogo exigidos para alguno de los
-- clients[] de la empresa (required_for_clients && clients). Un doc del
-- catálogo sin fila en compliance_documents cuenta como pendiente (no ok, no
-- excluido). Un doc con status='n_a' se excluye por completo del cálculo
-- (numerador y denominador).
CREATE OR REPLACE VIEW app.v_transporter_compliance AS
WITH required_docs AS (
  SELECT
    t.id AS transporter_id,
    c.doc_code,
    c.weight_80_20
  FROM app.transporters t
  JOIN app.compliance_doc_catalog c
    ON c.entity_type = 'transporter'
   AND c.required_for_clients && t.clients
),
doc_status AS (
  SELECT
    rd.transporter_id,
    rd.doc_code,
    rd.weight_80_20,
    cd.status
  FROM required_docs rd
  LEFT JOIN app.compliance_documents cd
    ON cd.entity_type = 'transporter'
   AND cd.entity_id = rd.transporter_id
   AND cd.doc_code = rd.doc_code
),
counted AS (
  SELECT
    transporter_id,
    count(*) FILTER (WHERE status IS DISTINCT FROM 'n_a')                              AS required_docs,
    count(*) FILTER (WHERE status = 'ok')                                              AS ok_docs,
    count(*) FILTER (WHERE weight_80_20 > 0 AND status IS DISTINCT FROM 'n_a')         AS required_8020_docs,
    count(*) FILTER (WHERE weight_80_20 > 0 AND status = 'ok')                         AS ok_8020_docs
  FROM doc_status
  GROUP BY transporter_id
)
SELECT
  t.id                                                                          AS transporter_id,
  t.rut,
  t.business_name,
  coalesce(c.required_docs, 0)                                                  AS required_docs,
  coalesce(c.ok_docs, 0)                                                        AS ok_docs,
  round(100.0 * coalesce(c.ok_docs, 0) / nullif(coalesce(c.required_docs, 0), 0), 2) AS compliance_pct,
  round(100.0 * coalesce(c.ok_8020_docs, 0) / nullif(coalesce(c.required_8020_docs, 0), 0), 2) AS compliance_80_20_pct
FROM app.transporters t
LEFT JOIN counted c ON c.transporter_id = t.id;

COMMENT ON VIEW app.v_transporter_compliance IS
  'Porcentaje de cumplimiento documental por empresa contra el catálogo, filtrado por sus clients[]. compliance_pct=NULL cuando no hay docs exigidos (sin clients matcheados).';

-- ── app.v_transporter_eligibility ──────────────────────────────────────────
CREATE OR REPLACE VIEW app.v_transporter_eligibility AS
WITH threshold AS (
  SELECT coalesce(
    (SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'compliance_min_pct'),
    90
  )::numeric AS min_pct
),
insurance_status AS (
  SELECT
    ip.transporter_id,
    bool_or(
      ii.status = 'vencida'
      OR (ii.status = 'pendiente' AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)
    ) AS has_overdue
  FROM app.insurance_policies ip
  JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  WHERE ip.transporter_id IS NOT NULL
  GROUP BY ip.transporter_id
)
SELECT
  t.id                                            AS transporter_id,
  t.rut,
  t.business_name,
  t.is_active,
  vc.compliance_pct,
  th.min_pct                                       AS compliance_threshold,
  NOT coalesce(ist.has_overdue, false)              AS insurance_ok,
  (
    coalesce(vc.compliance_pct, 0) >= th.min_pct
    AND NOT coalesce(ist.has_overdue, false)
    AND t.is_active
  )                                                 AS eligible,
  array_remove(ARRAY[
    CASE WHEN coalesce(vc.compliance_pct, 0) < th.min_pct THEN 'docs_below_threshold' END,
    CASE WHEN coalesce(ist.has_overdue, false) THEN 'insurance_overdue' END,
    CASE WHEN NOT t.is_active THEN 'inactive' END
  ], NULL)                                          AS blocking_reasons
FROM app.transporters t
CROSS JOIN threshold th
LEFT JOIN app.v_transporter_compliance vc ON vc.transporter_id = t.id
LEFT JOIN insurance_status ist ON ist.transporter_id = t.id;

COMMENT ON VIEW app.v_transporter_eligibility IS
  'Habilitación de la empresa para asignar viajes: cumplimiento >= umbral AND sin cuotas de seguro vencidas/pendientes-atrasadas AND activa. blocking_reasons explica el semáforo en la ficha.';

-- ── app.v_driver_eligibility ────────────────────────────────────────────────
-- Docs propios del conductor (filtrados por clients[] de su empresa vigente);
-- insurance_ok se hereda de las pólizas de esa empresa (vía driver_assignments).
CREATE OR REPLACE VIEW app.v_driver_eligibility AS
WITH threshold AS (
  SELECT coalesce(
    (SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'compliance_min_pct'),
    90
  )::numeric AS min_pct
),
active_assignment AS (
  SELECT da.driver_id, da.transporter_id
  FROM app.driver_assignments da
  WHERE da.valid_to IS NULL
),
required_docs AS (
  SELECT
    d.id AS driver_id,
    c.doc_code
  FROM app.drivers d
  JOIN active_assignment aa ON aa.driver_id = d.id
  JOIN app.transporters t ON t.id = aa.transporter_id
  JOIN app.compliance_doc_catalog c
    ON c.entity_type = 'driver'
   AND c.required_for_clients && t.clients
),
doc_status AS (
  SELECT
    rd.driver_id,
    rd.doc_code,
    cd.status
  FROM required_docs rd
  LEFT JOIN app.compliance_documents cd
    ON cd.entity_type = 'driver'
   AND cd.entity_id = rd.driver_id
   AND cd.doc_code = rd.doc_code
),
counted AS (
  SELECT
    driver_id,
    count(*) FILTER (WHERE status IS DISTINCT FROM 'n_a') AS required_docs,
    count(*) FILTER (WHERE status = 'ok')                 AS ok_docs
  FROM doc_status
  GROUP BY driver_id
),
insurance_status AS (
  SELECT
    aa.driver_id,
    bool_or(
      ii.status = 'vencida'
      OR (ii.status = 'pendiente' AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)
    ) AS has_overdue
  FROM active_assignment aa
  JOIN app.insurance_policies ip ON ip.transporter_id = aa.transporter_id
  JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  GROUP BY aa.driver_id
),
compliance AS (
  SELECT
    d.id AS driver_id,
    round(100.0 * coalesce(c.ok_docs, 0) / nullif(coalesce(c.required_docs, 0), 0), 2) AS compliance_pct
  FROM app.drivers d
  LEFT JOIN counted c ON c.driver_id = d.id
)
SELECT
  d.id                                              AS driver_id,
  d.rut,
  d.full_name,
  aa.transporter_id,
  cp.compliance_pct,
  th.min_pct                                         AS compliance_threshold,
  NOT coalesce(ist.has_overdue, false)                AS insurance_ok,
  (
    coalesce(cp.compliance_pct, 0) >= th.min_pct
    AND NOT coalesce(ist.has_overdue, false)
    AND aa.transporter_id IS NOT NULL
  )                                                   AS eligible,
  array_remove(ARRAY[
    CASE WHEN coalesce(cp.compliance_pct, 0) < th.min_pct THEN 'docs_below_threshold' END,
    CASE WHEN coalesce(ist.has_overdue, false) THEN 'insurance_overdue' END,
    CASE WHEN aa.transporter_id IS NULL THEN 'no_active_transporter' END
  ], NULL)                                            AS blocking_reasons
FROM app.drivers d
CROSS JOIN threshold th
LEFT JOIN active_assignment aa ON aa.driver_id = d.id
LEFT JOIN compliance cp ON cp.driver_id = d.id
LEFT JOIN insurance_status ist ON ist.driver_id = d.id;

COMMENT ON VIEW app.v_driver_eligibility IS
  'Habilitación del conductor: docs propios exigidos por su empresa vigente + insurance_ok heredado de las pólizas de esa empresa. Sin empresa vigente = no elegible (blocking_reasons: no_active_transporter).';

-- ── app.v_vehicle_eligibility ───────────────────────────────────────────────
-- Docs propios del vehículo (filtrados por clients[] de su empresa vigente);
-- insurance_ok considera cuotas vencidas de pólizas vinculadas por patente
-- O por la empresa vigente (vía vehicle_assignments).
CREATE OR REPLACE VIEW app.v_vehicle_eligibility AS
WITH threshold AS (
  SELECT coalesce(
    (SELECT warning_days FROM app.alert_thresholds WHERE doc_type = 'compliance_min_pct'),
    90
  )::numeric AS min_pct
),
active_assignment AS (
  SELECT va.vehicle_id, va.transporter_id
  FROM app.vehicle_assignments va
  WHERE va.valid_to IS NULL
),
required_docs AS (
  SELECT
    v.id AS vehicle_id,
    c.doc_code
  FROM app.vehicles v
  JOIN active_assignment aa ON aa.vehicle_id = v.id
  JOIN app.transporters t ON t.id = aa.transporter_id
  JOIN app.compliance_doc_catalog c
    ON c.entity_type = 'vehicle'
   AND c.required_for_clients && t.clients
),
doc_status AS (
  SELECT
    rd.vehicle_id,
    rd.doc_code,
    cd.status
  FROM required_docs rd
  LEFT JOIN app.compliance_documents cd
    ON cd.entity_type = 'vehicle'
   AND cd.entity_id = rd.vehicle_id
   AND cd.doc_code = rd.doc_code
),
counted AS (
  SELECT
    vehicle_id,
    count(*) FILTER (WHERE status IS DISTINCT FROM 'n_a') AS required_docs,
    count(*) FILTER (WHERE status = 'ok')                 AS ok_docs
  FROM doc_status
  GROUP BY vehicle_id
),
insurance_status AS (
  SELECT
    v.id AS vehicle_id,
    bool_or(
      ii.status = 'vencida'
      OR (ii.status = 'pendiente' AND ii.due_date < (now() AT TIME ZONE 'America/Santiago')::date)
    ) AS has_overdue
  FROM app.vehicles v
  LEFT JOIN active_assignment aa ON aa.vehicle_id = v.id
  JOIN app.insurance_policies ip
    ON ip.plate = v.plate OR ip.transporter_id = aa.transporter_id
  JOIN app.insurance_installments ii ON ii.policy_id = ip.id
  GROUP BY v.id
),
compliance AS (
  SELECT
    v.id AS vehicle_id,
    round(100.0 * coalesce(c.ok_docs, 0) / nullif(coalesce(c.required_docs, 0), 0), 2) AS compliance_pct
  FROM app.vehicles v
  LEFT JOIN counted c ON c.vehicle_id = v.id
)
SELECT
  v.id                                                AS vehicle_id,
  v.plate,
  v.kind,
  aa.transporter_id,
  cp.compliance_pct,
  th.min_pct                                           AS compliance_threshold,
  NOT coalesce(ist.has_overdue, false)                  AS insurance_ok,
  (
    coalesce(cp.compliance_pct, 0) >= th.min_pct
    AND NOT coalesce(ist.has_overdue, false)
    AND aa.transporter_id IS NOT NULL
  )                                                     AS eligible,
  array_remove(ARRAY[
    CASE WHEN coalesce(cp.compliance_pct, 0) < th.min_pct THEN 'docs_below_threshold' END,
    CASE WHEN coalesce(ist.has_overdue, false) THEN 'insurance_overdue' END,
    CASE WHEN aa.transporter_id IS NULL THEN 'no_active_transporter' END
  ], NULL)                                              AS blocking_reasons
FROM app.vehicles v
CROSS JOIN threshold th
LEFT JOIN active_assignment aa ON aa.vehicle_id = v.id
LEFT JOIN compliance cp ON cp.vehicle_id = v.id
LEFT JOIN insurance_status ist ON ist.vehicle_id = v.id;

COMMENT ON VIEW app.v_vehicle_eligibility IS
  'Habilitación del vehículo: docs propios exigidos por su empresa vigente + insurance_ok cruzando cuotas vencidas de pólizas por patente o por la empresa vigente. Sin empresa vigente = no elegible.';

-- app.v_sync_divergence se implementa en Fase 3 (requiere la capa silver del
-- pipeline Mage, que aún no existe) — NO se crea acá, por instrucción explícita.

-- ══════════════════════════════════════════════════════════════════════════
-- RLS — lectura para authenticated en todas las tablas nuevas de `app`
-- (ops queda sin RLS/políticas, sin acceso a authenticated — solo service_role)
-- ══════════════════════════════════════════════════════════════════════════

ALTER TABLE app.sync_config             ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.transporters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.transporter_contacts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.drivers                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vehicles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.driver_assignments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.vehicle_assignments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.compliance_doc_catalog  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.compliance_documents    ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.stored_files            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.insurance_policies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.insurance_installments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.audit_log               ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.notifications           ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_config_read"            ON app.sync_config            FOR SELECT TO authenticated USING (true);
CREATE POLICY "transporters_read"           ON app.transporters           FOR SELECT TO authenticated USING (true);
CREATE POLICY "transporter_contacts_read"   ON app.transporter_contacts   FOR SELECT TO authenticated USING (true);
CREATE POLICY "drivers_read"                ON app.drivers                FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicles_read"               ON app.vehicles               FOR SELECT TO authenticated USING (true);
CREATE POLICY "driver_assignments_read"     ON app.driver_assignments     FOR SELECT TO authenticated USING (true);
CREATE POLICY "vehicle_assignments_read"    ON app.vehicle_assignments    FOR SELECT TO authenticated USING (true);
CREATE POLICY "compliance_doc_catalog_read" ON app.compliance_doc_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "compliance_documents_read"   ON app.compliance_documents   FOR SELECT TO authenticated USING (true);
CREATE POLICY "stored_files_read"           ON app.stored_files           FOR SELECT TO authenticated USING (true);
CREATE POLICY "insurance_policies_read"     ON app.insurance_policies     FOR SELECT TO authenticated USING (true);
CREATE POLICY "insurance_installments_read" ON app.insurance_installments FOR SELECT TO authenticated USING (true);
CREATE POLICY "audit_log_read"              ON app.audit_log              FOR SELECT TO authenticated USING (true);
CREATE POLICY "notifications_read"          ON app.notifications          FOR SELECT TO authenticated USING (true);

-- Sin políticas de escritura: el API (FastAPI) escribe con rol postgres/
-- service_role, que bypassea RLS. Autorización por profiles.role se valida
-- server-side (plan §1.7 / §3), no vía política de Postgres.
