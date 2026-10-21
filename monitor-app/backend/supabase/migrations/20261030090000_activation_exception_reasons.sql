-- Onboarding de empresas (plan 2026-10-21): el motivo de una activación como excepción.
--
-- Una empresa sale del onboarding cuando cumple lo mismo que la habilitación (ningún
-- obligatorio vencido o faltante, propio o de su flota). Sin cumplirlo, Certificación
-- puede activarla igual, con un motivo de este vocabulario (services/lifecycle.py).
-- Se edita en Configuración › Directorio. OTHER exige comentario.

BEGIN;

ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check CHECK (domain = ANY (ARRAY[
    'OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE',
    'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON', 'TRIP_VOID_REASON',
    'DEACTIVATION_REASON', 'REACTIVATION_REASON', 'ACTIVATION_EXCEPTION_REASON']));

INSERT INTO app.status_taxonomies (domain, code, label, sort_order, active)
SELECT v.domain, v.code, v.label, v.sort_order, true
FROM (VALUES
    ('ACTIVATION_EXCEPTION_REASON', 'CLIENT_NEEDS_IT_NOW',   'Lo necesita un cliente ya',            1),
    ('ACTIVATION_EXCEPTION_REASON', 'DOCUMENTS_IN_PROGRESS', 'Documentos en trámite comprometidos',  2),
    ('ACTIVATION_EXCEPTION_REASON', 'OTHER',                 'Otro',                                 3)
) AS v(domain, code, label, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM app.status_taxonomies t WHERE t.domain = v.domain AND t.code = v.code
);

COMMIT;
