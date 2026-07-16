-- ==============================================================
-- CAPA SILVER: TABLAS TRANSACCIONALES (Schema: public)
-- ==============================================================

-- 1. Master Data (Entidades Core)
CREATE TABLE public.shippers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.carriers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    legacy_admin_id VARCHAR(100) UNIQUE, -- ID del App V1 para facturación
    erp_id VARCHAR(100) UNIQUE,
    rut VARCHAR(20) NOT NULL UNIQUE,
    dv VARCHAR(1) NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    tax_role BOOLEAN DEFAULT true,
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.drivers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rut VARCHAR(20) NOT NULL UNIQUE,
    dv VARCHAR(1) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    license_plate VARCHAR(20) NOT NULL UNIQUE,
    asset_type VARCHAR(100) NOT NULL, 
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Junction Tables (Relaciones Multi-Cliente y Trazabilidad)
CREATE TABLE public.carrier_shippers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    shipper_id UUID REFERENCES public.shippers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(carrier_id, shipper_id)
);

CREATE TABLE public.driver_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.asset_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Motor de Cumplimiento (Compliance Engine)
CREATE TABLE public.compliance_requirements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    target_entity VARCHAR(50) NOT NULL CHECK (target_entity IN ('CARRIER', 'DRIVER', 'ASSET')),
    shipper_id UUID REFERENCES public.shippers(id) ON DELETE CASCADE, -- NULL = Requisito Base/Legal
    requirement_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    requirement_level VARCHAR(50) NOT NULL CHECK (requirement_level IN ('LEGAL_MANDATORY', 'SHIPPER_REQUIRED', 'CONDITIONAL_OPTIONAL')),
    requires_file BOOLEAN DEFAULT false,
    has_expiration BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(target_entity, shipper_id, requirement_code)
);

CREATE TABLE public.compliance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entity_id UUID NOT NULL, 
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('CARRIER', 'DRIVER', 'ASSET')),
    requirement_id UUID REFERENCES public.compliance_requirements(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'PENDING_REVIEW', 'APPROVED_MANUAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'ARCHIVED')),
    expiration_date DATE,
    file_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_current BOOLEAN DEFAULT true,
    verified_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(entity_id, requirement_id)
);

-- Índice parcial para control de versiones
CREATE UNIQUE INDEX idx_unique_current_compliance 
ON public.compliance_records (entity_id, requirement_id) 
WHERE is_current = true;

-- ==============================================================
-- CAPA SILVER: TABLAS TRANSACCIONALES (Schema: public)
-- ==============================================================

-- 1. Master Data (Entidades Core)
CREATE TABLE public.shippers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.carriers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    legacy_admin_id VARCHAR(100) UNIQUE, -- ID del App V1 para facturación
    erp_id VARCHAR(100) UNIQUE,
    rut VARCHAR(20) NOT NULL UNIQUE,
    dv VARCHAR(1) NOT NULL,
    business_name VARCHAR(255) NOT NULL,
    tax_role BOOLEAN DEFAULT true,
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.drivers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    rut VARCHAR(20) NOT NULL UNIQUE,
    dv VARCHAR(1) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.assets (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    license_plate VARCHAR(20) NOT NULL UNIQUE,
    asset_type VARCHAR(100) NOT NULL, 
    operational_status VARCHAR(50) DEFAULT 'ACTIVE',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 2. Junction Tables (Relaciones Multi-Cliente y Trazabilidad)
CREATE TABLE public.carrier_shippers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    shipper_id UUID REFERENCES public.shippers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(carrier_id, shipper_id)
);

CREATE TABLE public.driver_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

