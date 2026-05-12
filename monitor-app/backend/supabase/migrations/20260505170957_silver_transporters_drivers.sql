CREATE TABLE silver.transporters (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    -- Identificadores Legacy (Capa Bronze)
    legacy_admin_company_id INT,   -- Viene de raw_admin_companies.id
    legacy_admin_customer_id INT,  -- Viene de raw_admin_customers.company_id
    legacy_interno_admin_id INT,   -- Viene de raw_info_contacto.id_interno_admin
    
    -- Datos Maestros
    dni_transporter VARCHAR(20) UNIQUE NOT NULL,
    legal_name VARCHAR(255) NOT NULL,    -- Viene de 'razon_social'
    fantasy_name VARCHAR(255),           -- Viene de 'nombre_empresa'
    
    -- Representante Legal
    legal_rep_name VARCHAR(255),         -- Viene de 'representante_legal'
    legal_rep_email VARCHAR(255),        -- Viene de 'correo_rl'
    legal_rep_phone VARCHAR(50),         -- Viene de 'teléfono_rl'
    
    -- Contacto Operacional
    ops_contact_name VARCHAR(255),       -- Viene de 'contacto_operacional'
    ops_contact_email VARCHAR(255),      -- Viene de 'correo_contacto_operacional'
    ops_contact_phone VARCHAR(50),       -- Viene de 'tel__contacto_ops'

    -- Contacto Finanzas
    finance_contact_name VARCHAR(255),   -- Viene de 'contacto_finanzas'
    finance_contact_email VARCHAR(255),  -- Viene de 'correo_finanzas'
    finance_contact_phone VARCHAR(50),   -- Viene de 'tel_finanzas'
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);


CREATE TABLE silver.vehicles (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transporter_id UUID NOT NULL REFERENCES silver.transporters(id) ON DELETE CASCADE,
    
    -- Identificación del Equipo
    license_plate VARCHAR(15) UNIQUE NOT NULL, -- Viene de 'patente_tracto__sin_espacio_ni_guion_'
    trailer_plate VARCHAR(15),                 -- Viene de 'patente_rampla'
    vehicle_year INT,                          -- Viene de 'año_de_equipo_tracto'
    gps_provider VARCHAR(100),                 -- Viene de 'gps' (Ej: 'Samtech', 'Lax GPS')
    
    -- Estado Operacional
    status VARCHAR(50),                        -- Viene de 'estado_de_equipo' (Operativo / No Operativo)
    is_working BOOLEAN,                        -- Viene de 'trabajando' mapeado a boolean
    
    -- Vencimientos y Documentación Legales (Limpiados desde el CSV)
    technical_review_expiry DATE,              -- Viene de 're__tecnica'
    circulation_permit_expiry DATE,            -- Viene de 'p__circulación'
    gases_certificate_expiry DATE,             -- Viene de 'gases_contaminantes'
    mandatory_insurance_expiry DATE,           -- Viene de 'seguro_oblogatorio'
    
    -- Seguro de Carga
    cargo_insurance_policy_number VARCHAR(100),-- Viene de 'no__poliza'
    cargo_insurance_provider VARCHAR(100),     -- Viene de 'tipo_poliza_carga_2'
    cargo_insurance_amount_uf INT,             -- Viene de 'monto_uf_poliza_carga_1' extrayendo solo números
    cargo_insurance_expiry DATE,               -- Viene de 'vencimiento_poliza_carga_1' parseado
    
    observations TEXT,                         -- Viene de 'observaciones'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE silver.drivers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    transporter_id UUID NOT NULL REFERENCES silver.transporters(id) ON DELETE CASCADE,
    
    -- Datos del conductor
    dni_driver VARCHAR(20) UNIQUE NOT NULL,    -- Rut del conductor
    full_name VARCHAR(255) NOT NULL,           -- Viene de 'conductor'
    phone_number VARCHAR(50),                  -- Viene de 'telefono_conductor'
    
    -- Estado
    status VARCHAR(50),                        -- Viene de 'conductor_1' (Operativo / No Operativo)
    
    -- Vencimientos (El "Happy Problem" del Blueprint)
    medical_check_expiry DATE,                 -- Preparado para alertas proactivas
    criminal_record_expiry DATE,               -- Certificado de antecedentes
    safety_induction_expiry DATE,              -- Inducción
    
    observations TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);