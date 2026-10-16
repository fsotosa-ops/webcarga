-- Configuración, Parte 1 (expandir): la API deja de recibir colores por fila; el
-- tono sale de la columna del tablero (frontend lib/states.ts). Mientras las
-- columnas existan, el alta de un vocabulario las llena con el default que antes
-- mandaba el schema (StatusTaxonomyBody). La contracción
-- (20261024090000_retire_catalog_colors.sql) las borra. Solo agrega.
ALTER TABLE app.status_taxonomies
    ALTER COLUMN bg_color   SET DEFAULT '#f3f4f6',
    ALTER COLUMN text_color SET DEFAULT '#374151';
