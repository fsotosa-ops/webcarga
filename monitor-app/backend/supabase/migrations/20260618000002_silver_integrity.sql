-- ==============================================================================
-- MIGRACIÓN: INTEGRIDAD SILVER + ÍNDICES BRONZE SNAPSHOT
-- Resultado de auditoría live DB 2026-06-18
-- Tablas gestionadas por dbt: índices en lugar de PKs para compatibilidad con full-refresh
-- ==============================================================================

-- ── 1. silver.tms_trips: índices para queries del API ────────────────────────
-- 3,646 filas, 0 índices → full scan en cada query
CREATE UNIQUE INDEX IF NOT EXISTS idx_silver_trips_status_id
  ON silver.tms_trips (status_id);

CREATE INDEX IF NOT EXISTS idx_silver_trips_otm_id
  ON silver.tms_trips (otm_id);

CREATE INDEX IF NOT EXISTS idx_silver_trips_date
  ON silver.tms_trips (planning_date);

CREATE INDEX IF NOT EXISTS idx_silver_trips_client
  ON silver.tms_trips (tms_name, client_name);

CREATE INDEX IF NOT EXISTS idx_silver_trips_status
  ON silver.tms_trips (status);

-- ── 2. silver.tms_milestone_trips: índices SCD ───────────────────────────────
-- 2,410 filas, 0 índices → queries de "estado actual de viaje" hacen full scan

-- Unicidad de la clave SCD (trip_stop_sk, ventana de tiempo)
CREATE UNIQUE INDEX IF NOT EXISTS idx_milestone_unique
  ON silver.tms_milestone_trips (trip_stop_sk, dbt_valid_from)
  WHERE trip_stop_sk IS NOT NULL AND dbt_valid_from IS NOT NULL;

-- Índice parcial para queries de "versión vigente" (el más frecuente)
CREATE INDEX IF NOT EXISTS idx_milestone_current
  ON silver.tms_milestone_trips (trip_stop_sk)
  WHERE dbt_valid_to IS NULL;

CREATE INDEX IF NOT EXISTS idx_milestone_otm_id
  ON silver.tms_milestone_trips (otm_id);

CREATE INDEX IF NOT EXISTS idx_milestone_file_dt
  ON silver.tms_milestone_trips (file_generated_at);

-- ── 3. bronze.raw_tms_trips_snapshot: índice de unicidad en dbt_scd_id ───────
-- Nota: este índice se perderá si se hace dbt snapshot --full-refresh
-- Agregar como post-hook en dbt después del full-refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshot_scd_id
  ON bronze.raw_tms_trips_snapshot (dbt_scd_id);

-- Índice para queries por trip_sk (para joins con silver)
CREATE INDEX IF NOT EXISTS idx_snapshot_trip_sk
  ON bronze.raw_tms_trips_snapshot (trip_sk);

-- Índice para queries de "versión actual" (siempre dbt_valid_to IS NULL con diseño actual)
CREATE INDEX IF NOT EXISTS idx_snapshot_current
  ON bronze.raw_tms_trips_snapshot (trip_sk, file_generated_at)
  WHERE dbt_valid_to IS NULL;

-- ── 4. Drop índice nunca usado (confirmado por Supabase Advisor) ──────────────
DROP INDEX IF EXISTS app.idx_operational_states_active;
