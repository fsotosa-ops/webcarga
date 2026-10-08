-- HU-C1, entrega 2: correcciones de la revisión final (08/10).
--
-- I4 — los días de gracia valen para TODOS los tipos, como dice la HU-C1
--      ("Todos los tipos llevan además dos parámetros: días de aviso y días de
--      gracia"). vence_segun_regla solo los sumaba al período de calendario.
--      Ahora recibe también la fecha del documento y es la única fórmula del
--      vencimiento según una regla, para los tres tipos que vencen.
-- I2, I3 — coherencia de las reglas, que hace cumplir Postgres:
--      · toda regla de cliente es variante DE una base: si un requisito tiene
--        reglas, tiene una base que rige desde siempre (-infinity). Sin base,
--        un cliente sin variante se quedaba sin días de aviso; con una base
--        que empezaba más tarde, todo documento anterior salía sin regla
--        (vencimiento NULL, "al día") en vez de vencido;
--      · mover una regla a otro requisito valida también el de origen.
-- M1 — el comentario de exigible_on nombraba una función que ya no existe.

DROP FUNCTION public.vence_segun_regla(text, public.compliance_requirement_rules, date, date);

-- El vencimiento de un documento según UNA regla:
--   REQUIRED/OPTIONAL  la fecha que trae el documento
--   ISSUE_PLUS_MONTHS  emisión + meses
--   CALENDAR_PERIOD    el corte del período que se exige DESPUÉS del que cubre
--                      el documento (el de septiembre, período = mes anterior,
--                      corte 18, cubre hasta el 18/11)
-- más los días de gracia de la regla.
CREATE OR REPLACE FUNCTION public.vence_segun_regla(
  p_politica text, p_regla public.compliance_requirement_rules,
  p_expiration_date date, p_issue_date date, p_period_start date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_politica
    WHEN 'REQUIRED' THEN p_expiration_date
    WHEN 'OPTIONAL' THEN p_expiration_date
    WHEN 'ISSUE_PLUS_MONTHS' THEN
      (p_issue_date + make_interval(months => (p_regla).validity_months))::date
    WHEN 'CALENDAR_PERIOD' THEN
      public.corte_del_periodo(p_period_start,
                               (p_regla).period_offset_months + (p_regla).frequency_months,
                               (p_regla).cutoff_day)
  END + (p_regla).grace_days
$$;

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

  -- Un tipo con parámetros necesita reglas; y quien tiene reglas necesita una
  -- base que rija desde siempre, para que todo cliente y todo documento, de
  -- cualquier fecha, encuentre la suya.
  IF (v_politica IN ('ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD')
      OR EXISTS (SELECT 1 FROM public.compliance_requirement_rules
                 WHERE requirement_id = p_requirement_id))
     AND NOT EXISTS (SELECT 1 FROM public.compliance_requirement_rules
                     WHERE requirement_id = p_requirement_id
                       AND shipper_id IS NULL AND vigente_desde = '-infinity') THEN
    RAISE EXCEPTION 'El documento necesita una regla base que rija desde siempre'
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

-- Mover una regla a otro requisito cambia DOS requisitos: se validan los dos.
CREATE OR REPLACE FUNCTION public.trg_validar_vigencia_regla()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM public.validar_vigencia_de_requisito(OLD.requirement_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.validar_vigencia_de_requisito(NEW.requirement_id);
  END IF;
  RETURN NULL;
END;
$$;

COMMENT ON COLUMN public.compliance_requirements.exigible_on IS
  'Desde cuándo se exige: ON_ENTITY_START (al ingreso), MONTH_AFTER_START (mes siguiente al ingreso del conductor), ON_ENTITY_END (al término del conductor), ON_REQUEST (solo si se solicita). Lo evalúa exigible_sql() en app/services/vencimientos.py.';
