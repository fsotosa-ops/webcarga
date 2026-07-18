-- Limpieza de objetos confirmados sin uso (auditoría 2026-07-18).
-- Cruzado contra: 2 proyectos dbt (tms, transporters), los 3 pipelines vivos
-- de Mage, grep de monitor-app/backend + monitor-app/frontend, dependencias
-- FK/vistas reales en la DB, y confirmación manual del usuario para los 2
-- casos donde pg_stat_user_tables mostraba actividad ambigua
-- (bronze.raw_centralizer_* se mantiene, sigue en uso manual;
-- silver.tms_trips se confirma muerta, último registro real 2026-05-13).
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

-- app.transporters.last_matched_upload_id: FK hacia app.centralizer_uploads,
-- 100% NULL en las 2792 filas actuales (feature Centralizer/Checkpoint D
-- retirada, ver AGENTLOG_ARCHIVE.md). Se dropea solo la constraint, no la
-- columna, para no exceder el alcance pedido.
ALTER TABLE app.transporters DROP CONSTRAINT IF EXISTS transporters_last_matched_upload_id_fkey;

-- Centralizer (Checkpoint D descontinuado — código fuente ya no existe)
DROP TABLE IF EXISTS app.centralizer_uploads;
DROP TABLE IF EXISTS app.centralizer_column_mappings;

-- Tablas sin dueño: sin modelo dbt, sin migración de origen, sin referencia
-- en backend/frontend, 0 filas
DROP TABLE IF EXISTS app.notifications;
DROP TABLE IF EXISTS app.trip_events;
DROP TABLE IF EXISTS app.insurance_policy_documents;

-- Vistas obsoletas, superadas por los materialized views que sí se usan
-- (driver_compliance_status, asset_compliance_status, etc.) o sin refs.
-- Orden: v_transporter_operational_status -> v_transporter_eligibility ->
-- v_transporter_compliance (cadena de dependencia entre ellas, ver error
-- real 2BP01 al aplicar la primera versión de esta migración).
DROP VIEW IF EXISTS app.v_compliance_alerts;
DROP VIEW IF EXISTS app.v_driver_eligibility;
DROP VIEW IF EXISTS app.v_insurance_installments_flat;
DROP VIEW IF EXISTS app.v_transporter_operational_status;
DROP VIEW IF EXISTS app.v_transporter_eligibility;
DROP VIEW IF EXISTS app.v_transporter_compliance;
DROP VIEW IF EXISTS app.v_vehicle_eligibility;

-- silver.tms_trips (tabla base, distinta de tms_trips_snapshot que sí está
-- activa) — no es output de ningún modelo dbt, confirmada muerta por el
-- usuario (último registro real 2026-05-13)
DROP TABLE IF EXISTS silver.tms_trips;

COMMIT;
