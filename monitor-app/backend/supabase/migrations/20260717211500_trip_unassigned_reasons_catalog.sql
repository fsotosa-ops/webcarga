-- Fase 1.5d: catálogo configurable de "motivo de no asignación", en vez de
-- valores hardcodeados en frontend — mismo patrón que app.trip_statuses /
-- app.temperature_ranges (id/label/sort_order/active).
CREATE TABLE app.unassigned_reasons (
  id         text PRIMARY KEY,
  label      text NOT NULL,
  sort_order integer NOT NULL DEFAULT 99,
  active     boolean NOT NULL DEFAULT true
);

INSERT INTO app.unassigned_reasons (id, label, sort_order) VALUES
  ('pana',           'Pana',            1),
  ('mantencion',     'Mantención',      2),
  ('sin_conductor',  'Sin conductor',   3),
  ('no_presentado',  'No se presentó',  4),
  ('medico',         'Médico',          5),
  ('abstencion',     'En abstención',   6);

ALTER TABLE app.trips
  ADD COLUMN unassigned_reason_id text REFERENCES app.unassigned_reasons(id);

ALTER TABLE app.trips_manual
  ADD COLUMN unassigned_reason_id text REFERENCES app.unassigned_reasons(id);
