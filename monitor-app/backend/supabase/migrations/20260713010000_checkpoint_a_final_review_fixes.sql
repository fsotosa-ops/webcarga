-- ==============================================================================
-- CHECKPOINT A — Revisión final: fixes de los 4 hallazgos del review de todo
-- el branch (ad2726e..5b694f9). No destructivo — solo RLS, un índice y un
-- rol de policy.
--
-- 1. (Important) Consolidar RLS en las 3 tablas nuevas de documentos
--    (transporter_documents, driver_documents, vehicle_documents). Mismo
--    patrón _read/_write que Task 5 (20260712130005_hygiene_search_path_rls.sql)
--    ya consolidó en client_document_requirements, compliance_doc_catalog,
--    sync_config y transporter_contacts — esas 3 tablas quedaron
--    explícitamente fuera de Task 5 por scope, quedando como deuda anotada.
--    Se verificó pg_policies en vivo antes de escribir esto: los 3 pares
--    _read/_write son idénticos entre sí — "_read" es FOR SELECT USING
--    (true) TO authenticated, y "_write" es FOR ALL TO authenticated con
--    qual = with_check = current_user_role() IN ('editor','admin','owner').
--    Se aplica la misma descomposición _select/_insert/_update/_delete.
--
-- 2. (Minor) Índice de cobertura para la FK nueva
--    app.transporters.last_matched_upload_id -> app.centralizer_uploads(id).
--
-- 3. (Minor) centralizer_uploads_all apuntaba a role "public" en vez de
--    "authenticated", inconsistente con sus policies hermanas (_insert,
--    _update) que ya fueron corregidas a "authenticated" en un task previo
--    de este checkpoint. Defense-in-depth: anon ya resuelve
--    current_user_role() a NULL, así que esto no cambia comportamiento real,
--    solo consistencia de definición.
--
-- 4. (Minor) Cosmético: un task previo llamó a la tool apply_migration con
--    un nombre de archivo completo en vez de un slug para el parámetro
--    `name`. No tiene efecto funcional y no es corregible retroactivamente
--    vía una migración nueva — no requiere acción acá.
-- ==============================================================================

-- ── 1. Consolidar RLS en transporter_documents / driver_documents / vehicle_documents ──

-- transporter_documents (write: editor/admin/owner)
DROP POLICY IF EXISTS transporter_documents_read ON app.transporter_documents;
DROP POLICY IF EXISTS transporter_documents_write ON app.transporter_documents;

CREATE POLICY transporter_documents_select ON app.transporter_documents
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY transporter_documents_insert ON app.transporter_documents
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY transporter_documents_update ON app.transporter_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY transporter_documents_delete ON app.transporter_documents
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- driver_documents (write: editor/admin/owner)
DROP POLICY IF EXISTS driver_documents_read ON app.driver_documents;
DROP POLICY IF EXISTS driver_documents_write ON app.driver_documents;

CREATE POLICY driver_documents_select ON app.driver_documents
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY driver_documents_insert ON app.driver_documents
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY driver_documents_update ON app.driver_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY driver_documents_delete ON app.driver_documents
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- vehicle_documents (write: editor/admin/owner)
DROP POLICY IF EXISTS vehicle_documents_read ON app.vehicle_documents;
DROP POLICY IF EXISTS vehicle_documents_write ON app.vehicle_documents;

CREATE POLICY vehicle_documents_select ON app.vehicle_documents
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY vehicle_documents_insert ON app.vehicle_documents
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY vehicle_documents_update ON app.vehicle_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY vehicle_documents_delete ON app.vehicle_documents
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- ── 2. Índice de cobertura para la FK last_matched_upload_id ──────────────────

CREATE INDEX IF NOT EXISTS idx_transporters_last_matched_upload_id
  ON app.transporters(last_matched_upload_id);

-- ── 3. centralizer_uploads_all: alinear role a authenticated ─────────────────

DROP POLICY IF EXISTS centralizer_uploads_all ON app.centralizer_uploads;

CREATE POLICY centralizer_uploads_all ON app.centralizer_uploads
  FOR SELECT TO authenticated
  USING (app.current_user_role() IS NOT NULL);
