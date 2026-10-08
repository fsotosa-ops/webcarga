-- HU-C1, entrega 2 (F1): esquema de la vigencia por tipo de documento.
--
-- Fuente: la planilla de WebCarga (Tabla_Resumen_General_IANSA.xlsx), que el
-- usuario fijó como ESTÁNDAR WebCarga el 07/10. Cuatro tipos cerrados:
--   NONE               no vence                    (No aplica / Vigencia No)
--   REQUIRED|OPTIONAL  fecha del documento         (Definida por documento)
--   ISSUE_PLUS_MONTHS  plazo desde la emisión      (Anual = 12, Bienal = 24)
--   CALENDAR_PERIOD    período de calendario       (Mensual, "N de cada mes")
-- REQUIRED y OPTIONAL conservan su significado (CondicionPanel): el mapeo de
-- lo existente es la identidad, así que no se migra ni un dato.
--
-- SOLO EXPAND: la API de main lee esta misma base y no conoce lo nuevo.

-- 1) Los dos tipos nuevos.
ALTER TABLE public.compliance_requirements
  DROP CONSTRAINT compliance_requirements_expiration_policy_check;
ALTER TABLE public.compliance_requirements
  ADD CONSTRAINT compliance_requirements_expiration_policy_check
  CHECK (expiration_policy IN
    ('NONE', 'REQUIRED', 'OPTIONAL', 'ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD'));

-- 2) Desde cuándo se exige ("Cuándo se carga" en la planilla). El DEFAULT es
-- lo que hace la siembra hoy, así que ningún requisito cambia.
ALTER TABLE public.compliance_requirements
  ADD COLUMN exigible_on text NOT NULL DEFAULT 'ON_ENTITY_START';
ALTER TABLE public.compliance_requirements
  ADD CONSTRAINT compliance_requirements_exigible_on_check
  CHECK (exigible_on IN ('ON_ENTITY_START', 'MONTH_AFTER_START', 'ON_ENTITY_END', 'ON_REQUEST'));
-- El ingreso y el término de un TRABAJADOR solo existen para conductores:
-- son driver_assignments.start_date y el paso a INACTIVE.
ALTER TABLE public.compliance_requirements
  ADD CONSTRAINT compliance_requirements_exigible_on_entity_check
  CHECK (exigible_on NOT IN ('MONTH_AFTER_START', 'ON_ENTITY_END') OR target_entity = 'DRIVER');
COMMENT ON COLUMN public.compliance_requirements.exigible_on IS
  'Desde cuándo se exige: ON_ENTITY_START (al ingreso), MONTH_AFTER_START (mes siguiente al ingreso del conductor), ON_ENTITY_END (al término del conductor), ON_REQUEST (solo si se solicita). Lo evalúa public.documento_exigible().';

-- 3) Lo que el documento dice de sí mismo. expiration_date NO se renombra:
-- la API de main la lee.
ALTER TABLE public.compliance_records
  ADD COLUMN issue_date date,
  ADD COLUMN period_start date;
ALTER TABLE public.compliance_records
  ADD CONSTRAINT compliance_records_period_start_first_day_check
  CHECK (period_start IS NULL OR extract(day FROM period_start) = 1);
COMMENT ON COLUMN public.compliance_records.issue_date IS
  'Fecha de emisión. La usa ISSUE_PLUS_MONTHS.';
COMMENT ON COLUMN public.compliance_records.period_start IS
  'Primer día del período que cubre el documento (ej. 2026-09-01 = septiembre). La usa CALENDAR_PERIOD.';

