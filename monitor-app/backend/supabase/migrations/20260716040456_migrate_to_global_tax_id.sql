-- ==============================================================================
-- MIGRATION: migrate_to_global_tax_id
-- DESCRIPTION: Transición del modelo local (RUT/DV) al estándar global (tax_id).
-- ==============================================================================

-- 1. BOTAR DEPENDENCIAS PRIMERO
DROP MATERIALIZED VIEW IF EXISTS app.carrier_compliance_status;
DROP MATERIALIZED VIEW IF EXISTS app.driver_compliance_status;

-- 2. ALTERAR TABLA CARRIERS
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'CL';
ALTER TABLE public.carriers ADD COLUMN IF NOT EXISTS legacy_admin_id VARCHAR(50);

UPDATE public.carriers SET tax_id = rut || '-' || dv WHERE rut IS NOT NULL;

ALTER TABLE public.carriers DROP COLUMN IF EXISTS rut;
ALTER TABLE public.carriers DROP COLUMN IF EXISTS dv;
ALTER TABLE public.carriers ADD CONSTRAINT carriers_tax_id_key UNIQUE (tax_id);

-- 3. ALTERAR TABLA DRIVERS
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50);
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS country_code VARCHAR(2) DEFAULT 'CL';
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS legacy_admin_id VARCHAR(50);

UPDATE public.drivers SET tax_id = rut || '-' || dv WHERE rut IS NOT NULL;

ALTER TABLE public.drivers DROP COLUMN IF EXISTS rut;
ALTER TABLE public.drivers DROP COLUMN IF EXISTS dv;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_tax_id_key UNIQUE (tax_id);

-- 4. RECREAR VISTAS MATERIALIZADAS CON EL NUEVO ESQUEMA
CREATE MATERIALIZED VIEW app.carrier_compliance_status AS
SELECT 
    c.id AS carrier_id,
    c.tax_id,
    c.country_code,
    c.business_name,
    c.operational_status, 
    COUNT(cr.id) AS total_requirements,
    -- ... (todo el código de la vista que armamos)
    MAX(cr.updated_at) AS last_document_update
FROM public.carriers c
LEFT JOIN public.compliance_records cr 
    ON c.id = cr.entity_id AND cr.entity_type = 'CARRIER' AND cr.is_current = true
GROUP BY c.id, c.tax_id, c.country_code, c.business_name, c.operational_status;

CREATE UNIQUE INDEX idx_carrier_compliance_view_id ON app.carrier_compliance_status (carrier_id);