CREATE TABLE public.asset_assignments (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    asset_id UUID REFERENCES public.assets(id) ON DELETE CASCADE,
    carrier_id UUID REFERENCES public.carriers(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 3. Motor de Cumplimiento (Compliance Engine)
CREATE TABLE public.compliance_requirements (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    target_entity VARCHAR(50) NOT NULL CHECK (target_entity IN ('CARRIER', 'DRIVER', 'ASSET')),
    shipper_id UUID REFERENCES public.shippers(id) ON DELETE CASCADE, -- NULL = Requisito Base/Legal
    requirement_code VARCHAR(100) NOT NULL,
    name VARCHAR(255) NOT NULL,
    requirement_level VARCHAR(50) NOT NULL CHECK (requirement_level IN ('LEGAL_MANDATORY', 'SHIPPER_REQUIRED', 'CONDITIONAL_OPTIONAL')),
    requires_file BOOLEAN DEFAULT false,
    has_expiration BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(target_entity, shipper_id, requirement_code)
);

CREATE TABLE public.compliance_records (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entity_id UUID NOT NULL, 
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('CARRIER', 'DRIVER', 'ASSET')),
    requirement_id UUID REFERENCES public.compliance_requirements(id) ON DELETE CASCADE,
    status VARCHAR(50) DEFAULT 'MISSING' CHECK (status IN ('MISSING', 'PENDING_REVIEW', 'APPROVED_MANUAL', 'APPROVED', 'REJECTED', 'EXPIRED', 'ARCHIVED')),
    expiration_date DATE,
    file_url TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    is_current BOOLEAN DEFAULT true,
    verified_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    UNIQUE(entity_id, requirement_id)
);

-- Índice parcial para control de versiones
CREATE UNIQUE INDEX idx_unique_current_compliance 
ON public.compliance_records (entity_id, requirement_id) 
WHERE is_current = true;

-- ==============================================================
-- CAPA GOLD: VISTAS MATERIALIZADAS PARA EL FRONTEND (Schema: app)
-- ==============================================================

CREATE SCHEMA IF NOT EXISTS app;

-- Vista Materializada con cálculo automático de Avance 80/20 y Avance Total
CREATE MATERIALIZED VIEW app.carrier_compliance_status AS
WITH compliance_stats AS (
    SELECT 
        cr.entity_id,
        COUNT(*) FILTER (WHERE req.requirement_level = 'LEGAL_MANDATORY') as total_mandatory,
        COUNT(*) FILTER (WHERE req.requirement_level = 'LEGAL_MANDATORY' AND cr.status IN ('APPROVED', 'APPROVED_MANUAL')) as approved_mandatory,
        COUNT(*) as total_reqs,
        COUNT(*) FILTER (WHERE cr.status IN ('APPROVED', 'APPROVED_MANUAL')) as approved_total
    FROM public.compliance_records cr
    JOIN public.compliance_requirements req ON cr.requirement_id = req.id
    WHERE cr.is_current = true AND cr.entity_type = 'CARRIER'
    GROUP BY cr.entity_id
)
SELECT 
    c.id,
    c.legacy_admin_id,
    c.erp_id,
    c.rut,
    c.dv,
    c.business_name,
    c.operational_status,
    
    -- KPIs de Cumplimiento (Reemplaza las fórmulas de Excel)
    COALESCE(stats.total_mandatory, 0) as required_base_docs,
    COALESCE(stats.approved_mandatory, 0) as approved_base_docs,
    CASE 
        WHEN COALESCE(stats.total_mandatory, 0) = 0 THEN 0 
        ELSE ROUND((stats.approved_mandatory::numeric / stats.total_mandatory::numeric) * 100, 0) 
    END as avance_base_percent,
    CASE 
        WHEN COALESCE(stats.total_reqs, 0) = 0 THEN 0 
        ELSE ROUND((stats.approved_total::numeric / stats.total_reqs::numeric) * 100, 0) 
    END as avance_total_percent,

    -- Generadores de carga asociados
    COALESCE(
        jsonb_agg(
            DISTINCT jsonb_build_object('shipper_id', s.id, 'shipper_name', s.name)
        ) FILTER (WHERE s.id IS NOT NULL), '[]'::jsonb
    ) as active_shippers,
    
    -- Documentos anidados
    COALESCE(
        jsonb_agg(
            DISTINCT jsonb_build_object(
                'record_id', cr.id,
                'requirement_code', req.requirement_code,
                'name', req.name,
                'level', req.requirement_level,
                'status', cr.status,
                'expiration_date', cr.expiration_date,
                'file_url', cr.file_url,
                'metadata', cr.metadata,
                'requires_file', req.requires_file
            )
        ) FILTER (WHERE cr.id IS NOT NULL), '[]'::jsonb
    ) as compliance_documents
FROM public.carriers c
LEFT JOIN public.carrier_shippers c_ship ON c.id = c_ship.carrier_id AND c_ship.status = 'ACTIVE'
LEFT JOIN public.shippers s ON c_ship.shipper_id = s.id
LEFT JOIN public.compliance_records cr ON c.id = cr.entity_id AND cr.entity_type = 'CARRIER' AND cr.is_current = true
LEFT JOIN public.compliance_requirements req ON cr.requirement_id = req.id
LEFT JOIN compliance_stats stats ON c.id = stats.entity_id
GROUP BY c.id, c.legacy_admin_id, c.erp_id, c.rut, c.dv, c.business_name, c.operational_status, stats.total_mandatory, stats.approved_mandatory, stats.total_reqs, stats.approved_total;

-- Índice para actualización concurrente
CREATE UNIQUE INDEX idx_carrier_status_id ON app.carrier_compliance_status(id);

-- Función y Trigger de actualización automática
CREATE OR REPLACE FUNCTION public.refresh_carrier_view()
RETURNS TRIGGER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY app.carrier_compliance_status;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_refresh_view_on_compliance
AFTER INSERT OR UPDATE OR DELETE ON public.compliance_records
FOR EACH STATEMENT EXECUTE FUNCTION public.refresh_carrier_view();

-- Permisos de seguridad para Monitor-App
GRANT USAGE ON SCHEMA app TO authenticated;
GRANT SELECT ON app.carrier_compliance_status TO authenticated;

