-- 1. Borramos la tabla de prueba anterior
DROP TABLE IF EXISTS public.contacts;

-- 2. Creamos la tabla con el estándar Logtech
CREATE TABLE public.contacts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    entity_id UUID NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    contact_role VARCHAR(50) NOT NULL,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    job_title VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20),
    is_primary BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Creamos los índices de velocidad
CREATE INDEX idx_contacts_entity ON public.contacts(entity_id, entity_type);
CREATE INDEX idx_contacts_role ON public.contacts(contact_role);

-- 4. Evitamos duplicados exactos
ALTER TABLE public.contacts
ADD CONSTRAINT contacts_entity_role_email_phone_key UNIQUE (entity_id, contact_role, email, phone);