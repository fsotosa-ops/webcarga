-- Task 7 (retry, post-Task-6b): destructive cleanup of legacy relational structures.
-- Verified immediately before this migration:
--   - app.drivers / app.vehicles have zero rows with NULL transporter_id
--   - app.compliance_documents (352 rows with status IS NOT NULL) matches the sum of
--     app.transporter_documents + app.driver_documents + app.vehicle_documents (352) 1:1
--   - app.v_transporter_operational_status exists
--   - The 3 register_entity() triggers are exactly: transporters_register_entity (app.transporters),
--     drivers_register_entity (app.drivers), vehicles_register_entity (app.vehicles)
--   - pg_depend confirms no view depends on app.driver_assignments / app.vehicle_assignments
--     (Task 6b's repoint of v_driver_eligibility / v_vehicle_eligibility holds)
--   - pg_depend confirms app.v_sync_divergence no longer exists / does not depend on
--     app.compliance_documents (Task 6b dropped it)
--   - pg_depend confirms app.notifications no longer has a FK to app.entities (Task 6b dropped it)
--
-- app.compliance_doc_catalog is explicitly EXCLUDED from this DROP (decision post-Task-6b) —
-- it is kept permanently as the small reference table the eligibility views need.

DROP TRIGGER IF EXISTS transporters_register_entity ON app.transporters;
DROP TRIGGER IF EXISTS drivers_register_entity ON app.drivers;
DROP TRIGGER IF EXISTS vehicles_register_entity ON app.vehicles;
DROP TRIGGER IF EXISTS compliance_documents_audit ON app.compliance_documents;

DROP FUNCTION IF EXISTS app.safe_update_transporter(uuid, jsonb);
DROP FUNCTION IF EXISTS app.register_entity() CASCADE;
DROP FUNCTION IF EXISTS app.audit_compliance_document_change() CASCADE;

DROP TABLE app.driver_assignments;
DROP TABLE app.vehicle_assignments;
DROP TABLE app.compliance_documents;
-- app.compliance_doc_catalog: EXCLUIDO de este DROP (decisión post-Task-6b — ver ese task).
-- Se mantiene permanentemente como tabla chica de referencia que las vistas SQL de elegibilidad
-- necesitan para calcular en la base.
DROP TABLE app.entities;
DROP TABLE app.stored_files;
DROP TABLE app.insurance_doc_catalog CASCADE;
DROP TABLE app.insurance_documents;
