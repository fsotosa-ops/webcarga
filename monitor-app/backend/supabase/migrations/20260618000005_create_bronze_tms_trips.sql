-- ==============================================================================
-- MIGRACIÓN: NUEVA TABLA bronze.tms_trips (UPSERT / CURRENT-STATE)
-- Reemplaza el patrón append-only de raw_tms_trips por un staging de estado actual.
-- Naming: schema=layer (bronze), table=entity (tms_trips) — Databricks/dbt convention.
--
-- Arquitectura resultante:
--   GCS (archivos permanentes, fuente de replay)
--     ↓ Mage UPSERT
--   bronze.tms_trips          ← estado actual, ~500-1000 filas (viajes activos)
--     ↓ dbt snapshot
--   bronze.tms_trips_snapshot ← SCD Type 2, crece solo al cambiar estado
--     ↓ dbt run
--   silver / app
-- ==============================================================================

-- ── 1. Tabla de estado actual (UPSERT) ────────────────────────────────────────
CREATE TABLE bronze.tms_trips (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identidad del viaje (clave de negocio, única por viaje activo)
    tms_name        varchar     NOT NULL,
    source_client   varchar     NOT NULL,
    product         varchar     NOT NULL,
    source_trip_id  varchar     NOT NULL,

    -- Estado actual (actualizado en cada extracción que cambia el estado)
    payload         jsonb       NOT NULL,
    payload_hash    varchar     GENERATED ALWAYS AS (md5(payload::text)) STORED,
    file_name       varchar,            -- archivo que reportó este estado
    mage_run_id     varchar,

    -- Trazabilidad temporal
    first_seen_at   timestamptz NOT NULL DEFAULT now(),
    last_updated_at timestamptz NOT NULL DEFAULT now(),

    -- Una sola fila por viaje (el estado más reciente)
    UNIQUE (tms_name, source_client, product, source_trip_id)
);

COMMENT ON TABLE bronze.tms_trips IS
'Tabla de estado actual de viajes TMS. Una fila por viaje (UPSERT).
Fuente de la que dbt snapshot lee para detectar cambios de estado.
Los archivos históricos completos viven en GCS (replay disponible desde ahí).';

-- ── 2. Índices ─────────────────────────────────────────────────────────────────
CREATE INDEX idx_tms_trips_client
    ON bronze.tms_trips (tms_name, source_client, product);

CREATE INDEX idx_tms_trips_updated
    ON bronze.tms_trips (last_updated_at);

-- ── 3. RLS (lectura autenticada, escritura solo vía service_role/Mage) ─────────
ALTER TABLE bronze.tms_trips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tms_trips_read"
    ON bronze.tms_trips FOR SELECT TO authenticated USING (true);

-- ── 4. Poblar desde raw_tms_trips: estado más reciente de cada viaje ───────────
-- Criterio de "más reciente": mayor unix timestamp en el nombre del archivo.
-- Fallback a ingestion_timestamp si el nombre no tiene timestamp parseable.
INSERT INTO bronze.tms_trips (
    tms_name, source_client, product, source_trip_id,
    payload, file_name, mage_run_id,
    first_seen_at, last_updated_at
)
SELECT DISTINCT ON (tms_name, source_client, product, source_trip_id)
    tms_name, source_client, product, source_trip_id,
    payload, file_name, mage_run_id,
    MIN(ingestion_timestamp) OVER w AS first_seen_at,
    ingestion_timestamp             AS last_updated_at
FROM bronze.raw_tms_trips
WINDOW w AS (PARTITION BY tms_name, source_client, product, source_trip_id)
ORDER BY
    tms_name, source_client, product, source_trip_id,
    -- Ordenar por timestamp en nombre de archivo (unix ts al final del filename)
    CASE
        WHEN file_name ~ '_[0-9]{9,11}\.[^.]+$'
        THEN regexp_replace(split_part(file_name, '_', -1), '\.[^.]+$', '')::bigint
        ELSE EXTRACT(EPOCH FROM ingestion_timestamp)::bigint
    END DESC NULLS LAST;

-- ── 5. raw_tms_trips queda en modo lectura (deprecada, no borrar hasta validar) ─
-- DROP TABLE bronze.raw_tms_trips;  -- ejecutar solo después de validar el pipeline
-- DROP TABLE bronze.raw_tms_trips_snapshot;  -- ídem, después del dbt full-refresh
