-- ==============================================================================
-- MÓDULO EMPRESAS EETT + SEGUROS — AUDITORÍA 2026-07-10: modelo relacional
-- transportista↔cliente. Reemplaza el patrón "clients text[] + avance/estado
-- escalar colapsado (gana Walmart)" por tablas de unión propias:
--
-- app.transporter_client_accounts: 1 fila por (transporter, client) — un
-- transportista multi-cliente ya NO pierde el avance/estado del segundo
-- cliente en el dedupe de staging.
--
-- app.client_document_requirements: reemplaza compliance_doc_catalog.
-- required_for_clients (array embebido) como mecanismo de "qué exige cada
-- cliente" — agregar/cambiar un requisito es INSERT/UPDATE de una fila, no
-- editar un array. Poblada inicialmente REPLICANDO el estado actual (todo
-- Walmart, values de required_for_clients/weight_80_20 tal cual existen hoy)
-- — el mapeo real doc↔cliente para Colun/Sodimac/Iansa es trabajo de negocio
-- pendiente (Fabián), no se inventa acá.
--
-- transporters.clients/avance_80_20/avance_total/account_stage/
-- admin_account_id quedan como snapshot agregado de conveniencia para
-- listados rápidos, pero DEJAN de ser la fuente para el cálculo de
-- elegibilidad multi-cliente (las vistas se reescriben contra las tablas
-- nuevas).
-- ==============================================================================

CREATE TABLE app.transporter_client_accounts (
  id                    uuid primary key default gen_random_uuid(),
  transporter_id        uuid not null references app.transporters(id) on delete cascade,
  client_name           text not null,
  account_stage         text not null default 'Operational',
  avance_80_20          numeric(5,2),
  avance_total          numeric(5,2),
  is_active_for_client  boolean not null default true,
  source                text not null default 'centralizer',
  last_seen_batch       bigint,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (transporter_id, client_name)
);

CREATE INDEX idx_transporter_client_accounts_transporter ON app.transporter_client_accounts (transporter_id);
CREATE INDEX idx_transporter_client_accounts_client ON app.transporter_client_accounts (client_name);

CREATE TRIGGER transporter_client_accounts_set_updated_at
  BEFORE UPDATE ON app.transporter_client_accounts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

COMMENT ON TABLE app.transporter_client_accounts IS
  'Cuenta por (transportista, cliente GC): avance_80_20/avance_total/account_stage propios de cada cliente. Reemplaza el escalar colapsado de app.transporters para transportistas multi-cliente.';

ALTER TABLE app.transporter_client_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transporter_client_accounts_read" ON app.transporter_client_accounts FOR SELECT TO authenticated USING (true);

-- ── app.client_document_requirements ─────────────────────────────────────────
CREATE TABLE app.client_document_requirements (
  client_name   text not null,
  doc_code      text not null references app.compliance_doc_catalog(doc_code) on update cascade on delete cascade,
  required      boolean not null default true,
  weight_80_20  numeric default 0,
  updated_at    timestamptz not null default now(),
  primary key (client_name, doc_code)
);

COMMENT ON TABLE app.client_document_requirements IS
  'Qué doc_code exige cada cliente GC — reemplaza compliance_doc_catalog.required_for_clients (array embebido) como mecanismo data-driven. Poblada inicialmente replicando el estado actual (todo Walmart); mapeo real por cliente pendiente de negocio.';

ALTER TABLE app.client_document_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "client_document_requirements_read" ON app.client_document_requirements FOR SELECT TO authenticated USING (true);

-- Backfill: replica el estado actual de required_for_clients/weight_80_20.
INSERT INTO app.client_document_requirements (client_name, doc_code, required, weight_80_20)
SELECT unnest(c.required_for_clients), c.doc_code, true, c.weight_80_20
FROM app.compliance_doc_catalog c
ON CONFLICT (client_name, doc_code) DO NOTHING;

-- Backfill: 1 fila por (transporter, client) desde el estado actual de
-- transporters.clients[] (snapshot colapsado) — punto de partida antes de
-- que el pipeline empiece a alimentar el grano fino por batch.
INSERT INTO app.transporter_client_accounts (transporter_id, client_name, account_stage, avance_80_20, avance_total, source)
SELECT t.id, c, t.account_stage, t.avance_80_20, t.avance_total, 'centralizer'
FROM app.transporters t
CROSS JOIN LATERAL unnest(t.clients) AS c
ON CONFLICT (transporter_id, client_name) DO NOTHING;

-- ── Vistas de elegibilidad: JOIN contra client_document_requirements ─────────
CREATE OR REPLACE VIEW app.v_transporter_compliance AS
WITH required_docs AS (
  SELECT
    t.id AS transporter_id,
    r.doc_code,
    r.weight_80_20
  FROM app.transporters t
  JOIN app.transporter_client_accounts tca ON tca.transporter_id = t.id AND tca.is_active_for_client
  JOIN app.client_document_requirements r
    ON r.client_name = tca.client_name AND r.required
  JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'transporter'
),
doc_status AS (
  SELECT DISTINCT
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
  'Porcentaje de cumplimiento documental por empresa, calculado contra app.client_document_requirements para cada client_name activo en transporter_client_accounts (reemplaza el JOIN por required_for_clients&&clients). compliance_pct=NULL cuando no hay docs exigidos.';

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
  SELECT DISTINCT
    d.id AS driver_id,
    r.doc_code
  FROM app.drivers d
  JOIN active_assignment aa ON aa.driver_id = d.id
  JOIN app.transporter_client_accounts tca ON tca.transporter_id = aa.transporter_id AND tca.is_active_for_client
  JOIN app.client_document_requirements r ON r.client_name = tca.client_name AND r.required
  JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'driver'
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
  'Habilitación del conductor: docs propios exigidos por client_document_requirements de las cuentas-cliente activas de su empresa vigente + insurance_ok heredado. Sin empresa vigente = no elegible.';

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
  SELECT DISTINCT
    v.id AS vehicle_id,
    r.doc_code
  FROM app.vehicles v
  JOIN active_assignment aa ON aa.vehicle_id = v.id
  JOIN app.transporter_client_accounts tca ON tca.transporter_id = aa.transporter_id AND tca.is_active_for_client
  JOIN app.client_document_requirements r ON r.client_name = tca.client_name AND r.required
  JOIN app.compliance_doc_catalog c ON c.doc_code = r.doc_code AND c.entity_type = 'vehicle'
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
  'Habilitación del vehículo: docs propios exigidos por client_document_requirements de las cuentas-cliente activas de su empresa vigente + insurance_ok. Sin empresa vigente = no elegible.';

-- v_transporter_eligibility se queda igual (ya lee de v_transporter_compliance,
-- no referencia required_for_clients directamente) — no requiere CREATE OR REPLACE.
