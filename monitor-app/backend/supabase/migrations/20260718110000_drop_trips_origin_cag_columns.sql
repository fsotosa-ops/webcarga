-- Fase 1 del hardening del Diario (2026-07-18) — cutover final: origen
-- unificado como parada 0 en app.trip_stops (ver migraciones 20260718080000,
-- 20260718090000, 20260718100000). Estas 3 columnas quedaron sin ningún
-- escritor ni lector desde este cutover:
--   - origin: reemplazada por la parada stop_type=ORIGIN (local); trips.py
--     la deriva en runtime (_attach_origin) para no romper consumidores
--     que solo necesitan el nombre.
--   - cag_inicio_at/cag_fin_at (Carga Inicio/Fin): reemplazadas por
--     desc_inicio_manual/desc_fin_manual de la MISMA parada ORIGIN — mismo
--     mecanismo que Desc. Inicio/Fin de cualquier destino
--     (PATCH /trips/{id}/stops/{stop_id}).
--
-- origin_region/origin_city NO se tocan — siguen siendo un filtro real y
-- activo del Diario (clasificación manual región/ciudad), sin relación con
-- la unificación de origen como parada de timeline.
--
-- Verificado antes de aplicar: sin vistas ni funciones que dependan de
-- estas columnas (pg_depend/pg_proc, 0 resultados). El modelo dbt
-- (app/trips.sql) ya se actualizó y sincronizó a Mage para dejar de
-- producirlas — dbt las hubiera eliminado solo en la próxima corrida
-- (on_schema_change='sync_all_columns'), pero se dropean acá de forma
-- explícita para no depender de ese comportamiento implícito, y porque
-- app.trips_manual (tabla del backend, no de dbt) necesita el DROP de
-- todas formas.

BEGIN;

ALTER TABLE app.trips
    DROP COLUMN IF EXISTS origin,
    DROP COLUMN IF EXISTS cag_inicio_at,
    DROP COLUMN IF EXISTS cag_fin_at;

ALTER TABLE app.trips_manual
    DROP COLUMN IF EXISTS origin,
    DROP COLUMN IF EXISTS cag_inicio_at,
    DROP COLUMN IF EXISTS cag_fin_at;

COMMIT;
