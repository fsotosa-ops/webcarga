-- Segunda ronda de limpieza (2026-07-18, mismo audit que
-- 20260718000000_drop_confirmed_unused_objects.sql).
--
-- app.carrier_compliance_status queda FUERA de esta ronda: pese a no tener
-- ninguna referencia en backend/frontend, el usuario confirmó que sigue
-- ejecutando manualmente su refresh (custom/load_carrier_compliance_status_10.sql
-- en Mage, huérfano del DAG pero corrido a mano) — mismo patrón que
-- bronze.raw_centralizer_* en la ronda anterior, ver
-- feedback_mage_orphaned_block_still_runnable.
--
-- app.transporter_profiles / silver_app.transporter_profiles: confirmados
-- legacy. El modelo dbt que los alimentaba
-- (dbt/transporters/models/app/transporter_profiles.sql, bloque
-- webapp_transporter_porfiles del pipeline legacy_drivers_transporters) tiene
-- config(schema='silver', alias='transporter_profiles_legacy') — hace tiempo
-- dejó de escribir en app.transporter_profiles/silver_app.transporter_profiles,
-- que quedaron como snapshots huérfanos de antes de ese redirect. Superados
-- por el modelo actual basado en public.carriers (Empresas/Seguros).
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

DROP TABLE IF EXISTS app.transporter_profiles;
DROP TABLE IF EXISTS silver_app.transporter_profiles;
DROP SCHEMA IF EXISTS silver_app;

COMMIT;
