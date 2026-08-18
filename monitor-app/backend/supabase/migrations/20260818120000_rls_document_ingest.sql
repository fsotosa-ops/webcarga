-- RLS en las tres tablas de ingesta documental que se crearon sin él.
--
-- Qué pasó
-- --------
-- `20260814130000_document_ingest_model.sql`,
-- `20260814130100_seed_requirement_filename_aliases.sql` y
-- `20260815100000_ingest_items_carrier_override.sql` crearon estas tablas en
-- `public` sin `ENABLE ROW LEVEL SECURITY`. El linter de Supabase lo reporta
-- como `rls_disabled_in_public`, nivel ERROR.
--
-- Por qué importa de verdad, y no es una advertencia cosmética
-- -----------------------------------------------------------
-- Supabase concede por defecto a `anon` y `authenticated` todos los permisos
-- de DML sobre las tablas de `public`. Lo que neutraliza esa concesión en el
-- resto del proyecto NO son los permisos —siguen ahí, verificado sobre
-- information_schema.role_table_grants: `drivers` y `compliance_records`
-- también los tienen— sino tener RLS activo SIN políticas, que niega todo.
--
-- Estas tres se saltaron ese paso, así que la concesión quedó viva: con la
-- clave `anon` —que viaja en el bundle del frontend, por diseño— se podía
-- SELECT, INSERT, UPDATE, DELETE y TRUNCATE sobre ellas vía PostgREST.
--
-- Por qué no rompe nada
-- ---------------------
-- - El frontend nunca las consulta directo: pasa por la API (verificado).
-- - La API se conecta con asyncpg usando DATABASE_URL, como dueña de la base,
--   y el dueño de la tabla NO está sujeto a RLS. Sus consultas no cambian.
--
-- Sin políticas, a propósito: es exactamente la postura del resto del
-- proyecto — la base se lee y escribe por la API, no por PostgREST.

ALTER TABLE public.document_ingest_batches      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_ingest_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requirement_filename_aliases ENABLE ROW LEVEL SECURITY;
