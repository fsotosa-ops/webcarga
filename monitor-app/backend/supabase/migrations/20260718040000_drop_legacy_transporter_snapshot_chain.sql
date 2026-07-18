-- Quinta ronda de limpieza (2026-07-18), a pedido explícito del usuario.
--
-- silver.transporter_profiles_legacy + snapshot_silver_drivers/trailers/
-- transporters/vehicles: aunque son el target VIVO de modelos dbt que
-- Mage sigue corriendo (pipeline legacy_drivers_transporters, bloques
-- snapshot_transporters_data / webapp_transporter_porfiles), nada en
-- backend, frontend, ni schema public los lee — un pipeline activo
-- produciendo un callejón sin salida, desconectado del modelo real que
-- usan Empresas/Seguros hoy (public.carriers/drivers/assets).
--
-- NOTA IMPORTANTE: esta migración solo borra las tablas. El pipeline
-- legacy_drivers_transporters sigue corriendo y va a RECREARLAS en la
-- próxima ejecución (los modelos dbt siguen wireados). Si se quiere una
-- limpieza definitiva hay que retirar esos 2 bloques del pipeline en Mage
-- también — pendiente de decisión del usuario.
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

DROP TABLE IF EXISTS silver.transporter_profiles_legacy;
DROP TABLE IF EXISTS silver.snapshot_silver_drivers;
DROP TABLE IF EXISTS silver.snapshot_silver_trailers;
DROP TABLE IF EXISTS silver.snapshot_silver_transporters;
DROP TABLE IF EXISTS silver.snapshot_silver_vehicles;

COMMIT;
