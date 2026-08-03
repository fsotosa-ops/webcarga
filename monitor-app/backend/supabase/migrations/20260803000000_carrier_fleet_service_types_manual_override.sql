-- carrier_fleet_service_types quedó fuera de la migración H1.6
-- (20260716213752_h1_manual_override_columns.sql) porque se creó después
-- (20260802040000). Mismo patrón: protege ediciones manuales de la UI
-- frente al sync bulk de Mage que viene (Tipo de Operación, HU §2.2).
ALTER TABLE public.carrier_fleet_service_types
    ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS overridden_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ;
