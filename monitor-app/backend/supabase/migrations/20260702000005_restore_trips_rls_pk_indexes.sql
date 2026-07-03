-- ==============================================================================
-- RESTAURA RLS + PK + ÍNDICES EN app.trips
--
-- Perdidos de nuevo (RLS deshabilitada, sin PK, sin índices) — mismo patrón
-- recurrente documentado en sesiones anteriores, consistente con que un
-- `dbt --full-refresh` recrea la tabla física y descarta protecciones no
-- definidas en el propio modelo dbt. Mismo paquete que se aplicó la última
-- vez (migración 20260618000001_security_critical.sql), actualizado a la
-- nomenclatura vigente (current_status_tms -> trip_status, tras el rename
-- del 2026-07-02 en 20260702000003_rename_app_trips_columns.sql).
--
-- Verificado antes de aplicar: 2320 filas, 2320 ids distintos, 0 nulos —
-- sin riesgo de conflicto al agregar la PK.
--
-- Aplicado directamente en Supabase (viclzoftiudkepqnhekv) el 2026-07-02;
-- este archivo documenta el cambio en el historial de migraciones del repo.
-- ==============================================================================

ALTER TABLE app.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips_read" ON app.trips
  FOR SELECT TO authenticated USING (true);

ALTER TABLE app.trips ADD PRIMARY KEY (id);

CREATE INDEX idx_trips_planning_date ON app.trips (planning_date);
CREATE INDEX idx_trips_status       ON app.trips (trip_status);
CREATE INDEX idx_trips_fleet_link   ON app.trips (fleet_link_id);
CREATE INDEX idx_trips_fleet_plate  ON app.trips ((fleet->>'tractor_plate'));
CREATE INDEX idx_trips_fleet_driver ON app.trips ((fleet->>'driver_name_tms'));
CREATE INDEX idx_trips_fleet_rut    ON app.trips ((fleet->>'driver_rut_tms'));
