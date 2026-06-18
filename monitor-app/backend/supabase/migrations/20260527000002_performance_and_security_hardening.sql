-- ==============================================================================
-- MIGRACIÓN: PERFORMANCE & SECURITY HARDENING
-- Resultado de auditoría Supabase Advisor 2026-05-27
-- ==============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. RLS en tablas de app sin protección
--    Escritura solo vía service_role (pipeline/FastAPI); lectura autenticada.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.trips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trips_read_authenticated" ON app.trips
  FOR SELECT TO authenticated USING (true);

ALTER TABLE app.trip_fleet_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fleet_links_read_authenticated" ON app.trip_fleet_links
  FOR SELECT TO authenticated USING (true);

ALTER TABLE app.trip_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trip_events_read_authenticated" ON app.trip_events
  FOR SELECT TO authenticated USING (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Primary Keys faltantes en tablas centrales de la app
--    Necesarias para heap-only-tuple updates y performance de escritura.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE app.trips ADD PRIMARY KEY (id);
ALTER TABLE app.transporter_profiles ADD PRIMARY KEY (id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Fix RLS auth.uid() re-evaluation en public.profiles
--    Reemplazar llamada directa por subquery para evaluación por-query, no por-fila.
-- ────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS self_select ON public.profiles;
CREATE POLICY self_select ON public.profiles
  FOR SELECT USING ((select auth.uid()) = id);

DROP POLICY IF EXISTS self_update ON public.profiles;
CREATE POLICY self_update ON public.profiles
  FOR UPDATE USING ((select auth.uid()) = id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Seguridad: revocar EXECUTE en safe_update_transporter para rol anon
--    La función es SECURITY DEFINER y no debe ser ejecutable sin autenticación.
-- ────────────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION app.safe_update_transporter(uuid, jsonb) FROM anon;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. v_compliance_alerts: cambiar a SECURITY INVOKER
--    Evita que la vista ejecute como su creador y bypassee RLS del consultante.
-- ────────────────────────────────────────────────────────────────────────────

ALTER VIEW app.v_compliance_alerts SET (security_invoker = true);

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Eliminar índices nunca usados
--    Reducen overhead en escrituras sin beneficiar ninguna query.
-- ────────────────────────────────────────────────────────────────────────────

-- app.trip_events (tabla vacía con 5 índices)
DROP INDEX IF EXISTS app.idx_trip_events_trip_id;
DROP INDEX IF EXISTS app.idx_trip_events_type;
DROP INDEX IF EXISTS app.idx_trip_events_created_at;
DROP INDEX IF EXISTS app.idx_trip_events_tags;
DROP INDEX IF EXISTS app.idx_trip_events_payload;

-- app.trip_fleet_links
DROP INDEX IF EXISTS app.idx_fleet_links_trip_id;
DROP INDEX IF EXISTS app.idx_fleet_links_driver_id;
DROP INDEX IF EXISTS app.idx_fleet_links_transporter_id;

-- bronze.raw_tms_trips (índices de pipeline no usados por PostgREST)
DROP INDEX IF EXISTS bronze.idx_bronze_trip_file;
DROP INDEX IF EXISTS bronze.idx_bronze_payload_hash;
DROP INDEX IF EXISTS bronze.idx_bronze_pending;
