-- D4 de la minuta del 02/10 (Ronda 166): reconciliación diaria con el TMS.
--
-- Los scrapers de 15 minutos bajan una ventana corta por fecha de planificación;
-- un viaje que sale de ella no se vuelve a ver, ni su cierre ni su eliminación.
-- El pipeline diario `tms_daily_reconciliation` baja el reporte desde el viaje
-- abierto más antiguo y deja acá, crudo, qué viajes trajo el TMS y qué ventana
-- cubrió. Es dato de ingesta, como bronze.ingested_files: no se calcula nada.
--
-- Quién lo lee: silver.stg_tms_presence (dbt), que decide por viaje desde cuándo
-- falta, y de ahí app.trips.tms_missing_since.

CREATE TABLE IF NOT EXISTS bronze.tms_reconciliations (
    file_name      text PRIMARY KEY,               -- gs://... del reporte bajado
    source_system  text        NOT NULL,
    source_client  text        NOT NULL,
    window_from    date        NOT NULL,           -- ventana pedida al TMS
    window_to      date        NOT NULL,
    trip_ids       text[]      NOT NULL,           -- los source_system_trip_id que trajo
    reconciled_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tms_reconciliations_fuente
    ON bronze.tms_reconciliations (source_system, source_client, reconciled_at DESC);

COMMENT ON TABLE bronze.tms_reconciliations IS
  'Una fila por reconciliación diaria con el TMS (Mage tms_daily_reconciliation): '
  'qué viajes trajo el reporte y qué ventana cubrió. Lo lee silver.stg_tms_presence. '
  'Ver migración 20261006130000.';
