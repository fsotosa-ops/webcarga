-- ==============================================================================
-- MIGRACIÓN 001: INICIALIZACIÓN ARQUITECTURA MEDALLÓN Y CAPA BRONZE
-- ==============================================================================

-- 1. Creación de los Esquemas (Schemas)
CREATE SCHEMA IF NOT EXISTS bronze;
CREATE SCHEMA IF NOT EXISTS silver;
CREATE SCHEMA IF NOT EXISTS gold;

-- Permitir que el rol 'service_role' (el que usará Mage.ai/Python) tenga acceso a todo
GRANT ALL ON SCHEMA bronze TO service_role;
GRANT ALL ON SCHEMA silver TO service_role;
GRANT ALL ON SCHEMA gold TO service_role;

CREATE TABLE bronze.raw_tms_trips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  
  -- Ajuste 2: Sintaxis corregida del hash
  hash_id character varying(32) GENERATED ALWAYS AS (md5(payload::text)) STORED,
  
  -- Ajuste 1: Agregamos las columnas dinámicas de nuestro pipeline
  tms_name character varying(100) NOT NULL,
  product character varying(100) NOT NULL,
  
  source_client character varying(100) NOT NULL,
  file_name character varying(255) NOT NULL,
  ingestion_timestamp timestamp with time zone DEFAULT now(),
  payload jsonb NOT NULL,
  
  sync_status character varying(20) DEFAULT 'PENDING'::character varying,
  mage_run_id character varying(100),
  processed_at timestamp with time zone,
  error_log text,
  
  CONSTRAINT raw_tms_trips_pkey PRIMARY KEY (id),
  CONSTRAINT unique_hash_id UNIQUE (hash_id)
) TABLESPACE pg_default;

-- 2. Índices para Mage.ai (Colas de procesamiento)
CREATE INDEX IF NOT EXISTS idx_bronze_pending 
ON bronze.raw_tms_trips USING btree (sync_status) TABLESPACE pg_default
WHERE ((sync_status)::text = 'PENDING'::text);

CREATE INDEX IF NOT EXISTS idx_bronze_mage_run 
ON bronze.raw_tms_trips USING btree (mage_run_id) TABLESPACE pg_default;

-- 3. Ajuste 3: Índice temporal (Recomendado para Data Lakes)
CREATE INDEX IF NOT EXISTS idx_bronze_ingestion_time 
ON bronze.raw_tms_trips USING btree (ingestion_timestamp DESC) TABLESPACE pg_default;
CREATE POLICY "Service Role Full Access on Bronze" 
ON bronze.raw_tms_trips 
FOR ALL 
TO service_role 
USING (true) 
WITH CHECK (true);
ALTER TABLE bronze.raw_tms_trips 
ADD COLUMN IF NOT EXISTS tms_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS product VARCHAR(100);