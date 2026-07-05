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
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),

  -- Identidad estable del viaje (para el unique_key del snapshot dbt)
  trip_id             CHARACTER VARYING(100) 
                        GENERATED ALWAYS AS (payload->>'trip_id') STORED,

  -- Huella del contenido (para detectar si el payload cambió)
  payload_hash        CHARACTER VARYING(32)  
                        GENERATED ALWAYS AS (md5((payload)::text)) STORED,

  tms_name            CHARACTER VARYING(100) NOT NULL,
  product             CHARACTER VARYING(100) NOT NULL,
  source_client       CHARACTER VARYING(100) NOT NULL,
  file_name           CHARACTER VARYING(255) NOT NULL,
  ingestion_timestamp TIMESTAMP WITH TIME ZONE NULL DEFAULT now(),
  payload             JSONB NOT NULL,
  sync_status         CHARACTER VARYING(20)  NULL DEFAULT 'PENDING',
  mage_run_id         CHARACTER VARYING(100) NULL,
  processed_at        TIMESTAMP WITH TIME ZONE NULL,
  error_log           TEXT NULL,

  CONSTRAINT raw_tms_trips_pkey        PRIMARY KEY (id),

  -- Unicidad: un mismo viaje del mismo TMS/cliente solo existe una vez
  CONSTRAINT unique_trip_identity UNIQUE (tms_name, source_client, product, trip_id)

) TABLESPACE pg_default;

-- Índices operacionales (sin cambios)
CREATE INDEX IF NOT EXISTS idx_bronze_pending
  ON bronze.raw_tms_trips USING btree (sync_status)
  WHERE sync_status = 'PENDING';

CREATE INDEX IF NOT EXISTS idx_bronze_mage_run
  ON bronze.raw_tms_trips USING btree (mage_run_id);

CREATE INDEX IF NOT EXISTS idx_bronze_ingestion_time
  ON bronze.raw_tms_trips USING btree (ingestion_timestamp DESC);

-- Índices nuevos para soportar snapshot y queries downstream
CREATE INDEX IF NOT EXISTS idx_bronze_trip_id
  ON bronze.raw_tms_trips USING btree (trip_id);

CREATE INDEX IF NOT EXISTS idx_bronze_payload_hash
  ON bronze.raw_tms_trips USING btree (payload_hash);