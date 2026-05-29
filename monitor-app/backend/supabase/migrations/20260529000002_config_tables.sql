-- ==============================================================================
-- MIGRACIÓN: TABLAS DE CONFIGURACIÓN AUTO-ADMINISTRABLE
-- trip_statuses · operational_states · alert_thresholds
-- ==============================================================================

-- ── app.trip_statuses ────────────────────────────────────────────────────────
-- Estados que reporta el TMS (id fijado por el TMS, editable en presentación)
CREATE TABLE app.trip_statuses (
  id         text PRIMARY KEY,
  label      text NOT NULL DEFAULT '',
  bg_color   text NOT NULL DEFAULT '#f3f4f6',
  text_color text NOT NULL DEFAULT '#6b7280',
  group_id   text NOT NULL DEFAULT 'otro',
  sort_order int  NOT NULL DEFAULT 99,
  active     bool NOT NULL DEFAULT true
);

INSERT INTO app.trip_statuses (id, label, bg_color, text_color, group_id, sort_order) VALUES
  ('ASIGNADO',               'Asignado',               '#e8eeff', '#053bfa', 'en_ruta',     1),
  ('ORIGEN',                 'Origen',                 '#f3e8ff', '#8a00dd', 'en_ruta',     2),
  ('RUTA',                   'En Ruta',                '#eef6e6', '#62a420', 'en_ruta',     3),
  ('EN LOCAL',               'En Local',               '#fef0e6', '#ea6b25', 'en_local',    4),
  ('VIAJE EN PREDIO',        'Viaje en Predio',        '#fef0e6', '#ea6b25', 'en_local',    5),
  ('RETORNANDO',             'Retornando',             '#e6f8fd', '#0e8db5', 'retornando',  6),
  ('RETORNADO CD',           'Retornado CD',           '#f3f4f6', '#6b7280', 'retornando',  7),
  ('CERRADO FINALIZADO',     'Cerrado Finalizado',     '#f3f4f6', '#9ca3af', 'cerrado',     8),
  ('CERRADO INCOMPLETO',     'Cerrado Incompleto',     '#fef3c7', '#d97706', 'cerrado',     9),
  ('CERRADO MANUAL',         'Cerrado Manual',         '#f3f4f6', '#9ca3af', 'cerrado',    10),
  ('CERRADO SIN GPS',        'Cerrado Sin GPS',        '#f3f4f6', '#9ca3af', 'cerrado',    11),
  ('CERRADO POR OTRO VIAJE', 'Cerrado por Otro Viaje', '#f3f4f6', '#9ca3af', 'cerrado',    12),
  ('CERRADO FINALIZADO CC',  'Cerrado Finalizado CC',  '#f3f4f6', '#9ca3af', 'cerrado',    13),
  ('CANCELADO',              'Cancelado',              '#fee2e2', '#b00020', 'problema',   14),
  ('EN PANA',                'En Pana',                '#fee2e2', '#b00020', 'problema',   15),
  ('DEVUELTO',               'Devuelto',               '#fee2e2', '#b00020', 'problema',   16);

-- ── app.operational_states ───────────────────────────────────────────────────
-- Estados del equipo de operaciones para gestionar viajes (campo estado_manual)
-- CRUD completo desde el módulo de configuración
CREATE TABLE app.operational_states (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  label      text        NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 60),
  bg_color   text        NOT NULL DEFAULT '#f3f4f6',
  text_color text        NOT NULL DEFAULT '#374151',
  sort_order int         NOT NULL DEFAULT 99,
  active     bool        NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app.operational_states (label, bg_color, text_color, sort_order) VALUES
  ('En seguimiento',     '#eff6ff', '#1d4ed8', 1),
  ('Esperando descarga', '#fef9c3', '#854d0e', 2),
  ('Problema conductor', '#fef2f2', '#b91c1c', 3),
  ('Coordinando retorno','#f0fdf4', '#166534', 4),
  ('Novedad reportada',  '#fff7ed', '#c2410c', 5);

-- ── app.alert_thresholds ─────────────────────────────────────────────────────
-- Umbrales en días para alertas de vencimiento de documentos de gobernanza
CREATE TABLE app.alert_thresholds (
  doc_type     text PRIMARY KEY,
  label        text NOT NULL,
  warning_days int  NOT NULL DEFAULT 30 CHECK (warning_days > 0),
  error_days   int  NOT NULL DEFAULT 0  CHECK (error_days >= 0)
);

INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days) VALUES
  ('id_expiry',        'Cédula de identidad',  30, 0),
  ('license_expiry',   'Licencia de conducir', 30, 0),
  ('padron',           'Padrón',               30, 0),
  ('circulacion',      'P. Circulación',       30, 0),
  ('revision_tecnica', 'Revisión Técnica',     30, 0),
  ('gases',            'Gases',                30, 0),
  ('soap',             'SOAP',                 30, 0),
  ('poliza_rc',        'Póliza RC',            30, 0);

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Lectura pública (autenticados); escritura solo via service_role (FastAPI)
ALTER TABLE app.trip_statuses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.operational_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.alert_thresholds   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_statuses_read"
  ON app.trip_statuses FOR SELECT USING (true);

CREATE POLICY "op_states_read"
  ON app.operational_states FOR SELECT USING (true);

CREATE POLICY "alert_thresholds_read"
  ON app.alert_thresholds FOR SELECT USING (true);

-- Índices
CREATE INDEX idx_operational_states_active
  ON app.operational_states (active, sort_order);
