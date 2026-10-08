-- HU-C1, entrega 2 (F2): cuándo vence, desde cuándo avisa y desde cuándo se
-- exige un documento. UNA definición por concepto, calculada al leer: ningún
-- proceso nocturno cambia estados (regla 4). app/services/vencimientos.py es
-- la única puerta desde Python y solo nombra estas funciones.
--
-- Mismo patrón que public.carrier_management_types(): la definición vive en
-- la base para que la API, la siembra y cualquier vista lean lo mismo.

-- Los clientes de una entidad: los de su empresa (conductor y vehículo, por su
-- asignación ACTIVE).
CREATE OR REPLACE FUNCTION public.clientes_de_entidad(p_entity_type text, p_entity_id uuid)
RETURNS SETOF uuid
LANGUAGE sql STABLE
AS $$
  SELECT cs.shipper_id
  FROM public.carrier_shippers cs
  WHERE cs.status = 'ACTIVE'
    AND cs.carrier_id = CASE p_entity_type
          WHEN 'CARRIER' THEN p_entity_id
          WHEN 'DRIVER'  THEN (SELECT da.carrier_id FROM public.driver_assignments da
                               WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
          WHEN 'ASSET'   THEN (SELECT aa.carrier_id FROM public.asset_assignments aa
                               WHERE aa.asset_id = p_entity_id AND aa.status = 'ACTIVE')
        END
$$;

-- Una regla por cliente: su variante si la tiene, si no la base. Sin clientes,
-- la base. De cada una, la versión vigente a p_fecha_ref (regla 6).
CREATE OR REPLACE FUNCTION public.reglas_aplicables(
  p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_fecha_ref date)
RETURNS SETOF public.compliance_requirement_rules
LANGUAGE sql STABLE
AS $$
  WITH clientes AS (
    SELECT c AS shipper_id FROM public.clientes_de_entidad(p_entity_type, p_entity_id) c
  ),
  version AS (
    SELECT DISTINCT ON (r.shipper_id) r.*
    FROM public.compliance_requirement_rules r
    WHERE r.requirement_id = p_requirement_id
      AND r.vigente_desde <= COALESCE(p_fecha_ref, public.hoy_chile())
      AND (r.shipper_id IS NULL OR r.shipper_id IN (SELECT shipper_id FROM clientes))
    ORDER BY r.shipper_id, r.vigente_desde DESC
  )
  SELECT v.* FROM version v WHERE v.shipper_id IS NOT NULL
  UNION ALL
  SELECT v.* FROM version v
  WHERE v.shipper_id IS NULL
    AND (NOT EXISTS (SELECT 1 FROM clientes)
         OR EXISTS (SELECT 1 FROM clientes c
                    WHERE NOT EXISTS (SELECT 1 FROM version x WHERE x.shipper_id = c.shipper_id)))
$$;

-- El vencimiento según cada regla aplicable; la usan las dos de abajo.
--   REQUIRED/OPTIONAL  la fecha que trae el documento (las reglas, si hay,
--                      solo aportan los días de aviso)
--   ISSUE_PLUS_MONTHS  emisión + meses
--   CALENDAR_PERIOD    el corte del período que se exige DESPUÉS del que cubre
--                      el documento: el de septiembre (período = mes anterior,
--                      corte 18) cubre hasta el 18/11, cuando se pide el de
--                      octubre. Más la gracia. Un corte 31 en un mes corto es
--                      el último día de ese mes.
--   NONE               no devuelve filas: no vence, traiga o no una fecha.
-- Un registro MISSING no vence: falta, y eso ya lo dice su estado. Un registro
-- presente sin el dato que su tipo necesita no cubre nada: -infinity.
CREATE OR REPLACE FUNCTION public.vencimientos_por_regla(
  p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
  p_expiration_date date, p_issue_date date, p_period_start date)
RETURNS TABLE (vence_el date, warning_days int)
LANGUAGE sql STABLE
AS $$
  WITH req AS (
    SELECT expiration_policy AS politica
    FROM public.compliance_requirements WHERE id = p_requirement_id
  ),
  reglas AS (
    SELECT r.* FROM req, public.reglas_aplicables(
      p_requirement_id, p_entity_type, p_entity_id,
      CASE req.politica WHEN 'ISSUE_PLUS_MONTHS' THEN p_issue_date
                        WHEN 'CALENDAR_PERIOD'   THEN p_period_start END) r
  )
  SELECT p_expiration_date, rg.warning_days
  FROM req LEFT JOIN reglas rg ON true
  WHERE req.politica IN ('REQUIRED', 'OPTIONAL') AND p_expiration_date IS NOT NULL
  UNION ALL
  SELECT CASE
           WHEN p_status = 'MISSING' THEN NULL
           WHEN req.politica = 'ISSUE_PLUS_MONTHS' THEN
             CASE WHEN p_issue_date IS NULL THEN '-infinity'::date
                  ELSE (p_issue_date + make_interval(months => rg.validity_months))::date END
           ELSE
             CASE WHEN p_period_start IS NULL THEN '-infinity'::date
                  ELSE (
                    SELECT make_date(extract(year FROM x.m)::int, extract(month FROM x.m)::int,
                             least(rg.cutoff_day,
                                   extract(day FROM (x.m + interval '1 month - 1 day'))::int))
                           + rg.grace_days
                    FROM (SELECT (p_period_start
                                  + make_interval(months => rg.period_offset_months
                                                            + rg.frequency_months))::date AS m) x
                  ) END
         END,
         rg.warning_days
  FROM req JOIN reglas rg ON true
  WHERE req.politica IN ('ISSUE_PLUS_MONTHS', 'CALENDAR_PERIOD')
$$;

-- El peor vencimiento entre los clientes. NULL = no vence, o falta.
CREATE OR REPLACE FUNCTION public.documento_vence_el(
  p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
  p_expiration_date date, p_issue_date date, p_period_start date)
RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT min(v.vence_el) FROM public.vencimientos_por_regla(
    p_requirement_id, p_entity_type, p_entity_id, p_status,
    p_expiration_date, p_issue_date, p_period_start) v
$$;

-- Desde qué día está "por vencer": el vencimiento de cada regla menos sus días
-- de aviso (los propios o, si la regla no los fija o no hay regla, el aviso
-- general de Configuración › Alertas). El peor entre los clientes.
CREATE OR REPLACE FUNCTION public.documento_aviso_desde(
  p_requirement_id uuid, p_entity_type text, p_entity_id uuid, p_status text,
  p_expiration_date date, p_issue_date date, p_period_start date)
RETURNS date
LANGUAGE sql STABLE
AS $$
  SELECT min(v.vence_el - COALESCE(v.warning_days, g.warning_days))
  FROM public.vencimientos_por_regla(
    p_requirement_id, p_entity_type, p_entity_id, p_status,
    p_expiration_date, p_issue_date, p_period_start) v
  CROSS JOIN (SELECT warning_days FROM app.alert_thresholds
              WHERE doc_type = 'documento_por_vencer') g
$$;

-- Desde cuándo se exige. Se evalúa al leer, igual que el vencimiento.
--   ON_ENTITY_START / ON_REQUEST  siempre (a ON_REQUEST lo filtra la siembra)
--   MONTH_AFTER_START  desde el día 1 del mes siguiente al ingreso del
--                      conductor (driver_assignments.start_date de su
--                      asignación ACTIVE; sin asignación, se exige)
--   ON_ENTITY_END      cuando el conductor ya no tiene asignación ACTIVE y
--                      tuvo alguna
CREATE OR REPLACE FUNCTION public.documento_exigible(
  p_requirement_id uuid, p_entity_type text, p_entity_id uuid)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT CASE req.exigible_on
    WHEN 'MONTH_AFTER_START' THEN COALESCE(
      (SELECT public.hoy_chile() >= (date_trunc('month', da.start_date) + interval '1 month')::date
       FROM public.driver_assignments da
       WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE'),
      true)
    WHEN 'ON_ENTITY_END' THEN
      NOT EXISTS (SELECT 1 FROM public.driver_assignments da
                  WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
      AND EXISTS (SELECT 1 FROM public.driver_assignments da
                  WHERE da.driver_id = p_entity_id)
    ELSE true
  END
  FROM public.compliance_requirements req
  WHERE req.id = p_requirement_id
$$;
