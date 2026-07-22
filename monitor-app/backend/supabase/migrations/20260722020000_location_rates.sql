-- Fase 5 (HU-17, Tarifario 1.0, 2026-07-22): tarifa por local, con
-- vigencia. Tabla separada de public.locations (no columnas nuevas ahí) a
-- propósito — locations es consumida por el Diario y por el banner de
-- completitud de Fase 4, que no necesitan saber nada de tarifas ni de su
-- historial; mezclar ambos forzaría a esos consumidores a filtrar "fila
-- vigente" sin que les importe. Mismo patrón que carriers/drivers/assets
-- vs. compliance_records/insurance_policies (entidad descriptiva actual vs.
-- historial de eventos sobre esa entidad).
--
-- tarifa es texto libre a propósito, no numérico — la tarifa real depende
-- de contexto de viaje (tipo de carga, condiciones negociadas) que este
-- proyecto no modela; imponerle estructura numérica sería falsa precisión
-- (decisión explícita del usuario, ver
-- docs/superpowers/specs/2026-07-22-tarifario-design.md).
--
-- "Vigente" se calcula, no se almacena: valid_from <= hoy AND (valid_to IS
-- NULL OR valid_to >= hoy). Cada cambio de tarifa es una fila nueva — el
-- historial se preserva, nunca se pisa una fila existente.
CREATE TABLE public.location_rates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL REFERENCES public.locations(id),
  tarifa      text NOT NULL,
  valid_from  date NOT NULL DEFAULT CURRENT_DATE,
  valid_to    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES public.profiles(id)
);

CREATE INDEX idx_location_rates_location ON public.location_rates (location_id, valid_from DESC);

ALTER TABLE public.location_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Location rates are viewable by authenticated users"
  ON public.location_rates FOR SELECT TO authenticated USING (true);
CREATE POLICY "Location rates can be managed by authenticated users"
  ON public.location_rates FOR ALL TO authenticated USING (true) WITH CHECK (true);
