-- Fase 1 del plan de refinamiento del backlog de 17 HU (2026-07-21,
-- ver AGENTLOG.md) — "cuadratura diaria" (HU-01/02/03), el concepto que
-- Pablo (CEO) describió como "cuadrar la caja" en la reunión del 20/07:
-- todo conductor activo debe quedar clasificado al cierre del día
-- (asignado/no asignado con motivo/mismatch de flota), y el resultado debe
-- quedar guardado para que María Eugenia pueda revisar los descuadres de
-- días anteriores — no alcanza con un estado en vivo recalculable.
--
-- Grano fijo conductor × día operativo — NO es polimórfico (ver análisis
-- de arquitectura en la sesión: el polimorfismo real de este proyecto ya
-- vive en public.audit_log, reusado acá para overrides/eventos en vez de
-- crear un segundo mecanismo genérico).
CREATE TABLE app.driver_day_status (
  driver_id             uuid NOT NULL REFERENCES public.drivers(id),
  business_date         date NOT NULL,
  status                text NOT NULL CHECK (status IN ('ASSIGNED', 'UNASSIGNED', 'MISMATCH')),
  -- Motivo obligatorio (HU-02) cuando status = 'UNASSIGNED' — se valida en
  -- el endpoint de cierre (POST .../close), no acá vía CHECK: mientras el
  -- día está en curso, un conductor puede quedar sin motivo un rato largo
  -- (recién se enteró, todavía no reporta) sin que eso sea un error de
  -- escritura, solo una condición que bloquea el cierre.
  unassigned_reason_id  text REFERENCES app.unassigned_reasons(id),
  resolved_by           uuid,
  resolved_at           timestamptz,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, business_date)
);

CREATE INDEX idx_driver_day_status_business_date ON app.driver_day_status (business_date);

ALTER TABLE app.driver_day_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Driver day status is viewable by authenticated users" ON app.driver_day_status;
CREATE POLICY "Driver day status is viewable by authenticated users" ON app.driver_day_status FOR SELECT TO authenticated USING (true);

-- Snapshot de cierre por día — el "reporte guardado" que pidió Pablo
-- explícitamente ("que todos los días quede un reporte guardado de lo que
-- pasó cada día"). El detalle por conductor se reconstruye filtrando
-- driver_day_status por business_date; acá solo el resumen + quién cerró.
CREATE TABLE app.daily_closures (
  business_date   date PRIMARY KEY,
  closed_by       uuid NOT NULL,
  closed_at       timestamptz NOT NULL DEFAULT now(),
  total_drivers   integer NOT NULL,
  resolved_count  integer NOT NULL,
  override_count  integer NOT NULL DEFAULT 0
);

ALTER TABLE app.daily_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Daily closures are viewable by authenticated users" ON app.daily_closures;
CREATE POLICY "Daily closures are viewable by authenticated users" ON app.daily_closures FOR SELECT TO authenticated USING (true);
