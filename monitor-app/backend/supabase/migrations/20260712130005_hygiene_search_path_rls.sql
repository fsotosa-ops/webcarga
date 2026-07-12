-- ==============================================================================
-- CHECKPOINT A — Task 5: hygiene — search_path de funciones + consolidar
-- políticas RLS duplicadas (_read/_write → una sola policy por acción).
--
-- Re-auditado contra get_advisors (security + performance) en vivo, en vez
-- de asumir la lista de la sesión anterior — Tasks 1-4 agregaron tablas
-- nuevas (transporter_documents/driver_documents/vehicle_documents) que
-- replican el mismo patrón _read/_write y por lo tanto también aparecen hoy
-- en multiple_permissive_policies. Se dejan FUERA de este task a propósito
-- (ver task-5-report.md) — no estaban en el alcance original y mezclar ese
-- fix con el de acá es scope creep; queda anotado como deuda para un task
-- aparte.
--
-- function_search_path_mutable (11 funciones app/silver, confirmado igual a
-- la lista original salvo que se excluye gold.update_updated_at, fuera de
-- alcance de este módulo):
--   app.normalize_rut, app.rut_dv, app.set_updated_at,
--   app.protect_manual_overrides, app.protect_manual_edits,
--   app.audit_insurance_installment_change, app.audit_compliance_document_change,
--   app.register_entity, silver.parse_centralizer_date,
--   silver.parse_insurance_date, silver.map_doc_status.
--
-- app.register_entity y app.audit_compliance_document_change quedan
-- EXCLUIDAS del fix de search_path: están atadas a app.entities /
-- app.compliance_documents, que Task 7 dropea. Fijarles el search_path acá
-- sería trabajo tirado. Se documentan sus triggers (confirmado vía
-- pg_trigger) para que Task 7 los dropee explícitamente:
--
--   app.register_entity() dispara desde:
--     - drivers_register_entity       ON app.drivers
--     - transporters_register_entity  ON app.transporters
--     - vehicles_register_entity      ON app.vehicles
--   Estos 3 triggers viven en tablas que NO se dropean (drivers/transporters/
--   vehicles sobreviven) — Task 7 debe hacer DROP TRIGGER explícito de los
--   3 (no alcanza con dropear app.entities, el trigger no vive ahí).
--
--   app.audit_compliance_document_change() dispara desde:
--     - compliance_documents_audit ON app.compliance_documents
--   Este trigger SÍ vive en una tabla que Task 7 dropea (app.compliance_documents),
--   así que desaparece solo al hacer DROP TABLE — no requiere DROP TRIGGER
--   explícito, pero queda listado acá para que Task 7 lo confirme.
--
-- multiple_permissive_policies: de las tablas con _read/_write duplicadas,
-- se consolidan solo las 4 que sobreviven a Task 7:
--   client_document_requirements, compliance_doc_catalog, sync_config,
--   transporter_contacts.
-- Explícitamente NO se tocan (se dropean en Task 7, sería trabajo perdido):
--   driver_assignments, vehicle_assignments, insurance_doc_catalog,
--   insurance_documents.
-- Tampoco se toca public.profiles (fuera de este módulo) ni las tablas
-- nuevas *_documents (ver nota arriba).
--
-- Antes de fusionar cada par se leyó pg_policies: en los 4 casos el patrón
-- es idéntico — "_read" es FOR SELECT USING (true) y "_write" es FOR ALL
-- (o sea también cubre SELECT, de ahí el warning) con el mismo qual y
-- with_check. La fusión reemplaza ambas por: una policy _select (mismo
-- USING true que tenía _read) + policies _insert/_update/_delete separadas
-- que preservan EXACTAMENTE el mismo qual/with_check que tenía _write, sin
-- volver a cubrir SELECT.
-- ==============================================================================

-- ── search_path en funciones custom (excepto register_entity / audit_compliance_document_change) ──
ALTER FUNCTION app.normalize_rut(text) SET search_path = app, pg_catalog;
ALTER FUNCTION app.rut_dv(text) SET search_path = app, pg_catalog;
ALTER FUNCTION app.set_updated_at() SET search_path = app, pg_catalog;
ALTER FUNCTION app.protect_manual_overrides() SET search_path = app, pg_catalog;
ALTER FUNCTION app.protect_manual_edits() SET search_path = app, pg_catalog;
ALTER FUNCTION app.audit_insurance_installment_change() SET search_path = app, pg_catalog;
ALTER FUNCTION silver.parse_centralizer_date(text) SET search_path = silver, pg_catalog;
ALTER FUNCTION silver.parse_insurance_date(text) SET search_path = silver, pg_catalog;
ALTER FUNCTION silver.map_doc_status(text) SET search_path = silver, pg_catalog;

-- ── consolidar RLS _read/_write duplicadas ──────────────────────────────────

-- client_document_requirements (write: admin/owner)
DROP POLICY IF EXISTS client_document_requirements_read ON app.client_document_requirements;
DROP POLICY IF EXISTS client_document_requirements_write ON app.client_document_requirements;

CREATE POLICY client_document_requirements_select ON app.client_document_requirements
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY client_document_requirements_insert ON app.client_document_requirements
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY client_document_requirements_update ON app.client_document_requirements
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY client_document_requirements_delete ON app.client_document_requirements
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'));

-- compliance_doc_catalog (write: admin/owner)
DROP POLICY IF EXISTS compliance_doc_catalog_read ON app.compliance_doc_catalog;
DROP POLICY IF EXISTS compliance_doc_catalog_write ON app.compliance_doc_catalog;

CREATE POLICY compliance_doc_catalog_select ON app.compliance_doc_catalog
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY compliance_doc_catalog_insert ON app.compliance_doc_catalog
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY compliance_doc_catalog_update ON app.compliance_doc_catalog
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY compliance_doc_catalog_delete ON app.compliance_doc_catalog
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'));

-- sync_config (write: admin/owner)
DROP POLICY IF EXISTS sync_config_read ON app.sync_config;
DROP POLICY IF EXISTS sync_config_write ON app.sync_config;

CREATE POLICY sync_config_select ON app.sync_config
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY sync_config_insert ON app.sync_config
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY sync_config_update ON app.sync_config
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY sync_config_delete ON app.sync_config
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'));

-- transporter_contacts (write: editor/admin/owner — distinto de los otros 3)
DROP POLICY IF EXISTS transporter_contacts_read ON app.transporter_contacts;
DROP POLICY IF EXISTS transporter_contacts_write ON app.transporter_contacts;

CREATE POLICY transporter_contacts_select ON app.transporter_contacts
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY transporter_contacts_insert ON app.transporter_contacts
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY transporter_contacts_update ON app.transporter_contacts
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY transporter_contacts_delete ON app.transporter_contacts
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'));
