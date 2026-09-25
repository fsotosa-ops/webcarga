-- Registro de archivos ingeridos: el estado del proceso sale de la tabla de datos.
--
-- QUÉ ESTABA MAL
-- El pipeline `batch_tms_monitor_trips` guardaba su propio estado de proceso en las
-- columnas de bronze.tms_trips:
--   * Los 5 processors decidían qué archivos de GCS leer con
--     `SELECT file_name ... ORDER BY last_updated_at DESC LIMIT 1` (marca de agua).
--   * La alarma de "SAP caído" (stg_qanalytics_trips.sap_block_liveness) leía
--     MAX(last_updated_at).
-- Para que las dos siguieran avanzando, cada upsert reescribía TODAS las filas del
-- archivo aunque nada hubiera cambiado: payload jsonb (TOAST), índices y WAL cada
-- 15 minutos, las 24 horas. En plan free eso agotó el Disk IO de la base el 24/09
-- (16:45 CL) y con ella Supabase Auth (login con 504).
--
-- QUÉ CAMBIA
-- Una fila por archivo de GCS. El processor la registra al leer el archivo
-- ('pending', o 'empty' si no trae filas), y el bloque insert_raw_* la cierra como
-- 'loaded' en la misma corrida en que aterriza. Con esto el upsert puede saltarse
-- los viajes que no cambiaron, un archivo que llega atrasado ya no se pierde
-- (la selección es "no está en el registro", no "timestamp mayor al último"),
-- y reprocesar un archivo es borrar su fila.
--
-- `stream` es el prefijo de GCS que lista cada processor: es la identidad que el
-- processor ya usa, no un vocabulario nuevo.

BEGIN;

CREATE TABLE IF NOT EXISTS bronze.ingested_files (
    file_name    text PRIMARY KEY,               -- gs://bucket/objeto, igual que bronze.tms_trips.file_name
    stream       text NOT NULL,                  -- prefijo de GCS del processor
    file_ts      bigint NOT NULL,                -- epoch embebido en el nombre del archivo
    status       text NOT NULL
                 CHECK (status IN ('pending', 'loaded', 'empty')),
    rows_landed  integer,
    selected_at  timestamptz NOT NULL DEFAULT now(),
    loaded_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ingested_files_stream_ts
    ON bronze.ingested_files (stream, file_ts DESC);

COMMENT ON TABLE bronze.ingested_files IS
  'Una fila por archivo de GCS leído por batch_tms_monitor_trips. pending = leído, '
  'todavía no aterrizado; loaded = aterrizó en bronze.tms_trips; empty = no traía filas '
  'que aterrizar. Los processors seleccionan archivos que NO están aquí; la alarma de '
  'SAP caído lee MAX(loaded_at) del stream SAP. Ver migración 20260924100000.';

-- Siembra: todo archivo que hoy es la versión vigente de algún viaje ya fue ingerido.
-- Sin esto, el primer despliegue reprocesaría todo lo que el processor encuentre
-- dentro de su ventana de gracia.
INSERT INTO bronze.ingested_files (file_name, stream, file_ts, status, rows_landed, selected_at, loaded_at)
SELECT
    t.file_name,
    s.stream,
    regexp_replace(split_part(t.file_name, '_', -1), '\.[^.]+$', '')::bigint,
    'loaded',
    count(*),
    max(t.last_updated_at),
    max(t.last_updated_at)
FROM bronze.tms_trips t
JOIN (VALUES
    ('tms/qanalytics/trips/walmart/'),
    ('tms/sodimac/trips/'),
    ('tms/wingsuite/trips/'),
    ('tms/qanalytics/cumplimiento-sap/'),
    ('tms/qanalytics/cumplimiento-iansa/iansa/')
) AS s(stream)
  ON t.file_name LIKE 'gs://sandbox-webcarga/' || s.stream || '%'
WHERE split_part(t.file_name, '_', -1) ~ '^[0-9]+\.[^.]+$'
GROUP BY t.file_name, s.stream
ON CONFLICT (file_name) DO NOTHING;

COMMIT;
