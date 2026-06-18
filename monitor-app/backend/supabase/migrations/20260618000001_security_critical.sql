-- ==============================================================================
-- MIGRACIÓN: SEGURIDAD CRÍTICA
-- Resultado de auditoría live DB 2026-06-18
-- Prioridad P0: funciones SECURITY DEFINER expuestas a anon + app.trips sin RLS
-- ==============================================================================

-- ── 1. Revocar EXECUTE en funciones SECURITY DEFINER a rol anon ───────────────
-- safe_update_transporter: callable vía PostgREST sin auth → riesgo de escritura no autenticada
REVOKE EXECUTE ON FUNCTION app.safe_update_transporter(uuid, jsonb) FROM anon;

-- handle_new_user / is_admin: trigger o helper interno, no debe ser callable por anon
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- ── 2. Fix search_path en funciones SECURITY DEFINER ─────────────────────────
-- Previene ataques de schema injection cuando search_path no está fijado
ALTER FUNCTION app.safe_update_transporter(uuid, jsonb) SET search_path = app, public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.is_admin() SET search_path = public;

-- ── 3. RLS + PK + Índices en app.trips ───────────────────────────────────────
-- app.trips tenía: rowsecurity=false, sin PK, 0 índices — tabla operativa principal

ALTER TABLE app.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips_read" ON app.trips
  FOR SELECT TO authenticated USING (true);

ALTER TABLE app.trips ADD PRIMARY KEY (id);

CREATE INDEX idx_trips_planning_date ON app.trips (planning_date);
CREATE INDEX idx_trips_status_tms    ON app.trips (current_status_tms);
CREATE INDEX idx_trips_fleet_link    ON app.trips (fleet_link_id);
CREATE INDEX idx_trips_fleet_plate   ON app.trips ((fleet->>'tractor_plate'));
CREATE INDEX idx_trips_fleet_driver  ON app.trips ((fleet->>'driver_name_tms'));
CREATE INDEX idx_trips_fleet_rut     ON app.trips ((fleet->>'driver_rut_tms'));

-- ── 4. Remover policies de escritura demasiado permisivas en transporter_profiles ──
-- tp_update y tp_write permiten que cualquier usuario autenticado modifique CUALQUIER empresa
-- La escritura debe ir solo vía FastAPI con service_role (que bypassa RLS)
DROP POLICY IF EXISTS tp_update ON app.transporter_profiles;
DROP POLICY IF EXISTS tp_write  ON app.transporter_profiles;

-- ── 5. Fix bronze.raw_tms_trips: agregar policy de lectura ───────────────────
-- RLS estaba habilitado pero sin policies → bloqueaba toda lectura (incluyendo consultas legítimas)
CREATE POLICY "bronze_trips_read" ON bronze.raw_tms_trips
  FOR SELECT TO authenticated USING (true);
