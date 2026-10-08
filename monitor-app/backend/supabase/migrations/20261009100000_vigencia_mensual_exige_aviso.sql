-- HU-C1, entrega 2b (M6 de la revisión de la entrega 2): un período de
-- calendario exige días de aviso propios.
--
-- Con el aviso general de Configuración › Alertas (30 días), un documento
-- mensual está SIEMPRE "por vencer": el de septiembre sirve hasta el 18/11 y
-- el aviso empieza el 19/10, el mismo día en que se vuelve el vigente.
-- Medido al desplegar la entrega 2 (08/10). La regla la hace cumplir la base,
-- igual que el resto de la coherencia de la vigencia: así no importa por
-- dónde se escriba la regla (Configuración, el script de carga, el MCP).
--
-- Es la misma función de 20261008140000 con una condición más; el resto no
-- cambia.

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

  IF v_politica = 'CALENDAR_PERIOD' AND EXISTS (
       SELECT 1 FROM public.compliance_requirement_rules
       WHERE requirement_id = p_requirement_id AND warning_days IS NULL) THEN
    RAISE EXCEPTION 'Período de calendario: indica con cuántos días de aviso (con el aviso general, un documento mensual estaría siempre por vencer)'
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;
