-- Gold layer: Diario 2.0
-- Vista centralizada de viajes con normalized_status + tablas de campos manuales y perfiles

-- ============================================================
-- SCHEMA GOLD
-- ============================================================
CREATE SCHEMA IF NOT EXISTS gold;

-- ============================================================
-- VISTA: gold.v_diario_trips
-- Join silver.tms_trips con dimensiones SCD Type 2
-- Agrega normalized_status (vocabulario unificado de QAnalytics)
-- ============================================================
CREATE OR REPLACE VIEW gold.v_diario_trips AS
SELECT
  t.status_id,
  -- Fecha normalizada desde VARCHAR 'DD/MM/YYYY HH:MM:SS'
  TO_DATE(SPLIT_PART(t.planning_date, ' ', 1), 'DD/MM/YYYY')  AS fecha,
  t.client_name,
  t.tms_name,
  -- Dimensión transportistas (solo filas vigentes SCD Type 2)
  trans.business_name                                           AS eett,
  trans.transporter_tax_id                                      AS rut_eett,
  -- Dimensión conductores
  dr.full_name                                                  AS conductor,
  dr.dni_driver                                                 AS rut_conductor,
  -- Patentes desde tms_trips (más fresco que la dimensión)
  t.tractor_plate                                               AS patente_tracto,
  t.trailer_plate                                               AS patente_rampla,
  -- Dimensión vehículos
  veh.vehicle_type                                              AS tipo_vehiculo,
  -- Origen del viaje
  t.origin                                                      AS cd_planta_origen,
  -- Status raw del TMS de origen
  t.status                                                      AS status_raw,
  -- Status normalizado al vocabulario de QAnalytics
  -- Fuente: hoja 'validacion_wip' de modelo_datos_diario2.0 (Google Sheets)
  CASE
    -- Sodimac → QAnalytics
    WHEN t.tms_name = 'sodimac' AND t.status = 'Publicada'          THEN 'ASIGNADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Presentada'         THEN 'ASIGNADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Aceptada'           THEN 'ASIGNADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Despachada'         THEN 'RUTA'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Control de salida'  THEN 'RETORNANDO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Removida'           THEN 'CANCELADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Rechazada en andén' THEN 'CANCELADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Carga rechazada'    THEN 'CANCELADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Finalizado'         THEN 'CERRADO FINALIZADO'
    WHEN t.tms_name = 'sodimac' AND t.status = 'Finalizada'         THEN 'CERRADO FINALIZADO'
    -- Wingsuite → QAnalytics
    WHEN t.tms_name = 'wingsuite' AND t.status = 'Ejecucion'        THEN 'RUTA'
    WHEN t.tms_name = 'wingsuite' AND t.status = 'Terminado'        THEN 'CERRADO FINALIZADO'
    -- QAnalytics ya usa el vocabulario normalizado
    ELSE t.status
  END                                                           AS normalized_status,
  -- Local de entrega
  t.local                                                       AS local_asignado,
  t.cargo_type,
  t.temperature,
  -- Timestamps de milestones
  t.planning_date,
  t.arrival_date,
  t.departure_date,
  t.unload_start,
  t.unload_end,
  t.gps_arrival_date,
  t.gps_departure_date,
  -- Campos adicionales de contexto
  t.s2s,
  t.reference_number          AS sap_number
FROM silver.tms_trips t
LEFT JOIN silver.snapshot_silver_drivers dr
  ON t.dni_driver = dr.dni_driver
  AND dr.dbt_valid_to IS NULL
LEFT JOIN silver.snapshot_silver_transporters trans
  ON t.transport = trans.business_name
  AND trans.dbt_valid_to IS NULL
LEFT JOIN silver.snapshot_silver_vehicles veh
  ON t.tractor_plate = veh.license_plate
  AND veh.dbt_valid_to IS NULL;

-- ============================================================
-- TABLA: gold.diario_manual_fields
-- Campos operativos diarios que NO vienen del TMS
-- Editables desde la app Diario 2.0
-- ============================================================
CREATE TABLE IF NOT EXISTS gold.diario_manual_fields (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fecha                       DATE NOT NULL,
  dni_driver                  VARCHAR(20) NOT NULL,
  tractor_plate               VARCHAR(20),
  -- Flags de estado operativo (ACTIVO / TRABAJANDO / ASIGNADO del CSV)
  activo                      BOOLEAN NOT NULL DEFAULT TRUE,
  trabajando                  BOOLEAN NOT NULL DEFAULT FALSE,
  asignado                    BOOLEAN NOT NULL DEFAULT FALSE,
  -- Contacto
  telefono                    VARCHAR(20),
  -- Notas de operación
  observaciones               TEXT,
  comentarios                 TEXT,
  pendientes_am               TEXT,
  -- Disponibilidad / RRHH
  asistencia_sabado_domingo   BOOLEAN NOT NULL DEFAULT FALSE,
  sosafe                      BOOLEAN NOT NULL DEFAULT FALSE,
  vacaciones                  BOOLEAN NOT NULL DEFAULT FALSE,
  disponible_domingo          BOOLEAN NOT NULL DEFAULT FALSE,
  turno_manana                BOOLEAN NOT NULL DEFAULT FALSE,
  -- Auditoría
  created_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by                  UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Un registro por conductor por día
  UNIQUE(fecha, dni_driver)
);

ALTER TABLE gold.diario_manual_fields ENABLE ROW LEVEL SECURITY;

-- Equipo de operaciones Webcarga: acceso completo (lectura + escritura)
CREATE POLICY "ops_team_all" ON gold.diario_manual_fields
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION gold.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER diario_manual_fields_updated_at
  BEFORE UPDATE ON gold.diario_manual_fields
  FOR EACH ROW EXECUTE FUNCTION gold.update_updated_at();

-- ============================================================
-- TABLA: public.profiles
-- Perfil del usuario del equipo Webcarga
-- Se crea automáticamente al registrarse en Supabase Auth
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'operador' CHECK (role IN ('operador', 'admin')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Solo puede ver y editar su propio perfil
CREATE POLICY "self_select" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "self_update" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

-- Trigger para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- EXPONER gold schema en la API de Supabase (PostgREST)
-- Requiere también agregar 'gold' en supabase/config.toml → [api] schemas
-- ============================================================
COMMENT ON SCHEMA gold IS 'Capa Gold: vistas y tablas listas para el Diario 2.0';
COMMENT ON VIEW gold.v_diario_trips IS 'Vista de viajes con status normalizado multi-TMS para el Diario 2.0';
COMMENT ON TABLE gold.diario_manual_fields IS 'Campos operativos del Diario 2.0 no provenientes del TMS';
