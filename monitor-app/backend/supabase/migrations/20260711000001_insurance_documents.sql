-- ==============================================================================
-- MÓDULO SEGUROS — REDISEÑO 2026-07-11: catálogo de documentos por póliza +
-- vista plana de cobranza. Spec: docs/superpowers/specs/2026-07-11-seguros-redesign-design.md
--
-- Antes: una póliza tenía un solo archivo versionado (app.stored_files con
-- owner_type='insurance_policy'). Distintos tipos de documento (póliza
-- firmada, certificado de vigencia, endoso, comprobante de pago) tienen su
-- propio ciclo de vida — mismo patrón que app.compliance_documents en
-- Empresas, pero sin entity_type (acá el dueño siempre es una póliza).
-- ==============================================================================

CREATE TABLE app.insurance_doc_catalog (
  doc_code    text PRIMARY KEY,
  label       text NOT NULL,
  has_expiry  boolean NOT NULL DEFAULT false,
  sort_order  int NOT NULL DEFAULT 0
);

INSERT INTO app.insurance_doc_catalog (doc_code, label, has_expiry, sort_order) VALUES
  ('poliza_firmada',        'Póliza firmada',            false, 10),
  ('certificado_vigencia',  'Certificado de vigencia',   true,  20),
  ('endoso',                'Endoso',                     false, 30),
  ('comprobante_pago',      'Comprobante de pago',        false, 40);

CREATE TABLE app.insurance_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        uuid NOT NULL REFERENCES app.insurance_policies(id) ON DELETE CASCADE,
  doc_code         text NOT NULL REFERENCES app.insurance_doc_catalog(doc_code) ON UPDATE CASCADE,
  status           app.compliance_status,
  expiry_date      date,
  file_url         text,
  storage_path     text,
  notes            text,
  source           text NOT NULL DEFAULT 'manual',
  manual_override  boolean NOT NULL DEFAULT true,
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, doc_code)
);

CREATE INDEX idx_insurance_documents_policy ON app.insurance_documents (policy_id);

COMMENT ON TABLE app.insurance_documents IS
  'Un estado/archivo por (póliza, tipo de documento) — mismo patrón que app.compliance_documents. source siempre manual: estos documentos no vienen del pipeline centralizer.';

ALTER TABLE app.stored_files DROP CONSTRAINT stored_files_owner_type_check;
ALTER TABLE app.stored_files ADD CONSTRAINT stored_files_owner_type_check
  CHECK (owner_type IN ('compliance_document', 'insurance_policy', 'insurance_document'));

-- Backfill: cada archivo hoy colgado directo de la póliza (owner_type=
-- 'insurance_policy') se migra a una fila insurance_documents con doc_code
-- 'poliza_firmada' (no hay forma de distinguir qué representaba ese archivo
-- único, se asume el caso más común) — mismo storage_path, sin duplicar el
-- archivo físico en Storage.
DO $$
DECLARE
  r record;
  v_doc_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT owner_id AS policy_id FROM app.stored_files WHERE owner_type = 'insurance_policy'
  LOOP
    INSERT INTO app.insurance_documents (policy_id, doc_code, status, source, manual_override)
    VALUES (r.policy_id, 'poliza_firmada', 'ok', 'manual', true)
    ON CONFLICT (policy_id, doc_code) DO NOTHING
    RETURNING id INTO v_doc_id;

    IF v_doc_id IS NULL THEN
      SELECT id INTO v_doc_id FROM app.insurance_documents WHERE policy_id = r.policy_id AND doc_code = 'poliza_firmada';
    END IF;

    UPDATE app.stored_files SET owner_type = 'insurance_document', owner_id = v_doc_id
    WHERE owner_type = 'insurance_policy' AND owner_id = r.policy_id;

    v_doc_id := NULL;
  END LOOP;
END $$;

ALTER TABLE app.insurance_doc_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.insurance_documents   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "insurance_doc_catalog_read" ON app.insurance_doc_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "insurance_documents_read"   ON app.insurance_documents   FOR SELECT TO authenticated USING (true);

CREATE POLICY "insurance_doc_catalog_write" ON app.insurance_doc_catalog
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "insurance_documents_write" ON app.insurance_documents
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- Vista plana de cobranza: 1 fila por cuota, con datos de empresa/póliza ya
-- resueltos, para que el frontend agrupe en memoria sin N llamados por
-- empresa (mismo patrón que las vistas de elegibilidad existentes).
CREATE OR REPLACE VIEW app.v_insurance_installments_flat AS
SELECT
  ii.id                                                            AS installment_id,
  ip.id                                                            AS policy_id,
  ip.transporter_id,
  ip.rut,
  COALESCE(t.business_name, ip.contractor_name)                   AS business_name,
  ip.company,
  ip.policy_number,
  ip.client_group,
  ii.installment_number,
  ii.amount_uf,
  ii.due_date,
  ii.status,
  (ii.status = 'vencida' OR (ii.status = 'pendiente' AND ii.due_date < CURRENT_DATE)) AS is_overdue
FROM app.insurance_installments ii
JOIN app.insurance_policies ip ON ip.id = ii.policy_id
LEFT JOIN app.transporters t ON t.id = ip.transporter_id;

COMMENT ON VIEW app.v_insurance_installments_flat IS
  'Cuotas en formato plano (cuota->póliza->empresa ya resuelto) para la vista Cobranza — evita N llamados por empresa; el agrupamiento por semana/mes/trimestre/empresa/aseguradora/cliente GC se hace en memoria en el cliente.';
