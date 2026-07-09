-- ==============================================================================
-- MIGRACIÓN: MÓDULO EMPRESAS EETT + SEGUROS — FASE 1 (A) FUNDACIONES
-- Plan: monitor-app/docs/plan-modulo-empresas-seguros.md §1
--
-- Schema `ops` (observabilidad del pipeline Mage, no expuesto a authenticated),
-- enums de estado, funciones de RUT (normalización + dígito verificador),
-- trigger genérico de updated_at, tabla de apagado de sync por dominio
-- (§ Principio de arquitectura #3) y tablas de corridas/rechazos del pipeline
-- (§1.6).
-- ==============================================================================

-- ── Schema ops ─────────────────────────────────────────────────────────────
-- Mismo patrón que bronze/silver/gold (20260417191106): solo service_role
-- (Mage/API) opera acá. NO se otorga acceso a authenticated (instrucción
-- explícita del plan — es telemetría interna del pipeline, no dato de negocio).
CREATE SCHEMA IF NOT EXISTS ops;
GRANT ALL ON SCHEMA ops TO service_role;

-- ── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE app.compliance_status AS ENUM ('ok', 'pendiente', 'actualizar', 'n_a', 'factible');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE app.installment_status AS ENUM ('pagada', 'pendiente', 'vencida');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Funciones de RUT chileno ───────────────────────────────────────────────

-- Normaliza un RUT a solo el cuerpo numérico (sin puntos/espacios/DV), en
-- mayúsculas. Usada para el cruce centralizer ↔ info_contacto (plan §ident.
-- "Cruce RUT validado") y como ancla de upsert fallback.
CREATE OR REPLACE FUNCTION app.normalize_rut(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(split_part(regexp_replace(coalesce(input, ''), '[.\s]', '', 'g'), '-', 1));
$$;

-- Calcula el dígito verificador de un RUT chileno (algoritmo módulo 11,
-- serie 2..7 cíclica de derecha a izquierda). Recibe el cuerpo del RUT
-- (con o sin puntos/DV, se limpia internamente); retorna '0'..'9' o 'K'.
-- Usada para poblar rut_dv_valid (columna DQ) en transporters/drivers/vehicles.
CREATE OR REPLACE FUNCTION app.rut_dv(rut text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_rut    bigint;
  v_sum    integer := 0;
  v_mul    integer := 2;
  v_digit  integer;
  v_dv     integer;
BEGIN
  v_rut := nullif(regexp_replace(split_part(coalesce(rut, ''), '-', 1), '[^0-9]', '', 'g'), '')::bigint;
  IF v_rut IS NULL OR v_rut = 0 THEN
    RETURN NULL;
  END IF;

  WHILE v_rut > 0 LOOP
    v_digit := v_rut % 10;
    v_sum := v_sum + v_digit * v_mul;
    v_mul := v_mul + 1;
    IF v_mul > 7 THEN
      v_mul := 2;
    END IF;
    v_rut := v_rut / 10;
  END LOOP;

  v_dv := 11 - (v_sum % 11);
  IF v_dv = 11 THEN
    RETURN '0';
  ELSIF v_dv = 10 THEN
    RETURN 'K';
  ELSE
    RETURN v_dv::text;
  END IF;
END;
$$;

-- Trigger genérico de updated_at, reusado por todas las tablas nuevas del
-- módulo (no existía uno en app; gold.update_updated_at es propio de gold).
CREATE OR REPLACE FUNCTION app.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── app.sync_config ────────────────────────────────────────────────────────
-- Apagado de sync por dominio (Principio de arquitectura #3): cuando la app
-- pasa a ser fuente de verdad de un dominio, se apaga acá y el pipeline Mage
-- lo salta en el upsert (§2.5).
CREATE TABLE app.sync_config (
  domain     text        PRIMARY KEY,
  sync_enabled boolean   NOT NULL DEFAULT true,
  note       text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO app.sync_config (domain, sync_enabled) VALUES
  ('transporters',     true),
  ('drivers',           true),
  ('vehicles',          true),
  ('compliance_docs',   true),
  ('insurance',         true)
ON CONFLICT (domain) DO NOTHING;

CREATE TRIGGER sync_config_set_updated_at
  BEFORE UPDATE ON app.sync_config
  FOR EACH ROW EXECUTE FUNCTION app.set_updated_at();

-- ── ops.pipeline_runs / ops.pipeline_rejects ──────────────────────────────
-- Observabilidad del pipeline Mage centralizer_to_app (plan §1.6 / §2).
CREATE TABLE ops.pipeline_runs (
  id             bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline       text        NOT NULL,
  batch_id       bigint      NOT NULL,
  started_at     timestamptz,
  finished_at    timestamptz,
  status         text,                 -- ok | failed | schema_drift
  rows_in        jsonb,                -- conteos por tabla
  rows_upserted  jsonb,
  rows_rejected  jsonb,
  error          text
);

CREATE INDEX idx_pipeline_runs_pipeline_batch ON ops.pipeline_runs (pipeline, batch_id);

CREATE TABLE ops.pipeline_rejects (
  id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  batch_id     bigint      NOT NULL,
  source_table text        NOT NULL,
  reason       text        NOT NULL,   -- rut_dv_invalido | fecha_invalida | huerfano | duplicado
  raw_row      jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_rejects_batch ON ops.pipeline_rejects (batch_id);
CREATE INDEX idx_pipeline_rejects_reason ON ops.pipeline_rejects (reason);
