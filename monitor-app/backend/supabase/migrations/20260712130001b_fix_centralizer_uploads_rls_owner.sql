-- Fix de revisión de Checkpoint A Task 1: las políticas de
-- app.centralizer_uploads quedaron con ('admin','editor') / 'admin', sin
-- 'owner' — rompe el patrón ya establecido en
-- 20260710120006_rls_write_policies_role_matrix.sql (EDITOR_ROLES =
-- editor/admin/owner, ADMIN_ROLES = admin/owner, calcado de auth.py).
-- Se reemplazan por la matriz correcta, con WITH CHECK explícito en el
-- UPDATE (consistente con el resto del archivo de referencia).

DROP POLICY IF EXISTS centralizer_uploads_insert ON app.centralizer_uploads;
DROP POLICY IF EXISTS centralizer_uploads_update ON app.centralizer_uploads;

CREATE POLICY centralizer_uploads_insert ON app.centralizer_uploads
  FOR INSERT TO authenticated
  WITH CHECK (app.current_user_role() IN ('editor', 'admin', 'owner'));

CREATE POLICY centralizer_uploads_update ON app.centralizer_uploads
  FOR UPDATE TO authenticated
  USING (app.current_user_role() IN ('admin', 'owner'))
  WITH CHECK (app.current_user_role() IN ('admin', 'owner'));
