-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (B) ENTIDADES NÚCLEO
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1.1-1.3
--
-- app.transporters (1 fila por RUT), app.transporter_contacts, y conductores/
-- vehículos como entidades GLOBALES con asignación vigente a una empresa
-- (app.driver_assignments / app.vehicle_assignments, valid_from/valid_to).
-- Transferir = cerrar asignación vigente + abrir una nueva; historial gratis
-- y sin duplicar al conductor/vehículo (Principio de arquitectura #5).
-- ==============================================================================

-- ── app.transporters ───────────────────────────────────────────────────────
CREATE TABLE app.transporters (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rut                    text        NOT NULL UNIQUE,
  dv                     text,
  rut_dv_valid           boolean,
  business_name          text        NOT NULL,
  clients                text[]      NOT NULL DEFAULT '{}',
  in_admin               boolean     NOT NULL DEFAULT false,
  admin_internal_id      integer,
  admin_account_id       integer,
  account_stage          text        NOT NULL DEFAULT 'Operational',
  is_active              boolean     NOT NULL DEFAULT true,
  sharepoint_url         text,
  payment_url            text,
  avance_80_20           numeric(5,2),
  avance_total           numeric(5,2),
  contactability         jsonb,        -- legacy: {emails: [], phones: []} sin rol, heredado de transporter_profiles; los contactos por rol viven en transporter_contacts
  source                 text        NOT NULL DEFAULT 'centralizer',   -- centralizer | admin | manual
  last_seen_batch        bigint,
  manually_edited_fields text[]      NOT NULL DEFAULT '{}',
  edited_by              uuid,
  edited_at              timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN app.transporters.in_admin IS
  'true si el RUT matchea con bronze.raw_info_contacto (cruce centralizer↔admin, plan §hallazgos). false = no está en el sistema administrativo (ej. CRIBAS 78241236).';
COMMENT ON COLUMN app.transporters.last_seen_batch IS
  'Último batch_id del pipeline donde este RUT apareció en el centralizer. Usado para la regla de desactivación N=2 batches ausente (plan §2.1) — no se toca desde la app.';
COMMENT ON COLUMN app.transporters.avance_80_20 IS
  'Referencial: valor calculado por fórmula del Excel origen. El % que manda para habilitación es app.v_transporter_compliance.compliance_80_20_pct (plan §1.7).';

CREATE INDEX idx_transporters_admin_internal_id ON app.transporters (admin_internal_id);
CREATE INDEX idx_transporters_clients ON app.transporters USING gin (clients);
CREATE INDEX idx_transporters_is_active ON app.transporters (is_active);

CREATE TRIGGER transporters_set_updated_at
  BEFORE UPDATE ON app.transporters
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── app.transporter_contacts ───────────────────────────────────────────────
CREATE TABLE app.transporter_contacts (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  transporter_id uuid        NOT NULL REFERENCES app.transporters(id) ON DELETE CASCADE,
  role           text        NOT NULL CHECK (role IN ('rep_legal', 'operacional', 'finanzas', 'documentos')),
  name           text,
  phone          text,
  email          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transporter_id, role)
);

CREATE TRIGGER transporter_contacts_set_updated_at
  BEFORE UPDATE ON app.transporter_contacts
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── app.drivers (entidad global) ───────────────────────────────────────────
CREATE TABLE app.drivers (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rut                    text        NOT NULL UNIQUE,
  dv                     text,
  rut_dv_valid           boolean,
  full_name              text        NOT NULL,
  id_expiry              date,
  license_expiry         date,
  avance_total           numeric(5,2),
  source                 text        NOT NULL DEFAULT 'centralizer',
  last_seen_batch        bigint,
  manually_edited_fields text[]      NOT NULL DEFAULT '{}',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER drivers_set_updated_at
  BEFORE UPDATE ON app.drivers
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── app.vehicles (entidad global) ──────────────────────────────────────────
CREATE TABLE app.vehicles (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  plate                    text        NOT NULL UNIQUE,
  kind                     text        NOT NULL CHECK (kind IN ('tracto', 'rampla', 'camion', 'furgon', 'otro')),
  type_label               text,       -- etiqueta original del origen (ej. "Camion c/rampla CORTINA (28 ton)"); kind es la clasificación operativa
  year                     int,
  circ_permit_expiry       date,
  tech_inspection_expiry   date,
  gas_emissions_expiry     date,
  soap_insurance_expiry    date,
  source                   text        NOT NULL DEFAULT 'centralizer',
  last_seen_batch          bigint,
  manually_edited_fields   text[]      NOT NULL DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER vehicles_set_updated_at
  BEFORE UPDATE ON app.vehicles
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── Asignaciones vigentes (transferencias) ─────────────────────────────────

CREATE TABLE app.driver_assignments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id      uuid        NOT NULL REFERENCES app.drivers(id) ON DELETE CASCADE,
  transporter_id uuid        NOT NULL REFERENCES app.transporters(id) ON DELETE CASCADE,
  valid_from     date        NOT NULL DEFAULT current_date,
  valid_to       date,                 -- NULL = vigente
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_driver_active ON app.driver_assignments (driver_id) WHERE valid_to IS NULL;
CREATE INDEX idx_driver_assignments_transporter_active ON app.driver_assignments (transporter_id) WHERE valid_to IS NULL;
CREATE INDEX idx_driver_assignments_driver ON app.driver_assignments (driver_id);

CREATE TABLE app.vehicle_assignments (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id     uuid        NOT NULL REFERENCES app.vehicles(id) ON DELETE CASCADE,
  transporter_id uuid        NOT NULL REFERENCES app.transporters(id) ON DELETE CASCADE,
  valid_from     date        NOT NULL DEFAULT current_date,
  valid_to       date,                 -- NULL = vigente
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_vehicle_active ON app.vehicle_assignments (vehicle_id) WHERE valid_to IS NULL;
CREATE INDEX idx_vehicle_assignments_transporter_active ON app.vehicle_assignments (transporter_id) WHERE valid_to IS NULL;
CREATE INDEX idx_vehicle_assignments_vehicle ON app.vehicle_assignments (vehicle_id);
