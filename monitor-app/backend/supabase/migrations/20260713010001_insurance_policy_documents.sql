CREATE TABLE app.insurance_policy_documents (
  policy_id   uuid NOT NULL REFERENCES app.insurance_policies(id) ON DELETE CASCADE,
  doc_name    text NOT NULL,
  status      app.compliance_status,
  expiry_date date,
  storage_path text,
  notes       text,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (policy_id, doc_name)
);

ALTER TABLE app.insurance_policy_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY insurance_policy_documents_select ON app.insurance_policy_documents
  FOR SELECT TO authenticated USING (true);
CREATE POLICY insurance_policy_documents_insert ON app.insurance_policy_documents
  FOR INSERT TO authenticated WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));
CREATE POLICY insurance_policy_documents_update ON app.insurance_policy_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));
CREATE POLICY insurance_policy_documents_delete ON app.insurance_policy_documents
  FOR DELETE TO authenticated USING (app.current_user_role() IN ('admin', 'owner'));
