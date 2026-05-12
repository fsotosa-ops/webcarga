-- ==============================================================================
-- MIGRACIÓN 002: CREACIÓN DE TABLA SILVER.NORMALIZED_TRIPS
-- ==============================================================================

CREATE TABLE IF NOT EXISTS silver.tms_trips (
    ---------------------------------------------------------------------------
    -- 1. IDENTIFICADORES MAESTROS
    ---------------------------------------------------------------------------
    -- Usamos status_id como PRIMARY KEY. Como un mismo 'otm_id' (viaje + local) 
    -- puede pasar por distintos estados (ASIGNADO, EN RUTA, FINALIZADO), 
    -- el status_id garantiza la unicidad del evento logístico completo.
    status_id uuid NOT NULL,
    otm_id uuid NOT NULL,
    source_trip_id character varying(100),
    tms_id uuid NOT NULL,
    tms_name character varying(100) NOT NULL,
    client_id uuid NOT NULL,
    client_name character varying(100) NOT NULL,

    ---------------------------------------------------------------------------
    -- 2. TABLA: TRIPS (Transaccional)
    ---------------------------------------------------------------------------
    status character varying(50),
    control character varying(100),
    reference_number character varying(100),
    cargo_type character varying(100),
    transport character varying(150),
    local character varying(255),
    s2s character varying(255),
    temperature numeric(10,2), -- Precisión para grados con decimales (ej. -19.28)

    ---------------------------------------------------------------------------
    -- 3. TABLA: TRIP_MILESTONES (Timestamps de trazabilidad)
    ---------------------------------------------------------------------------
    -- Nota: En la query extraemos como varchar. Si en el futuro logras 
    -- limpiar el formato de fecha directo desde Bronze, deberías cambiar 
    -- estos campos a 'timestamp with time zone'.
    planning_date character varying(50),
    arrival_date character varying(50),
    departure_date character varying(50),
    unload_start character varying(50),
    unload_end character varying(50),
    gps_arrival_date character varying(50),
    gps_departure_date character varying(50),

    ---------------------------------------------------------------------------
    -- 4. TABLA: VEHICLES & DRIVERS (Entidades de Flota)
    ---------------------------------------------------------------------------
    tractor_plate character varying(20),
    trailer_plate character varying(20),
    driver character varying(255),

    ---------------------------------------------------------------------------
    -- 5. AUDITORÍA Y METADATOS
    ---------------------------------------------------------------------------
    raw_file_metadata jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),

    -- Restricciones
    CONSTRAINT normalized_trips_pkey PRIMARY KEY (status_id)
) TABLESPACE pg_default;

---------------------------------------------------------------------------
-- ÍNDICES PARA RENDIMIENTO (Crucial para búsquedas y cruces analíticos)
---------------------------------------------------------------------------

-- Índice para buscar todas las paradas/estados de un mismo viaje normalizado
CREATE INDEX IF NOT EXISTS idx_silver_trips_otm_id 
ON silver.tms_trips USING btree (otm_id) TABLESPACE pg_default;

-- Índice para búsquedas por el ID comercial (SAP / Orden de compra)
CREATE INDEX IF NOT EXISTS idx_silver_trips_reference 
ON silver.tms_trips USING btree (reference_number) TABLESPACE pg_default;

-- Índice para filtrar rápidamente por cliente o TMS
CREATE INDEX IF NOT EXISTS idx_silver_trips_tms_client 
ON silver.tms_trips USING btree (tms_name, client_name) TABLESPACE pg_default;

-- Otorgar permisos al rol de servicio (Mage.ai / Python)
GRANT ALL ON TABLE silver.tms_trips TO service_role;