-- H0.4 (get_advisors): fijar search_path mutable en los triggers de refresh
-- del propio modelo, y agregar índices de cobertura para las FK sin índice
-- que el advisor de performance marcó en las tablas nuevas.

ALTER FUNCTION public.refresh_carrier_view() SET search_path = public, pg_temp;
ALTER FUNCTION public.refresh_insurance_view() SET search_path = public, pg_temp;

CREATE INDEX IF NOT EXISTS idx_asset_assignments_carrier_id ON public.asset_assignments(carrier_id);
CREATE INDEX IF NOT EXISTS idx_driver_assignments_carrier_id ON public.driver_assignments(carrier_id);
CREATE INDEX IF NOT EXISTS idx_carrier_shippers_shipper_id ON public.carrier_shippers(shipper_id);
CREATE INDEX IF NOT EXISTS idx_compliance_records_requirement_id ON public.compliance_records(requirement_id);
CREATE INDEX IF NOT EXISTS idx_compliance_requirements_shipper_id ON public.compliance_requirements(shipper_id);
CREATE INDEX IF NOT EXISTS idx_insurance_installments_policy_id ON public.insurance_installments(policy_id);
CREATE INDEX IF NOT EXISTS idx_policy_assets_asset_id ON public.policy_assets(asset_id);
CREATE INDEX IF NOT EXISTS idx_policy_coverages_coverage_type_id ON public.policy_coverages(coverage_type_id);
