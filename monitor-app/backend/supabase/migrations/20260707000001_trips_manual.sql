-- ==============================================================================
-- MIGRACIÓN: VIAJES MANUALES PERSISTENTES + RE-PROTECCIÓN DE app.trips
--
-- Problema auditado (2026-07-06): los viajes manuales viven solo en app.trips,
-- y `dbt run --select trips --full-refresh` (el comando real del pipeline)
-- DROPea y recrea esa tabla — los borra todos. Además la recreación descarta
-- PK/RLS/índices/defaults (6ta ocurrencia verificada: hoy id es nullable y
-- sin default, RLS off, 0 índices).
--
-- Solución:
-- 1. app.trips_manual — fuente de verdad de los viajes manuales, con defaults
--    correctos. La API escribe acá y espeja en app.trips (mismo id). El modelo
--    dbt (app_trips.sql) agrega una rama UNION que reconstruye estos viajes en
--    cada full-refresh (anti-join contra la rama TMS para no duplicar viajes
--    reconciliados).
-- 2. origin_tms en ambas tablas — separa el canal de ingreso (source_system=
--    'manual') del sistema de origen del viaje: un TMS mapeado (permite
--    reconciliación automática vía id canónico md5), un TMS no integrado
--    (texto libre), o ninguno (operadores sin TMS).
-- 3. Re-aplica las protecciones perdidas de app.trips (mismo paquete que
--    20260702000005).
-- ==============================================================================

-- ── 1. Fuente de verdad de viajes manuales ────────────────────────────────────

CREATE TABLE app.trips_manual (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system          text        NOT NULL DEFAULT 'manual',
  origin_tms             text,
  source_system_trip_id  text,
  client_name            text,
  planning_date          date        NOT NULL,
  origin                 text,
  cargo_type             text,
  trip_status            text,
  estado_manual          text,
  fleet                  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  stops                  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  activo                 boolean     NOT NULL DEFAULT true,
  trabajando             boolean     NOT NULL DEFAULT false,
  asignado               boolean     NOT NULL DEFAULT false,
  primera_vuelta         boolean     NOT NULL DEFAULT false,
  observaciones          text,
  comentarios            text,
  fleet_link_id          uuid,
  manually_edited_fields text[]      NOT NULL DEFAULT '{}',
  created_by             uuid        REFERENCES public.profiles(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Anti-duplicado: un mismo viaje (sistema de origen + cliente + id externo)
-- solo puede registrarse una vez. Viajes sin id externo no participan.
CREATE UNIQUE INDEX trips_manual_dedup_idx
  ON app.trips_manual (COALESCE(origin_tms, ''), COALESCE(client_name, ''), source_system_trip_id)
  WHERE source_system_trip_id IS NOT NULL;

CREATE INDEX trips_manual_planning_idx ON app.trips_manual (planning_date);

ALTER TABLE app.trips_manual ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips_manual_read"
  ON app.trips_manual FOR SELECT USING (true);

-- ── 2. Sistema de origen en la tabla de lectura ──────────────────────────────

ALTER TABLE app.trips ADD COLUMN IF NOT EXISTS origin_tms text;

-- ── 3. Re-protección de app.trips (paquete de 20260702000005, idempotente) ───

ALTER TABLE app.trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trips_read" ON app.trips;
CREATE POLICY "trips_read" ON app.trips
  FOR SELECT TO authenticated USING (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'app' AND table_name = 'trips' AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE app.trips ADD PRIMARY KEY (id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_trips_planning_date ON app.trips (planning_date);
CREATE INDEX IF NOT EXISTS idx_trips_status        ON app.trips (trip_status);
CREATE INDEX IF NOT EXISTS idx_trips_fleet_link    ON app.trips (fleet_link_id);
CREATE INDEX IF NOT EXISTS idx_trips_fleet_plate   ON app.trips ((fleet->>'tractor_plate'));
CREATE INDEX IF NOT EXISTS idx_trips_fleet_driver  ON app.trips ((fleet->>'driver_name_tms'));
CREATE INDEX IF NOT EXISTS idx_trips_fleet_rut     ON app.trips ((fleet->>'driver_rut_tms'));
