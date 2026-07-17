-- H2 (pre-requisito): audit_log conceptualmente pertenece al núcleo de negocio/
-- cumplimiento (public), no a la capa de lectura descartable (app: vistas
-- materializadas). Único código vivo que lo referencia hoy: transporters.py/
-- insurance.py (se borran en H2) y document_storage.py (se actualiza en H2.4).
-- RLS (enabled, sin políticas -> deny-all salvo service_role) y grants de
-- owner persisten a través de SET SCHEMA, no hace falta recrearlos.
ALTER TABLE app.audit_log SET SCHEMA public;
