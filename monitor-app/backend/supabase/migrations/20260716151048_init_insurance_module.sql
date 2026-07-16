-- ==============================================================================
-- MIGRATION: init_insurance_module
-- DESCRIPTION: Inicialización del Módulo de Seguros (Pólizas, Cuotas y Catálogos),
-- alertas dinámicas, y su integración con el Motor de Cumplimiento.
-- ==============================================================================

-- ==============================================================
-- 1. TABLA CATÁLOGO: TIPOS DE COBERTURA
-- ==============================================================
CREATE TABLE public.coverage_types (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE,          
    name VARCHAR(100) NOT NULL,                
    description TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.coverage_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Coverage types are viewable by authenticated users" ON public.coverage_types FOR SELECT TO authenticated USING (true);


-- ==============================================================
-- 2. TABLA PRINCIPAL: PÓLIZAS DE SEGUROS (O1)
-- ==============================================================
CREATE TABLE public.insurance_policies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    coverage_type_id UUID REFERENCES public.coverage_types(id) ON DELETE RESTRICT,
    
    insurance_company VARCHAR(100) NOT NULL,
    policy_number VARCHAR(100),
    valid_from DATE,
    valid_to DATE,
    
    -- CONFIGURACIÓN DE ALERTA DINÁMICA
    expiration_alert_days INT DEFAULT 30,
    
    -- ARCHIVOS Y URLS
    policy_document_url TEXT,                  
    has_endorsement BOOLEAN DEFAULT false,     
    endorsement_document_url TEXT,             
    external_portal_url TEXT,                  
    
    status VARCHAR(50) DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'CANCELLED')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.insurance_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Policies are viewable by authenticated users" ON public.insurance_policies FOR SELECT TO authenticated USING (true);
CREATE POLICY "Policies can be inserted/updated by authenticated users" ON public.insurance_policies FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ==============================================================
-- 3. TABLA SECUNDARIA: COBRANZA Y CUOTAS (O2)
-- ==============================================================
CREATE TABLE public.insurance_installments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    policy_id UUID REFERENCES public.insurance_policies(id) ON DELETE CASCADE,
    
    installment_number INT NOT NULL,
    total_installments INT NOT NULL,
    amount_uf NUMERIC(10, 2),
    due_date DATE,
    
    payment_status VARCHAR(50) DEFAULT 'PENDING' CHECK (payment_status IN ('PENDING', 'PAID', 'OVERDUE')),
    paid_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.insurance_installments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Installments are viewable by authenticated users" ON public.insurance_installments FOR SELECT TO authenticated USING (true);
CREATE POLICY "Installments can be inserted/updated by authenticated users" ON public.insurance_installments FOR ALL TO authenticated USING (true) WITH CHECK (true);


-- ==============================================================
-- 4. INTEGRACIÓN CON EL MOTOR DE CUMPLIMIENTO
-- ==============================================================
INSERT INTO public.compliance_requirements 
    (target_entity, requirement_code, name, requirement_level, requires_file, has_expiration)
VALUES 
    ('CARRIER', 'INSURANCE_POLICY', 'Póliza de Seguro Vigente', 'LEGAL_MANDATORY', true, true)
ON CONFLICT (target_entity, shipper_id, requirement_code) DO NOTHING;


-- ==============================================================
-- 5. VISTA MATERIALIZADA (FRONTEND DASHBOARD)
-- ==============================================================
CREATE MATERIALIZED VIEW app.carrier_insurance_status AS
SELECT 
    p.id AS policy_id,
    c.id AS carrier_id,
    c.business_name AS carrier_name,
    c.tax_id,
    p.insurance_company,
    p.policy_number,
    ct.name AS coverage_name,
    p.valid_to AS policy_expiration_date,
    p.expiration_alert_days,
    p.has_endorsement,
    p.external_portal_url,
    
    -- Flag para la transición: Indica si falta el archivo físico
    (p.policy_document_url IS NULL) AS missing_physical_file,
    
    -- Alerta Dinámica de Póliza (Basada en la configuración del usuario)
    CASE 
        WHEN p.status = 'CANCELLED' THEN 'CANCELLED'
        WHEN p.valid_to < CURRENT_DATE THEN 'EXPIRED'
        WHEN p.valid_to <= CURRENT_DATE + (p.expiration_alert_days || ' days')::interval THEN 'EXPIRING_SOON'
        ELSE 'VALID'
    END AS policy_health,
    
    -- Métricas de Cuotas
    COUNT(i.id) AS total_installments,
    COUNT(i.id) FILTER (WHERE i.payment_status = 'PAID') AS paid_installments,
    COUNT(i.id) FILTER (WHERE i.payment_status = 'OVERDUE' OR (i.payment_status = 'PENDING' AND i.due_date < CURRENT_DATE)) AS overdue_installments,
    MIN(i.due_date) FILTER (WHERE i.payment_status = 'PENDING') AS next_payment_date

FROM public.insurance_policies p
JOIN public.carriers c ON p.carrier_id = c.id
LEFT JOIN public.coverage_types ct ON p.coverage_type_id = ct.id
LEFT JOIN public.insurance_installments i ON p.id = i.policy_id
GROUP BY 
    p.id, c.id, c.business_name, c.tax_id, p.insurance_company, 
    p.policy_number, ct.name, p.valid_to, p.expiration_alert_days,
    p.has_endorsement, p.external_portal_url, p.policy_document_url, p.status;

-- Índice único requerido para permitir REFRESH CONCURRENTLY
CREATE UNIQUE INDEX idx_carrier_insurance_view_policy_id ON app.carrier_insurance_status (policy_id);


-- ==============================================================
-- 6. FUNCIONES Y TRIGGERS PARA REFRESH REACTIVO (UI)
-- ==============================================================
CREATE OR REPLACE FUNCTION public.refresh_insurance_view()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.carrier_insurance_status;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger: Cambios en las pólizas
CREATE TRIGGER trg_refresh_view_on_policy
AFTER INSERT OR UPDATE OR DELETE ON public.insurance_policies
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_insurance_view();

-- Trigger: Cambios en las cuotas
CREATE TRIGGER trg_refresh_view_on_installment
AFTER INSERT OR UPDATE OR DELETE ON public.insurance_installments
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_insurance_view();


-- ==============================================================
-- 7. PERMISOS DE SEGURIDAD (MONITOR-APP)
-- ==============================================================
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT SELECT ON app.carrier_insurance_status TO authenticated;