-- ============================================================
-- app.trips — tabla agregada de viajes (una fila por otm_id)
-- Patrón: mismo diseño que app.transporter_profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS app.trips (
  id                     UUID PRIMARY KEY,         -- = otm_id de silver.tms_trips
  tms_name               VARCHAR(100) NOT NULL,
  client_name            VARCHAR(100),
  planning_date          DATE,
  current_status         VARCHAR(50),
  tractor_plate          VARCHAR(20),
  trailer_plate          VARCHAR(20),
  driver_name            VARCHAR(255),
  driver_rut             VARCHAR(20),
  transporter            VARCHAR(255),
  origin                 VARCHAR(255),

  -- Historial completo de estados (pipeline-managed)
  milestones             JSONB NOT NULL DEFAULT '[]',

  -- Bitácora Operativa (editables por el operador del Diario)
  activo                 BOOLEAN NOT NULL DEFAULT TRUE,
  trabajando             BOOLEAN NOT NULL DEFAULT FALSE,
  asignado               BOOLEAN NOT NULL DEFAULT FALSE,
  primera_vuelta         BOOLEAN NOT NULL DEFAULT FALSE,
  estado_manual          VARCHAR(50),
  locales                TEXT,
  observaciones          TEXT,
  comentarios            TEXT,

  -- Tracking de ediciones manuales (mismo patrón que transporter_profiles)
  manually_edited_fields TEXT[]      NOT NULL DEFAULT '{}',
  edited_by              UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at              TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_trips_planning_date  ON app.trips (planning_date);
CREATE INDEX IF NOT EXISTS idx_app_trips_current_status ON app.trips (current_status);
CREATE INDEX IF NOT EXISTS idx_app_trips_tractor_plate  ON app.trips (tractor_plate);
CREATE INDEX IF NOT EXISTS idx_app_trips_driver_rut     ON app.trips (driver_rut);

-- RLS: lectura autenticada; escritura solo vía service_role (FastAPI/pipeline)
ALTER TABLE app.trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trips_select" ON app.trips
  FOR SELECT TO authenticated USING (true);

-- El pipeline llama esta función para evitar pisar campos protegidos
CREATE OR REPLACE FUNCTION app.safe_upsert_trip(
  p_otm_id    UUID,
  p_milestone JSONB,    -- {status_id, status, ts, local, planning_date, tractor_plate, trailer_plate, driver_name, driver_rut, transporter, origin, client_name, tms_name}
  p_is_latest BOOLEAN   -- true = este milestone tiene el estado más reciente
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  edited TEXT[];
BEGIN
  SELECT COALESCE(manually_edited_fields, '{}') INTO edited
  FROM app.trips WHERE id = p_otm_id;

  INSERT INTO app.trips (
    id, tms_name, client_name, planning_date, current_status,
    tractor_plate, trailer_plate, driver_name, driver_rut, transporter, origin,
    milestones, updated_at
  )
  VALUES (
    p_otm_id,
    p_milestone->>'tms_name',
    p_milestone->>'client_name',
    (p_milestone->>'planning_date')::DATE,
    p_milestone->>'status',
    p_milestone->>'tractor_plate',
    p_milestone->>'trailer_plate',
    p_milestone->>'driver_name',
    p_milestone->>'driver_rut',
    p_milestone->>'transporter',
    p_milestone->>'origin',
    jsonb_build_array(p_milestone),
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    current_status = CASE
      WHEN p_is_latest AND NOT ('current_status' = ANY(edited))
      THEN p_milestone->>'status'
      ELSE app.trips.current_status
    END,
    tractor_plate = CASE
      WHEN NOT ('tractor_plate' = ANY(edited))
      THEN COALESCE(p_milestone->>'tractor_plate', app.trips.tractor_plate)
      ELSE app.trips.tractor_plate
    END,
    trailer_plate = CASE
      WHEN NOT ('trailer_plate' = ANY(edited))
      THEN COALESCE(p_milestone->>'trailer_plate', app.trips.trailer_plate)
      ELSE app.trips.trailer_plate
    END,
    driver_name = CASE
      WHEN NOT ('driver_name' = ANY(edited))
      THEN COALESCE(p_milestone->>'driver_name', app.trips.driver_name)
      ELSE app.trips.driver_name
    END,
    driver_rut = CASE
      WHEN NOT ('driver_rut' = ANY(edited))
      THEN COALESCE(p_milestone->>'driver_rut', app.trips.driver_rut)
      ELSE app.trips.driver_rut
    END,
    -- Agregar milestone solo si su status_id aún no está en el array
    milestones = CASE
      WHEN NOT (app.trips.milestones @> jsonb_build_array(
                  jsonb_build_object('status_id', p_milestone->>'status_id')))
      THEN app.trips.milestones || jsonb_build_array(p_milestone)
      ELSE app.trips.milestones
    END,
    updated_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION app.safe_upsert_trip TO service_role;
COMMENT ON FUNCTION app.safe_upsert_trip IS
  'Upsert seguro de viajes: agrega un milestone al historial y actualiza campos de cabecera solo si no están protegidos por manually_edited_fields.';
