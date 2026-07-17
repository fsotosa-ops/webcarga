-- ==============================================================================
-- MIGRATION: h0_security_hardening_and_indexes (Checkpoint H0)
-- DESCRIPTION: Corrige RLS permisiva de las tablas de seguros y agrega
-- los índices faltantes de rendimiento y de "un solo activo a la vez".
-- ==============================================================================

-- ==============================================================
-- H0.1 — Retirar escritura amplia de 'authenticated' en seguros
-- ==============================================================
-- Estas 4 políticas permitían INSERT/UPDATE/DELETE directo desde el cliente
-- Supabase a cualquier usuario autenticado, sin pasar por el backend. Las
-- políticas de SELECT (lectura) se dejan intactas. Sin política de escritura,
-- RLS deniega esas operaciones salvo para service_role (que la bypassea).
DROP POLICY IF EXISTS "Installments can be inserted/updated by authenticated users" ON public.insurance_installments;
DROP POLICY IF EXISTS "Policies can be inserted/updated by authenticated users" ON public.insurance_policies;
DROP POLICY IF EXISTS "Policy assets can be managed by authenticated users" ON public.policy_assets;
DROP POLICY IF EXISTS "Policy coverages can be managed by authenticated users" ON public.policy_coverages;

-- ==============================================================
-- H0.3 — Índices faltantes
-- ==============================================================
CREATE INDEX IF NOT EXISTS idx_insurance_policies_carrier_id
ON public.insurance_policies(carrier_id);

-- "Un conductor/activo activo en una sola empresa a la vez"
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_assignments_one_active
ON public.driver_assignments(driver_id) WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_assignments_one_active
ON public.asset_assignments(asset_id) WHERE status = 'ACTIVE';
