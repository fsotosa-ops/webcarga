-- app.centralizer_column_mappings se creó sin RLS (hallazgo de hygiene al
-- verificar contra Supabase real) — mismo patrón que app.centralizer_uploads:
-- lectura abierta a cualquier rol autenticado (el backend la consulta en
-- cada upload/GET independiente del rol), escritura solo admin/owner (solo
-- ellos pueden resolver mapeos vía POST .../column-mappings).
ALTER TABLE app.centralizer_column_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY centralizer_column_mappings_all ON app.centralizer_column_mappings
  FOR SELECT USING (app.current_user_role() IS NOT NULL);

CREATE POLICY centralizer_column_mappings_write ON app.centralizer_column_mappings
  FOR INSERT WITH CHECK (app.current_user_role() = ANY (ARRAY['admin', 'owner']));

CREATE POLICY centralizer_column_mappings_update ON app.centralizer_column_mappings
  FOR UPDATE USING (app.current_user_role() = ANY (ARRAY['admin', 'owner']))
  WITH CHECK (app.current_user_role() = ANY (ARRAY['admin', 'owner']));
