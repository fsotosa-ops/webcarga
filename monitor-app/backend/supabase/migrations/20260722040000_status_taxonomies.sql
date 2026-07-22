-- Ronda 43: unifica app.operational_states + app.unassigned_reasons en una
-- sola taxonomía configurable, y agrega el dominio EQUIPMENT_STATE nuevo
-- (spec docs/superpowers/specs/2026-07-22-status-taxonomies-design.md).
-- Las tablas viejas NO se borran acá — ver migración de limpieza separada,
-- aplicada solo después de confirmar que nada quedó apuntando a ellas.
--
-- NOTA (revisión en vivo antes de aplicar, 2026-07-22): la versión original
-- de esta migración reapuntaba unassigned_reason_id con un mapeo viejo-id→
-- nuevo-id (ADD/UPDATE/DROP/RENAME) para preservar datos históricos.
-- Verificado contra producción antes de escribir esta versión: trips/
-- trips_manual/driver_day_status tienen 0 filas con unassigned_reason_id
-- no-nulo hoy — no hay nada que remapear, así que el cambio de tipo es un
-- ALTER COLUMN TYPE directo (más simple, mismo resultado).
--
-- app.trips es un modelo dbt (dbt/tms/models/app/trips.sql, pipeline
-- batch_tms_monitor_trips en Mage) que hace MERGE incremental sobre esta
-- tabla y lee app.trips_manual en un UNION ALL. Ese modelo fue actualizado
-- en Mage en el mismo cambio (NULL::text → NULL::uuid en la rama TMS) antes
-- de aplicar esta migración — sin ese ajuste, la próxima corrida del
-- pipeline rompe por mismatch de tipos en el UNION ALL (mismo patrón que
-- causó el incidente de app.trips congelada 13 días en 2026-06-18).

CREATE TABLE app.status_taxonomies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      text NOT NULL CHECK (domain IN ('OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE')),
  label       text NOT NULL,
  bg_color    text NOT NULL,
  text_color  text NOT NULL,
  -- Solo tiene sentido para OPERATIONAL_STATE (columna del tablero) — NULL
  -- en los otros 2 dominios.
  group_id    text,
  -- Correlación fija con una alerta ya calculada (compliance_records) para
  -- sugerir este motivo en la UI de cuadratura — NULL en casi todas las
  -- filas, poblado solo en la semilla "Documentación vencida".
  suggested_alert_source text,
  sort_order  integer NOT NULL DEFAULT 99,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_status_taxonomies_domain ON app.status_taxonomies (domain, sort_order) WHERE active;

ALTER TABLE app.status_taxonomies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Status taxonomies are viewable by authenticated users" ON app.status_taxonomies;
CREATE POLICY "Status taxonomies are viewable by authenticated users" ON app.status_taxonomies FOR SELECT TO authenticated USING (true);

-- 1. Vuelca operational_states (uuid → mismo uuid, no rompe nada que lo
--    referencie — verificado que ninguna FK real apunta a esta tabla, solo
--    se lee).
INSERT INTO app.status_taxonomies (id, domain, label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at)
SELECT id, 'OPERATIONAL_STATE', label, bg_color, text_color, group_id, sort_order, active, created_at, updated_at
FROM app.operational_states;

-- 2. Vuelca unassigned_reasons con ids uuid nuevos (sin mapeo — 0 filas
--    reales referencian los ids viejos hoy en trips/trips_manual/
--    driver_day_status, verificado antes de aplicar).
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active)
SELECT 'DRIVER_REASON', label, '#f3f4f6', '#374151', sort_order, active
FROM app.unassigned_reasons;

-- 3. app.trips.unassigned_reason_id: text → uuid (sin backfill, 0 filas
--    no-nulas hoy), reapunta la FK a status_taxonomies. Requiere que el
--    modelo dbt de Mage ya haya sido actualizado (ver nota arriba).
ALTER TABLE app.trips DROP CONSTRAINT trips_unassigned_reason_id_fkey;
ALTER TABLE app.trips ALTER COLUMN unassigned_reason_id TYPE uuid USING NULL::uuid;
ALTER TABLE app.trips ADD CONSTRAINT trips_unassigned_reason_id_fkey
  FOREIGN KEY (unassigned_reason_id) REFERENCES app.status_taxonomies(id);

-- 4. app.trips_manual — mismo tratamiento (nunca escrita por dbt, solo
--    leída en el UNION ALL del modelo — igual debe coincidir el tipo).
ALTER TABLE app.trips_manual DROP CONSTRAINT trips_manual_unassigned_reason_id_fkey;
ALTER TABLE app.trips_manual ALTER COLUMN unassigned_reason_id TYPE uuid USING NULL::uuid;
ALTER TABLE app.trips_manual ADD CONSTRAINT trips_manual_unassigned_reason_id_fkey
  FOREIGN KEY (unassigned_reason_id) REFERENCES app.status_taxonomies(id);

-- 5. app.driver_day_status — mismo tratamiento (esta es la tabla real de la
--    cuadratura diaria; sin dependencia del pipeline de Mage).
ALTER TABLE app.driver_day_status DROP CONSTRAINT driver_day_status_unassigned_reason_id_fkey;
ALTER TABLE app.driver_day_status ALTER COLUMN unassigned_reason_id TYPE uuid USING NULL::uuid;
ALTER TABLE app.driver_day_status ADD CONSTRAINT driver_day_status_unassigned_reason_id_fkey
  FOREIGN KEY (unassigned_reason_id) REFERENCES app.status_taxonomies(id);

-- 6. Semillas nuevas de EQUIPMENT_STATE (estándar de industria fleet/TMS).
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active) VALUES
  ('EQUIPMENT_STATE', 'Disponible',                    '#f0fdf4', '#166534', 1, true),
  ('EQUIPMENT_STATE', 'En Mantención',                  '#fef9c3', '#854d0e', 2, true),
  ('EQUIPMENT_STATE', 'En Pana / Fuera de Servicio',     '#fef2f2', '#b91c1c', 3, true),
  ('EQUIPMENT_STATE', 'Prestado a otra empresa',         '#eff6ff', '#1d4ed8', 4, true),
  ('EQUIPMENT_STATE', 'Sin Conductor Asignado',          '#f3f4f6', '#374151', 5, true),
  ('EQUIPMENT_STATE', 'Descanso Programado',             '#f5f3ff', '#6d28d9', 6, true);

-- 7. Semillas ampliadas de DRIVER_REASON — variantes documentales, una con
--    la correlación de sugerencia (Tarea 5/8).
INSERT INTO app.status_taxonomies (domain, label, bg_color, text_color, sort_order, active, suggested_alert_source) VALUES
  ('DRIVER_REASON', 'Documentación vencida', '#fef2f2', '#b91c1c', 7, true, 'compliance_expired'),
  ('DRIVER_REASON', 'Licencia vencida',      '#fef2f2', '#b91c1c', 8, true, NULL);
