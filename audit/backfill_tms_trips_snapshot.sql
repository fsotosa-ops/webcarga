-- backfill_tms_trips_snapshot.sql
-- Reconstruye el historial SCD2 de trips desde bronze.raw_tms_trips
-- y lo inyecta en bronze.tms_trips_snapshot (que dbt ya creó con las versiones vigentes).
--
-- PREREQUISITO: dbt snapshot --select tms_trips_snapshot  (debe haber corrido primero)
-- CUÁNDO: Una vez, inmediatamente después del primer dbt snapshot run.
--
-- Lógica:
--   1. Extrae el timestamp unix del file_name y lo convierte a timestamptz
--   2. Ordena las extracciones por viaje y timestamp
--   3. Detecta cambios de payload_hash (= cambio de estado real)
--   4. Calcula ventanas de validez: dbt_valid_from = cuando apareció, dbt_valid_to = cuando cambió
--   5. Inserta solo las versiones CERRADAS (dbt_valid_to IS NOT NULL)
--      — las vigentes ya las insertó dbt en el paso anterior

WITH raw_with_ts AS (
    SELECT *,
        to_timestamp(
            split_part(
                regexp_replace(split_part(file_name, '/', -1), '\.[^.]+$', ''),
                '_', -1
            )::bigint
        ) AT TIME ZONE 'America/Santiago'  AS file_ts
    FROM bronze.raw_tms_trips
    WHERE product = 'trips'
      AND file_name IS NOT NULL
),
ordered AS (
    SELECT *,
        LAG(payload_hash) OVER (
            PARTITION BY tms_name, source_client, source_trip_id
            ORDER BY file_ts
        ) AS prev_hash
    FROM raw_with_ts
),
-- Solo la primera ocurrencia de cada estado por viaje
state_entries AS (
    SELECT *
    FROM ordered
    WHERE prev_hash IS NULL            -- primera extracción del viaje
       OR payload_hash != prev_hash    -- cambio de estado real
),
-- Calcula las ventanas de validez SCD2
scd2 AS (
    SELECT *,
        LEAD(file_ts) OVER (
            PARTITION BY tms_name, source_client, source_trip_id
            ORDER BY file_ts
        ) AS valid_to
    FROM state_entries
)
INSERT INTO bronze.tms_trips_snapshot (
    trip_sk,
    tms_client_sk,
    tms_name,
    source_client,
    product,
    source_trip_id,
    payload,
    payload_hash,
    file_name,
    mage_run_id,
    trip_status,
    patente,
    conductor,
    file_generated_at,
    file_period_from,
    file_period_to,
    first_seen_at,
    last_updated_at,
    dbt_scd_id,
    dbt_updated_at,
    dbt_valid_from,
    dbt_valid_to
)
SELECT
    md5(tms_name || '|' || source_client || '|' || source_trip_id)  AS trip_sk,
    md5(tms_name || '|' || source_client)                            AS tms_client_sk,
    tms_name,
    source_client,
    product,
    source_trip_id,
    payload,
    payload_hash,
    file_name,
    mage_run_id,

    CASE WHEN source_client = 'iansa'
        THEN payload->'trip_metadata'->>'Estado Rendicion'
        ELSE payload->'trip_metadata'->>'Estado'
    END AS trip_status,
    payload->'trip_metadata'->>'Patente'   AS patente,
    payload->'trip_metadata'->>'Conductor' AS conductor,

    file_ts AS file_generated_at,

    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',2),
        'YYYYMMDD'
    ) AS file_period_from,

    to_date(
        split_part(regexp_replace(split_part(file_name,'/',-1),'\.[^.]+$',''),'_',3),
        'YYYYMMDD'
    ) AS file_period_to,

    ingestion_timestamp AS first_seen_at,
    ingestion_timestamp AS last_updated_at,

    -- dbt_scd_id: hash único basado en identidad del viaje + estado + timestamp
    -- Fórmula distinta a la de dbt (que usa NOW()) → sin riesgo de colisión
    md5(
        tms_name || '|' || source_client || '|' || product || '|' || source_trip_id
        || '|' || payload_hash
        || '|' || to_char(file_ts AT TIME ZONE 'UTC', 'YYYYMMDD HH24MISS US')
    ) AS dbt_scd_id,

    file_ts AS dbt_updated_at,
    file_ts AS dbt_valid_from,
    valid_to AS dbt_valid_to

FROM scd2
WHERE valid_to IS NOT NULL  -- solo versiones históricas cerradas; las vigentes las maneja dbt

ON CONFLICT DO NOTHING;     -- idempotente: si ya existe no sobreescribe

-- Verificación post-backfill:
-- SELECT
--     COUNT(*) FILTER (WHERE dbt_valid_to IS NULL)     AS vigentes,
--     COUNT(*) FILTER (WHERE dbt_valid_to IS NOT NULL) AS historicas
-- FROM bronze.tms_trips_snapshot;
-- Esperado: ~1,751 vigentes (dbt) + ~5,932 históricas (este backfill)
