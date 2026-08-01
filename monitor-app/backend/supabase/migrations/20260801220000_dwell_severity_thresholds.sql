-- Hito 14 (minuta 29/07 §4.4): semáforo de tiempo en el local activo,
-- 4 niveles (verde <1h, amarillo 1h, naranja 1h30, rojo ≥2h). Reemplaza al
-- badge "Sin seguimiento"/"hace X hrs" en la fila del Diario. Umbrales en
-- minutos (no horas), mismo criterio que late_arrival_grace_min — editable
-- desde Configuración → Alertas del Monitor.
ALTER TABLE app.monitor_alert_rules
  ADD COLUMN dwell_yellow_min int NOT NULL DEFAULT 60,
  ADD COLUMN dwell_orange_min int NOT NULL DEFAULT 90,
  ADD COLUMN dwell_red_min    int NOT NULL DEFAULT 120;
