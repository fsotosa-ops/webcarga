-- Señal "Ya no está en el TMS" (Ronda 126).
--
-- Cuántas horas puede seguir corriendo una TMS sin traer un viaje antes de
-- que el Monitor lo marque. El viaje se compara contra la ÚLTIMA CORRIDA de
-- su propia TMS (max(status_reported_at) de esa fuente), no contra now() —
-- esa es la diferencia con `stale_report_hours`, que se enciende igual
-- cuando el que está caído es nuestro scraper.
--
-- Verificado en vivo el 2026-08-18: app.trips.status_reported_at es
-- exactamente el file_generated_at del archivo que trajo al viaje (8/8 filas
-- de Sodimac calzan contra bronze.tms_trips_snapshot), así que el máximo por
-- fuente ES el instante de su última lectura del portal.
--
-- POR QUÉ ES CONFIGURABLE Y NO UNA CONSTANTE: el criterio de cuándo una
-- ausencia cuenta como baja es una definición de negocio que operaciones
-- todavía no cerró (GitHub issue #3 — Fabián y Pablo). El valor de partida
-- es 3 horas, elegido por el usuario el 2026-08-18. Moverlo se hace desde
-- Configuración → Umbrales, sin desplegar.
--
-- Contexto: Sodimac elimina viajes de su TMS sin cambiar el estado, y hoy
-- eso no queda registrado en ninguna parte — bronze.tms_trips es un UPSERT
-- que nunca resta, así que el `invalidate_hard_deletes` del snapshot nunca
-- se dispara (396 viajes Sodimac, 396 versiones vigentes, 0 bajas). Esta
-- señal es la primera vez que la ausencia se hace visible.

ALTER TABLE app.monitor_alert_rules
  ADD COLUMN IF NOT EXISTS tms_dropped_hours numeric NOT NULL DEFAULT 3;
