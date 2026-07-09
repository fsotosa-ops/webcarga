-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (D) SEGUROS
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.5
--
-- Canónico para pólizas/cuotas/pagos: bronze.raw_insurance_vehicles (decisión
-- del plan, sección de hallazgos — los bloques de seguro del centralizer son
-- solo referenciales, no generan cuotas).
--
-- El unique de pólizas es un índice de expresión (no columna generada) porque
-- `endorsement` puede ser NULL y dos pólizas sin endoso no deben considerarse
-- duplicadas entre sí solo por compartir NULL — coalesce(endorsement,'') las
-- distingue de la misma forma que una comparación NULL-safe.
-- ==============================================================================

CREATE TABLE app.insurance_policies (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id  uuid        REFERENCES app.transporters(id) ON DELETE SET NULL,
  rut             text        NOT NULL,
  contractor_name text,
  client_group    text,
  company         text        NOT NULL,
  policy_number   text        NOT NULL,
  endorsement     text,
  coverage        text,
  plate           text,
  policy_type     text        CHECK (policy_type IN ('rc_vehicular', 'rc_eett', 'carga', 'otro')),
  valid_from      date,
  valid_to        date,
  payment_url     text,
  file_url        text,
  storage_path    text,
  source          text        NOT NULL DEFAULT 'pipeline',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN app.insurance_policies.transporter_id IS
  'Re-vinculado por RUT en cada corrida del pipeline (§2.5); puede quedar NULL si el RUT no matchea ningún transporter.';

CREATE UNIQUE INDEX uq_insurance_policies_rut_company_number_endorsement
  ON app.insurance_policies (rut, company, policy_number, coalesce(endorsement, ''));

CREATE INDEX idx_insurance_policies_transporter ON app.insurance_policies (transporter_id);
CREATE INDEX idx_insurance_policies_plate ON app.insurance_policies (plate);

CREATE TRIGGER insurance_policies_set_updated_at
  BEFORE UPDATE ON app.insurance_policies
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

CREATE TABLE app.insurance_installments (
  id                 uuid                  PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id          uuid                  NOT NULL REFERENCES app.insurance_policies(id) ON DELETE CASCADE,
  installment_number int                   NOT NULL,
  total_installments int,
  amount_uf          numeric(10,2),
  due_date           date,
  status             app.installment_status NOT NULL DEFAULT 'pendiente',
  paid_at            date,
  payment_url        text,
  manual_override    boolean               NOT NULL DEFAULT false,
  updated_by         uuid,
  updated_at         timestamptz           NOT NULL DEFAULT now(),
  UNIQUE (policy_id, installment_number, due_date)
);

COMMENT ON COLUMN app.insurance_installments.manual_override IS
  'true = pago marcado manualmente en la app; el upsert del pipeline (§2.5) no pisa esta fila mientras esté en true.';

CREATE INDEX idx_insurance_installments_policy ON app.insurance_installments (policy_id);
CREATE INDEX idx_insurance_installments_status_due ON app.insurance_installments (status, due_date);

CREATE TRIGGER insurance_installments_set_updated_at
  BEFORE UPDATE ON app.insurance_installments
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();
