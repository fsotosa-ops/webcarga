-- ==============================================================================
-- MIGRACIÓN: RANGOS DE TEMPERATURA EDITABLES POR TIPO DE CARGA
-- app.temperature_ranges
--
-- cargo_type es texto libre sin normalizar (viene crudo de cada TMS: qanalytics,
-- wingsuite, sodimac). No hay catálogo cerrado, así que la clave es el propio
-- valor de cargo_type y el admin crea una fila por cada valor que le importe
-- clasificar. Viajes sin fila configurada quedan sin clasificar (sin chip).
-- ==============================================================================

CREATE TABLE app.temperature_ranges (
  cargo_type text         PRIMARY KEY,
  label      text         NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 60),
  min_c      numeric(5,2) NOT NULL,
  max_c      numeric(5,2) NOT NULL,
  CHECK (min_c <= max_c)
);

-- Accedida exclusivamente a través del backend FastAPI (service_role bypasses RLS).
-- RLS habilitada como defensa en profundidad, igual que trip_statuses/alert_thresholds.
ALTER TABLE app.temperature_ranges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "temperature_ranges_read"
  ON app.temperature_ranges FOR SELECT USING (true);
