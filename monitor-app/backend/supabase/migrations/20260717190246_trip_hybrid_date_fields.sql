-- Campos híbridos editables del Diario (esquema de fechas 2026-07-17):
-- Carga Inicio/Fin (origen, sin equivalente TMS) y override manual de
-- Desc. Inicio/Fin por parada. unload_start/unload_end SÍ vienen del TMS
-- dentro del jsonb `stops`, que se sobrescribe completo en cada corrida del
-- pipeline dbt (no está en merge_exclude_columns) — por eso el override
-- manual vive en una columna separada y protegida, mergeado en runtime por
-- la API (GET /trips, GET /trips/{id}), nunca tocado por el pipeline porque
-- no forma parte del SELECT del modelo dbt.
ALTER TABLE app.trips ADD COLUMN IF NOT EXISTS cag_inicio timestamptz;
ALTER TABLE app.trips ADD COLUMN IF NOT EXISTS cag_fin timestamptz;
ALTER TABLE app.trips ADD COLUMN IF NOT EXISTS stop_manual_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN app.trips.cag_inicio IS 'Carga Inicio (origen) — campo editable desde el Diario, sin equivalente TMS.';
COMMENT ON COLUMN app.trips.cag_fin IS 'Carga Fin (origen) — campo editable desde el Diario, sin equivalente TMS.';
COMMENT ON COLUMN app.trips.stop_manual_fields IS 'Override manual de desc_inicio/desc_fin por parada, keyed por stop_id: {"<stop_id>": {"desc_inicio": iso, "desc_fin": iso}}. Fuera de stops (jsonb) porque ese campo se sobrescribe completo en cada corrida del pipeline dbt.';
