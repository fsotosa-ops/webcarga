-- ==============================================================================
-- MIGRATION: asset_manufacture_year
-- DESCRIPTION: public.assets no tenía columna de año de fabricación — campo
-- real que existe en la documentación vehicular (padrón/permiso de
-- circulación) pero nunca se pudo registrar desde la UI. Aditiva y nullable,
-- sin backfill (no hay fuente confiable para los ~246 vehículos existentes).
-- ==============================================================================

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS manufacture_year INT;

COMMENT ON COLUMN public.assets.manufacture_year IS
    'Año de fabricación del vehículo (ej. padrón/permiso de circulación) — editable desde la UI, sin fuente automática.';
