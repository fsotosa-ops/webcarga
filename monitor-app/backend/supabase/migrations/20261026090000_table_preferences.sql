-- Preferencias de tabla por persona (Cierre con un solo patrón, 2026-10-16, spec §4.3):
-- qué columnas ve cada persona y en qué orden, por tabla. En la base y no en el
-- navegador para que sea de la persona y no del equipo, con el mismo precedente que
-- app.filter_groups (los grupos del Monitor).
CREATE TABLE IF NOT EXISTS app.table_preferences (
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    table_key  text NOT NULL CHECK (table_key ~ '^[a-z0-9_.-]{1,64}$'),
    columns    jsonb NOT NULL CHECK (jsonb_typeof(columns) = 'array'),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, table_key)
);

COMMENT ON TABLE app.table_preferences IS
  'Columnas visibles y su orden por persona y por tabla: [{"id": "...", "hidden": bool}]. La escribe solo la API.';

-- Solo la API (rol de servicio) la lee y la escribe, como el resto de app.*.
REVOKE ALL ON app.table_preferences FROM anon, authenticated;
