-- Seguros E2, contraer: se retiran los estados guardados y la vista materializada.
-- Spec: docs/superpowers/specs/2026-10-15-seguros-polizas-y-cuotas-design.md
--
-- Desde la Entrega 1 nadie lee ni escribe estas columnas: los estados salen de
-- app.insurance_status / app.carrier_insurance_summary, y la guarda
-- tests/test_seguros_sin_campos_viejos.py falla si alguien vuelve a usarlas.
-- Antes de borrar, cada valor queda en public.audit_log (entity_type
-- INSURANCE_POLICY, field 'retired_columns', source 'migration'), como la
-- migración de umbrales del 15/10.
--
-- Re-ejecutable: la copia solo corre mientras las columnas existen. Después de
-- esta, 20261020090000 ya no se puede volver a correr (su relleno lee
-- payment_status): es historia.

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = 'insurance_policies' AND column_name = 'status') THEN
        INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
        SELECT NULL, 'INSURANCE_POLICY', p.id, 'delete', 'retired_columns',
               jsonb_build_object(
                   'status', p.status,
                   'expiration_alert_days', p.expiration_alert_days,
                   'installments', coalesce((
                       SELECT jsonb_agg(jsonb_build_object(
                                  'id', i.id, 'payment_status', i.payment_status,
                                  'total_installments', i.total_installments, 'paid_at', i.paid_at)
                              ORDER BY i.installment_number)
                       FROM public.insurance_installments i WHERE i.policy_id = p.id), '[]'::jsonb)),
               NULL, 'migration'
        FROM public.insurance_policies p;
    END IF;
END $$;

-- La vista materializada y su refresco (la API vieja la leía; ya no).
DROP TRIGGER IF EXISTS trg_refresh_view_on_policy ON public.insurance_policies;
DROP TRIGGER IF EXISTS trg_refresh_view_on_installment ON public.insurance_installments;
DROP TRIGGER IF EXISTS trg_refresh_view_on_policy_coverages ON public.policy_coverages;
DROP TRIGGER IF EXISTS trg_refresh_view_on_policy_assets ON public.policy_assets;
DROP MATERIALIZED VIEW IF EXISTS app.carrier_insurance_status;
DROP FUNCTION IF EXISTS public.refresh_insurance_view();

-- Los estados guardados y la copia del número de cuotas.
ALTER TABLE public.insurance_policies
    DROP COLUMN IF EXISTS status,
    DROP COLUMN IF EXISTS expiration_alert_days;
ALTER TABLE public.insurance_installments
    DROP COLUMN IF EXISTS payment_status,
    DROP COLUMN IF EXISTS total_installments,
    DROP COLUMN IF EXISTS paid_at;
