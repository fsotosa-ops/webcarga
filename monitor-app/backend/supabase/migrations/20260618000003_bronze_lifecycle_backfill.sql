-- ==============================================================================
-- MIGRACIÓN: BRONZE LIFECYCLE BACKFILL + CLEANUP INICIAL
-- Resultado de auditoría live DB 2026-06-18
-- Retención configurada: 60 días para filas PROCESSED
-- Ejecutar en horario de bajo tráfico (puede tardar 30-60s en 900K filas)
-- ==============================================================================

-- ── 1. Backfill: marcar como PROCESSED las filas con más de 30 días ───────────
-- Estas filas ya están incorporadas en silver por corridas anteriores de dbt.
-- Se usa ingestion_timestamp como processed_at para mantener la trazabilidad temporal.
UPDATE bronze.raw_tms_trips
SET
  sync_status  = 'PROCESSED',
  processed_at = ingestion_timestamp
WHERE ingestion_timestamp < NOW() - INTERVAL '30 days'
  AND sync_status = 'PENDING';

-- ── 2. Primera limpieza: borrar filas PROCESSED con más de 60 días ───────────
-- En este primer run probablemente borrará 0 filas (datos desde May 15 solo = 33 días).
-- Comenzará a tener efecto el próximo mes y en adelante.
DELETE FROM bronze.raw_tms_trips
WHERE sync_status = 'PROCESSED'
  AND processed_at < NOW() - INTERVAL '60 days';

-- ── 3. Índices para jobs de limpieza periódica en Mage ───────────────────────
-- Optimizan los dos patrones de acceso del lifecycle:
--   a) UPDATE ... WHERE sync_status='PENDING' (Mage post-dbt)
--   b) DELETE ... WHERE sync_status='PROCESSED' AND processed_at < X (Mage cleanup job)

CREATE INDEX IF NOT EXISTS idx_bronze_pending_lifecycle
  ON bronze.raw_tms_trips (ingestion_timestamp)
  WHERE sync_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_bronze_processed_cleanup
  ON bronze.raw_tms_trips (processed_at)
  WHERE sync_status = 'PROCESSED';
