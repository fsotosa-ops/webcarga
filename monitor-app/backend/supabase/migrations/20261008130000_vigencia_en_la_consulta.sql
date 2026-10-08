-- HU-C1, entrega 2 (Task 5): el cálculo de la vigencia pasa a la consulta.
--
-- Medido el 08/10 con los endpoints reales: con documento_vence_el,
-- documento_aviso_desde y documento_exigible (20261008120000),
-- /compliance/status por empresa pasó de 0,28 s a 0,76 s y la cola de 0,20 s
-- a 0,38 s. La causa es la llamada: una función SQL con subconsultas NO se
-- inlinea (Postgres solo despliega cuerpos de una expresión sin sub-SELECT),
-- así que cada predicado era una llamada aparte por registro (~5.700) y por
-- predicado. PARALLEL SAFE no cambió nada, y reescribirlas sin WITH tampoco
-- (medido: 0,78 s).
--
-- La expresión vuelve a armarse en app/services/vencimientos.py, que es la
-- ÚNICA definición del cálculo, como pide la HU-C1 ("se calcula al leer, en
-- vencimientos.py"): sus subconsultas son sub-planes de la misma consulta, sin
-- costo de llamada. Por eso las tres funciones se retiran: dejarlas sería una
-- segunda definición.
--
-- Quedan en la base las piezas que sí se inlinean (expresión pura) o que son
-- de conjunto: hoy_chile(), clientes_de_entidad(), reglas_aplicables(), y las
-- dos fórmulas de abajo, que así viven en un solo lugar.

-- El día de corte del mes que cae p_meses después de p_inicio. Un corte 31 en
-- un mes corto es el último día de ese mes.
CREATE OR REPLACE FUNCTION public.corte_del_periodo(p_inicio date, p_meses int, p_dia int)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT make_date(
    extract(year  FROM p_inicio + make_interval(months => p_meses))::int,
    extract(month FROM p_inicio + make_interval(months => p_meses))::int,
    least(p_dia, extract(day FROM date_trunc('month', p_inicio + make_interval(months => p_meses))
                                   + interval '1 month - 1 day')::int))
$$;

-- El vencimiento de un documento según UNA regla, para los dos tipos con
-- parámetros:
--   ISSUE_PLUS_MONTHS  emisión + meses
--   CALENDAR_PERIOD    el corte del período que se exige DESPUÉS del que cubre
--                      el documento (el de septiembre, período = mes anterior,
--                      corte 18, cubre hasta el 18/11), más la gracia.
CREATE OR REPLACE FUNCTION public.vence_segun_regla(
  p_politica text, p_regla public.compliance_requirement_rules,
  p_issue_date date, p_period_start date)
RETURNS date
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_politica
    WHEN 'ISSUE_PLUS_MONTHS' THEN
      (p_issue_date + make_interval(months => (p_regla).validity_months))::date
    WHEN 'CALENDAR_PERIOD' THEN
      public.corte_del_periodo(p_period_start,
                               (p_regla).period_offset_months + (p_regla).frequency_months,
                               (p_regla).cutoff_day)
      + (p_regla).grace_days
  END
$$;

-- Reemplazadas por la expresión de app/services/vencimientos.py. Creadas en
-- 20261008120000 el mismo día; ningún código desplegado las llama.
DROP FUNCTION public.documento_vence_el(uuid, text, uuid, text, date, date, date);
DROP FUNCTION public.documento_aviso_desde(uuid, text, uuid, text, date, date, date);
DROP FUNCTION public.documento_exigible(uuid, text, uuid);
DROP FUNCTION public.vencimientos_por_regla(uuid, text, uuid, text, date, date, date);
