-- Checkpoint A / Task 1: columnas de alta-baja, matching por upload, registry_url, tabla de uploads.
-- Puramente aditivo, no destructivo.

CREATE TYPE app.upload_status AS ENUM ('parsed','previewed','approved','applied','rejected','failed');

CREATE TABLE app.centralizer_uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_kind text NOT NULL CHECK (upload_kind IN ('centralizer','insurance')),
  file_name text NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  status app.upload_status NOT NULL DEFAULT 'parsed',
  sheet_summary jsonb,
  parse_errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  approved_by uuid,
  approved_at timestamptz,
  applied_at timestamptz,
  rejected_by uuid,
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.transporters
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz,
  ADD COLUMN last_matched_upload_id uuid REFERENCES app.centralizer_uploads(id),
  ADD COLUMN last_matched_at timestamptz;

ALTER TABLE app.drivers
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz;

ALTER TABLE app.vehicles
  ADD COLUMN baja_override boolean NOT NULL DEFAULT false,
  ADD COLUMN baja_reason text CHECK (baja_reason IN ('documentacion_vencida','termino_mutuo_acuerdo','termino_penalizacion','otro')),
  ADD COLUMN baja_notes text,
  ADD COLUMN baja_by uuid,
  ADD COLUMN baja_at timestamptz;

ALTER TABLE app.insurance_policies ADD COLUMN registry_url text;
COMMENT ON COLUMN app.insurance_policies.registry_url IS
  'URL donde está registrada/consultable la póliza (portal aseguradora/SVS) — distinto de payment_url (pago) y file_url (documento adjunto).';

-- RLS: mismo criterio que las demás tablas de escritura admin+ (ver 20260710120006_rls_write_policies_role_matrix.sql
-- para el patrón exacto de app.current_user_role() usado en este proyecto — replicarlo aquí, no inventar uno nuevo).
ALTER TABLE app.centralizer_uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY centralizer_uploads_all ON app.centralizer_uploads
  FOR SELECT USING (app.current_user_role() IS NOT NULL);

CREATE POLICY centralizer_uploads_insert ON app.centralizer_uploads
  FOR INSERT WITH CHECK (app.current_user_role() IN ('admin','editor'));

CREATE POLICY centralizer_uploads_update ON app.centralizer_uploads
  FOR UPDATE USING (app.current_user_role() = 'admin');
