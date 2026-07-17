-- H2 (pre-requisito de H2.2): dirección inversa de H1.3 — cuando se crea una
-- entidad nueva (carrier/driver/asset), sembrar MISSING para los requirements
-- LEGAL_MANDATORY existentes. Sin esto, tanto el onboarding manual (H2.2)
-- como las altas bulk de Mage dejan la entidad sin ningún compliance_record.

CREATE OR REPLACE FUNCTION public.reconcile_new_carrier()
RETURNS TRIGGER AS $$
BEGIN
    -- Solo requisitos base (sin shipper) — los shipper-scoped se reconcilian
    -- vía trg_reconcile_carrier_shipper (H1.4) cuando se crea la relación,
    -- que una empresa recién creada todavía no tiene.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'CARRIER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'CARRIER' AND req.requirement_level = 'LEGAL_MANDATORY' AND req.shipper_id IS NULL
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_reconcile_new_carrier
AFTER INSERT ON public.carriers
FOR EACH ROW EXECUTE FUNCTION public.reconcile_new_carrier();

CREATE OR REPLACE FUNCTION public.reconcile_new_driver()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'DRIVER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'DRIVER' AND req.requirement_level = 'LEGAL_MANDATORY'
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_reconcile_new_driver
AFTER INSERT ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.reconcile_new_driver();

CREATE OR REPLACE FUNCTION public.reconcile_new_asset()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'ASSET', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'ASSET' AND req.requirement_level = 'LEGAL_MANDATORY'
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_reconcile_new_asset
AFTER INSERT ON public.assets
FOR EACH ROW EXECUTE FUNCTION public.reconcile_new_asset();

-- Backfill único contra las entidades ya cargadas (246 carriers / 85 drivers
-- / 117 assets al momento de este checkpoint) — los triggers de arriba solo
-- cubren altas futuras.
INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT c.id, 'CARRIER', req.id, 'MISSING', true
FROM public.carriers c
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'CARRIER' AND req.requirement_level = 'LEGAL_MANDATORY' AND req.shipper_id IS NULL
ON CONFLICT (entity_id, requirement_id) DO NOTHING;

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT cs.carrier_id, 'CARRIER', req.id, 'MISSING', true
FROM public.carrier_shippers cs
JOIN public.compliance_requirements req ON req.target_entity = 'CARRIER' AND req.shipper_id = cs.shipper_id
WHERE cs.status = 'ACTIVE'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT d.id, 'DRIVER', req.id, 'MISSING', true
FROM public.drivers d
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'DRIVER' AND req.requirement_level = 'LEGAL_MANDATORY'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT a.id, 'ASSET', req.id, 'MISSING', true
FROM public.assets a
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'ASSET' AND req.requirement_level = 'LEGAL_MANDATORY'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;
