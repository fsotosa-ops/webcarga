-- D5 de la minuta del 02/10 (Ronda 166): umbral de "viaje entregado sin cierre
-- del TMS".
--
-- Días desde la última entrega en destino tras los cuales un viaje que el TMS
-- dejó abierto (p. ej. RETORNANDO) sale del cierre del día. Sigue en el
-- historial. NULL = no ocultar nada, hasta que WebCarga defina el umbral (tarea
-- B1 de la minuta).
--
-- NOTA DE HISTORIA: la primera versión de esta migración (aplicada el 06/10)
-- creaba también una tabla app.trip_source_absences escrita directo por un
-- bloque de Mage. Se retiró el mismo día (DROP aplicado, estaba vacía y nada la
-- leía) porque se salía del patrón de la app: un hecho del TMS va
-- Mage → bronze → dbt → app. Su reemplazo es bronze.tms_reconciliations
-- (20261006130000) + silver.stg_tms_presence + app.trips.tms_missing_since.

ALTER TABLE app.monitor_alert_rules
    ADD COLUMN IF NOT EXISTS stale_trip_days integer
    CHECK (stale_trip_days IS NULL OR stale_trip_days > 0);
