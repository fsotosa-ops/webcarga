-- Tercera ronda de limpieza (2026-07-18, mismo audit que las 2 anteriores).
-- Esta vez a pedido explícito del usuario, que desconfió del bucket
-- "KEEP — ACTIVE" sin evidencia individual de la primera pasada — re-audit
-- exhaustivo tabla por tabla de todo lo que quedaba en app/silver.
--
-- 8 vistas silver.stg_centralizer_* — leen de bronze.raw_centralizer_*
-- (que sigue viva, uso manual confirmado) pero son un callejón sin salida:
-- cero dbt, cero bloque de Mage, cero backend/frontend lee su output.
-- Orden de drop respeta la cadena real de dependencias entre ellas
-- (stg_centralizer_transporters es la raíz).
--
-- Cluster de 7 tablas de un sistema de documentos/compliance anterior
-- (transporter_documents, compliance_doc_catalog, client_document_requirements,
-- transporter_client_accounts, driver_documents, vehicle_documents,
-- sync_config) — superado por el patrón polimórfico actual
-- (public.compliance_records/public.contacts). Sin referencias en dbt,
-- Mage, backend ni frontend; sin tráfico en logs de API de las últimas 24h
-- pese a tener scans acumulados altos (uso histórico, no corriente).
-- Confirmado explícitamente por el usuario como "el sistema viejo".
--
-- Ver memoria: project_db_cleanup_audit_2026_07.

BEGIN;

DROP VIEW IF EXISTS silver.stg_centralizer_driver_docs;
DROP VIEW IF EXISTS silver.stg_centralizer_vehicle_docs;
DROP VIEW IF EXISTS silver.stg_centralizer_transporter_docs;
DROP VIEW IF EXISTS silver.stg_centralizer_transporter_contacts;
DROP VIEW IF EXISTS silver.stg_centralizer_transporter_client_accounts;
DROP VIEW IF EXISTS silver.stg_centralizer_drivers;
DROP VIEW IF EXISTS silver.stg_centralizer_vehicles;
DROP VIEW IF EXISTS silver.stg_centralizer_transporters;

DROP TABLE IF EXISTS app.driver_documents;
DROP TABLE IF EXISTS app.vehicle_documents;
DROP TABLE IF EXISTS app.transporter_documents;
DROP TABLE IF EXISTS app.transporter_client_accounts;
DROP TABLE IF EXISTS app.client_document_requirements;
DROP TABLE IF EXISTS app.compliance_doc_catalog;
DROP TABLE IF EXISTS app.sync_config;

COMMIT;
