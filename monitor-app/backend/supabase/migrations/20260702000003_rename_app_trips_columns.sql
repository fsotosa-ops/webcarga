-- Renombra columnas de app.trips para adoptar el mismo vocabulario ya
-- establecido en silver.int_tms_trips_conformed (source_system,
-- source_client_id, source_system_id, source_system_trip_id, trip_status)
-- en vez de nombres ad hoc que se venían inventando en cada capa
-- (tms_name, tms_id, tms_client_id, source_trip_id, current_status_tms) y
-- que no eran agnósticos a la TMS (milestone_status_sap).
--
-- IMPORTANTE: esta migración solo debe aplicarse DESPUÉS de desplegar el
-- código que ya consume los nombres nuevos (monitor-app/backend/api/app/routers/trips.py,
-- frontend lib/types.ts + TripTable.tsx + TripSlideOver.tsx +
-- TripCreateSlideOver.tsx + TripBulkUpload.tsx) — el servicio de Cloud Run
-- desplegado hoy todavía consulta los nombres viejos; renombrar antes del
-- deploy rompe el Diario en producción hasta que se despliegue el código.

ALTER TABLE app.trips RENAME COLUMN tms_name             TO source_system;
ALTER TABLE app.trips RENAME COLUMN tms_id                TO source_system_id;
ALTER TABLE app.trips RENAME COLUMN tms_client_id         TO source_client_id;
ALTER TABLE app.trips RENAME COLUMN source_trip_id        TO source_system_trip_id;
ALTER TABLE app.trips RENAME COLUMN current_status_tms    TO trip_status;
ALTER TABLE app.trips RENAME COLUMN milestone_status_sap  TO milestone_status;

-- Los índices creados en 20260702000001... y restaurados en la migración de
-- PK/índices se actualizan automáticamente al renombrar la columna (Postgres
-- mantiene la definición del índice apuntando a la columna renombrada) — se
-- renombran aquí solo por prolijidad, no es funcionalmente necesario.
ALTER INDEX IF EXISTS idx_trips_status_tms       RENAME TO idx_trips_trip_status;
ALTER INDEX IF EXISTS idx_trips_source_trip_id   RENAME TO idx_trips_source_system_trip_id;