-- 4) Los parámetros: UN lugar para la regla base y para la de cada cliente.
-- La regla de un cliente es una VARIANTE de parámetros del mismo requisito, no
-- un requisito con shipper_id: eso sembraría un registro duplicado y obligaría
-- a cargar el mismo F30 dos veces (HU-C1, regla 5).
-- vigente_desde versiona la regla: un documento se evalúa con la versión
-- vigente a su emisión o período, así que mover un corte no reescribe lo ya
-- aprobado (regla 6). La primera versión rige desde siempre.
CREATE TABLE public.compliance_requirement_rules (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id       uuid NOT NULL REFERENCES public.compliance_requirements(id) ON DELETE CASCADE,
  shipper_id           uuid REFERENCES public.shippers(id) ON DELETE CASCADE,
  vigente_desde        date NOT NULL DEFAULT '-infinity',
  validity_months      int CHECK (validity_months > 0),
  frequency_months     int CHECK (frequency_months > 0),
  cutoff_day           int CHECK (cutoff_day BETWEEN 1 AND 31),
  period_offset_months int CHECK (period_offset_months >= 0),
  -- NULL = rige el aviso general (app.alert_thresholds 'documento_por_vencer').
  warning_days         int CHECK (warning_days >= 0),
  grace_days           int NOT NULL DEFAULT 0 CHECK (grace_days >= 0),
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compliance_requirement_rules_version_key
    UNIQUE NULLS NOT DISTINCT (requirement_id, shipper_id, vigente_desde)
);
CREATE INDEX compliance_requirement_rules_requirement_idx
  ON public.compliance_requirement_rules (requirement_id);
COMMENT ON TABLE public.compliance_requirement_rules IS
  'Parámetros de vigencia por tipo de documento (HU-C1). shipper_id NULL = regla base WebCarga; con cliente = su variante. Versionada por vigente_desde.';

-- 5) Coherencia política ↔ parámetros, la hace cumplir Postgres. Es DIFERIDA:
-- la API cambia la política y sus parámetros en una transacción, y el chequeo
-- corre al confirmar. Mira las dos tablas porque cualquiera de las dos puede
-- romper la coherencia.
CREATE OR REPLACE FUNCTION public.validar_vigencia_de_requisito(p_requirement_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_politica text;
BEGIN
  SELECT expiration_policy INTO v_politica
  FROM public.compliance_requirements WHERE id = p_requirement_id;
  IF v_politica IS NULL THEN
    RETURN;  -- el requisito se borró; el CASCADE se lleva sus reglas
  END IF;

  IF v_politica IN ('ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD')
     AND NOT EXISTS (SELECT 1 FROM public.compliance_requirement_rules
                     WHERE requirement_id = p_requirement_id AND shipper_id IS NULL) THEN
    RAISE EXCEPTION 'El tipo de vigencia % necesita una regla base', v_politica
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_politica = 'ISSUE_PLUS_MONTHS' AND EXISTS (
       SELECT 1 FROM public.compliance_requirement_rules
       WHERE requirement_id = p_requirement_id AND validity_months IS NULL) THEN
    RAISE EXCEPTION 'Plazo desde la emisión: cada regla necesita sus meses de vigencia'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_politica = 'CALENDAR_PERIOD' AND EXISTS (
       SELECT 1 FROM public.compliance_requirement_rules
       WHERE requirement_id = p_requirement_id
         AND (frequency_months IS NULL OR cutoff_day IS NULL OR period_offset_months IS NULL)) THEN
    RAISE EXCEPTION 'Período de calendario: cada regla necesita frecuencia, día de corte y período'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_validar_vigencia_requisito()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.validar_vigencia_de_requisito(NEW.id);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_validar_vigencia_regla()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.validar_vigencia_de_requisito(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.requirement_id ELSE NEW.requirement_id END);
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validar_vigencia_requisito
  AFTER INSERT OR UPDATE OF expiration_policy ON public.compliance_requirements
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_vigencia_requisito();

CREATE CONSTRAINT TRIGGER validar_vigencia_regla
  AFTER INSERT OR UPDATE OR DELETE ON public.compliance_requirement_rules
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.trg_validar_vigencia_regla();

-- 6) El aviso general: lo que hoy es DIAS_POR_VENCER = 30 pasa a ser dato
-- editable desde Configuración › Alertas. Las 8 filas por documento de esta
-- tabla (claves viejas, todas en 30, medido 07/10) NO las leen los
-- predicados; se retiran en F5, cuando sus lectores pasen a la regla.
INSERT INTO app.alert_thresholds (doc_type, label, warning_days, error_days)
VALUES ('documento_por_vencer', 'Aviso general de vencimiento de documentos (días)', 30, 0)
ON CONFLICT (doc_type) DO NOTHING;
