-- ==============================================================================
-- MIGRACIÓN: PRIMARY KEYS + ÍNDICES FUNCIONALES
-- Aprobada 2026-05-27: mejora performance de escritura y búsqueda en app.trips
-- ==============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Primary Keys (permite heap-only-tuple updates + PK constraint explícita)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.trips ADD PRIMARY KEY (id);
ALTER TABLE app.transporter_profiles ADD PRIMARY KEY (id);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Índices funcionales sobre JSONB fleet (soportan búsqueda por patente/RUT/nombre)
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_trips_fleet_plate      ON app.trips ((fleet->>'tractor_plate'));
CREATE INDEX IF NOT EXISTS idx_trips_fleet_rut        ON app.trips ((fleet->>'driver_rut_tms'));
CREATE INDEX IF NOT EXISTS idx_trips_fleet_driver     ON app.trips ((fleet->>'driver_name_tms'));

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Índices estándar para filtros frecuentes del API
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_trips_planning_date    ON app.trips (planning_date);
CREATE INDEX IF NOT EXISTS idx_trips_status_tms       ON app.trips (current_status_tms);
CREATE INDEX IF NOT EXISTS idx_trips_fleet_link_id    ON app.trips (fleet_link_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. FK: trip_fleet_links.trip_id → app.trips(id)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.trip_fleet_links
  ADD CONSTRAINT fk_fleet_links_trip
  FOREIGN KEY (trip_id) REFERENCES app.trips(id);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Índice sobre FK no indexada en transporter_profiles
-- ────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tp_edited_by ON app.transporter_profiles (edited_by);
