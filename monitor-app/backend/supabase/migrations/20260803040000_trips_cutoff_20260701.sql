-- Corte de datos históricos pedido explícitamente por el usuario
-- (2026-08-03): app.trips solo debe considerar viajes desde 2026-07-01.
-- El modelo dbt (dbt/tms/models/app/trips.sql) ya se corrigió para aplicar
-- este corte hacia adelante (CTE `filtered`, reusa el var `start_date` que
-- dbts/app_trips_update.yaml ya pasaba sin usar) — pero un MERGE
-- incremental normal nunca borra filas que dejan de matchear el filtro, y
-- --full-refresh de este pipeline (batch_tms_monitor_trips) es poco
-- confiable de disparar por API (ver reference_mage_run_block_broken.md).
-- Se aplica el mismo corte directo en Postgres: hijos primero
-- (trip_stops/trip_notes/trip_fleet_links, sin FK declarada pero
-- referencian trip_id), luego el padre.
DELETE FROM app.trip_stops
WHERE trip_id IN (SELECT id FROM app.trips WHERE planning_date < '2026-07-01');

DELETE FROM app.trip_notes
WHERE trip_id IN (SELECT id FROM app.trips WHERE planning_date < '2026-07-01');

DELETE FROM app.trip_fleet_links
WHERE trip_id IN (SELECT id FROM app.trips WHERE planning_date < '2026-07-01');

DELETE FROM app.trips
WHERE planning_date < '2026-07-01';
