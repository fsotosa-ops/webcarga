-- Corrige inconsistencia de nomenclatura introducida en la migración
-- trip_hybrid_date_fields (mismo día): todos los timestamps del schema usan
-- sufijo _at (created_at, edited_at, status_reported_at, pipeline_updated_at)
-- salvo cag_inicio/cag_fin, que quedaron sin sufijo. Corregido antes de que
-- se propague más código sobre el nombre viejo.
ALTER TABLE app.trips RENAME COLUMN cag_inicio TO cag_inicio_at;
ALTER TABLE app.trips RENAME COLUMN cag_fin TO cag_fin_at;
