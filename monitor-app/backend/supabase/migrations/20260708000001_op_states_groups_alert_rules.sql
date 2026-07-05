-- ==============================================================================
-- MIGRACIÓN: GRUPOS EN ESTADOS OPERACIONALES + REGLAS DE ALERTA DEL MONITOR
--
-- 1. app.operational_states.group_id — unifica el vocabulario del tablero:
--    los estados operacionales (estado_manual) pasan a pertenecer a la MISMA
--    taxonomía de 6 grupos que app.trip_statuses.group_id (columnas del
--    tablero). Antes un viaje con override manual no matcheaba ningún grupo
--    y caía siempre a la columna "Otro". Con esto, soltar una tarjeta en una
--    columna puede setear estado_manual a un estado de ese grupo, y el
--    bucketing resuelve ambos vocabularios. La nomenclatura TMS visible en
--    las tarjetas NO cambia (decisión de adopción de plataforma).
--
-- 2. app.monitor_alert_rules — umbrales configurables de las alertas del
--    monitor (fila única). Reemplaza el STALE_HOURS hardcodeado del frontend
--    y da soporte a las alertas nuevas (detenido en local, atraso de llegada,
--    sin asignación), fundadas en cobertura real de datos verificada:
--    98 viajes abiertos detenidos >2h y 10 con atraso de llegada (14 días).
-- ==============================================================================

-- ── 1. Grupo en estados operacionales ─────────────────────────────────────────

ALTER TABLE app.operational_states
  ADD COLUMN group_id text NOT NULL DEFAULT 'otro'
    CHECK (group_id IN ('en_ruta', 'en_local', 'retornando', 'cerrado', 'problema', 'otro'));

-- Backfill best-effort por label (los que no matcheen quedan en 'otro' y el
-- admin los reasigna desde Configuración → Estados Operacionales)
UPDATE app.operational_states SET group_id = 'en_ruta'    WHERE label ILIKE '%ruta%';
UPDATE app.operational_states SET group_id = 'en_local'   WHERE label ILIKE '%local%' OR label ILIKE '%descarga%' OR label ILIKE '%carga%';
UPDATE app.operational_states SET group_id = 'retornando' WHERE label ILIKE '%retorn%';
UPDATE app.operational_states SET group_id = 'cerrado'    WHERE label ILIKE '%cerrado%' OR label ILIKE '%finalizado%' OR label ILIKE '%terminado%';
UPDATE app.operational_states SET group_id = 'problema'   WHERE label ILIKE '%problema%' OR label ILIKE '%pana%' OR label ILIKE '%incidente%' OR label ILIKE '%detenido%';

-- ── 2. Reglas de alerta del monitor (fila única) ──────────────────────────────

CREATE TABLE app.monitor_alert_rules (
  id                     smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  stale_report_hours     numeric(4,1) NOT NULL DEFAULT 2   CHECK (stale_report_hours > 0),
  dwell_hours            numeric(4,1) NOT NULL DEFAULT 2   CHECK (dwell_hours > 0),
  late_arrival_grace_min integer      NOT NULL DEFAULT 60  CHECK (late_arrival_grace_min >= 0),
  unassigned_enabled     boolean      NOT NULL DEFAULT true,
  updated_at             timestamptz  NOT NULL DEFAULT now()
);

INSERT INTO app.monitor_alert_rules (id) VALUES (1);

ALTER TABLE app.monitor_alert_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "monitor_alert_rules_read"
  ON app.monitor_alert_rules FOR SELECT USING (true);
