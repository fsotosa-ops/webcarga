CREATE TABLE app.centralizer_column_mappings (
  sheet_name text NOT NULL CHECK (sheet_name IN ('Empresas', 'Conductores', 'Vehiculos_Equipos')),
  excel_header text NOT NULL,
  doc_code text,  -- NULL = ignorar esta columna permanentemente
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sheet_name, excel_header)
);

COMMENT ON TABLE app.centralizer_column_mappings IS
  'Resoluciones guardadas de columnas del Excel EETT que no estaban en el '
  'mapeo estático de centralizer_parser.py — evita que una columna nueva '
  'bloquee uploads futuros con el mismo header.';
