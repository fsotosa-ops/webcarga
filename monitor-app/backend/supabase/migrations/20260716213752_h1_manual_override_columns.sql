-- H1.6: columnas de protección de ediciones manuales frente al sync bulk de Mage
-- (ver plan §G). Aplican a toda tabla que Mage puebla en bulk y que H2
-- expondrá para escritura desde la UI.
DO $$
DECLARE
    t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'carriers', 'drivers', 'assets', 'contacts', 'compliance_records',
        'driver_assignments', 'asset_assignments', 'carrier_shippers',
        'insurance_policies', 'policy_coverages', 'policy_assets', 'insurance_installments'
    ]
    LOOP
        EXECUTE format(
            'ALTER TABLE public.%I
                ADD COLUMN IF NOT EXISTS is_manual_override BOOLEAN NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS overridden_by UUID REFERENCES auth.users(id),
                ADD COLUMN IF NOT EXISTS overridden_at TIMESTAMPTZ;',
            t
        );
    END LOOP;
END $$;
