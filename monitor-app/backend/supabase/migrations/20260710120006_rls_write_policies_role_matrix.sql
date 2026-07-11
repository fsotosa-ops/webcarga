-- ==============================================================================
-- AUDITORÍA 2026-07-10 — FASE 6: políticas RLS de escritura (defensa en
-- profundidad).
--
-- Hallazgo: todas las tablas del módulo Empresas/Seguros solo tenían
-- política SELECT — ninguna INSERT/UPDATE/DELETE restringida por rol. El
-- backend (asyncpg con DATABASE_URL) conecta con un rol que bypassea RLS,
-- así que estas políticas NO afectan al backend — su propósito es que
-- cualquier OTRA vía de acceso (cliente Supabase directo con JWT
-- authenticated, PostgREST, un bug futuro) quede sujeta a la MISMA matriz de
-- roles que ya se aplica en el código Python (auth.py: EDITOR_ROLES =
-- editor/admin/owner, ADMIN_ROLES = admin/owner), en vez de depender 100% de
-- que el código nunca tenga un error de autorización.
--
-- Matriz (calcada de los Depends(require_editor/require_admin) reales en
-- routers/transporters.py e insurance.py, no inventada):
--   editor+ : editar transporter/documentos/archivos/pólizas
--   admin+  : transferencias, marcar cuota pagada, eliminar transportista,
--             catálogo de documentos, sync_config
-- ==============================================================================

CREATE OR REPLACE FUNCTION app.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

COMMENT ON FUNCTION app.current_user_role() IS
  'Rol del usuario autenticado (public.profiles.role) para políticas RLS de escritura. Espejo del rol ya validado server-side en auth.py (EDITOR_ROLES/ADMIN_ROLES) — defensa en profundidad, no reemplaza la validación del API.';

-- ── editor+ : transportistas, contactos, documentos, archivos, pólizas ──────
CREATE POLICY "transporters_write" ON app.transporters
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "transporter_contacts_write" ON app.transporter_contacts
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "compliance_documents_write" ON app.compliance_documents
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "stored_files_write" ON app.stored_files
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "insurance_policies_write" ON app.insurance_policies
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "drivers_write" ON app.drivers
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY "vehicles_write" ON app.vehicles
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('editor', 'admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

-- ── admin+ : transferencias, pagos, borrado, catálogo, sync ─────────────────
CREATE POLICY "driver_assignments_write" ON app.driver_assignments
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "vehicle_assignments_write" ON app.vehicle_assignments
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "insurance_installments_write" ON app.insurance_installments
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "transporters_delete" ON app.transporters
  FOR DELETE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "compliance_doc_catalog_write" ON app.compliance_doc_catalog
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "client_document_requirements_write" ON app.client_document_requirements
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "sync_config_write" ON app.sync_config
  FOR ALL TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));

CREATE POLICY "audit_log_write" ON app.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));
