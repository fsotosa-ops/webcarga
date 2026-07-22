-- HU-06 (Fase 3, 2026-07-22): fuzzy match de conductor reportado por TMS
-- contra el roster (public.drivers) — ~80% de similitud + confirmación
-- humana, diseño confirmado por Pablo en la reunión del 20/07.
--
-- Nota: esta migración se aplicó en vivo vía apply_migration durante la
-- sesión de Fase 3 pero no se había comiteado como archivo local — se
-- respalda acá ahora para que el repo quede como fuente de verdad real.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA extensions;
CREATE INDEX IF NOT EXISTS idx_drivers_full_name_trgm ON public.drivers USING gin (full_name gin_trgm_ops);
