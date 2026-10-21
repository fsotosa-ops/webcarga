-- Ciclo de vida del Directorio (plan 2026-10-21): un estado de baja y su motivo. EXPAND.
--
-- Hasta hoy la baja de una empresa tenía dos valores, INACTIVE (dada de baja desde la
-- app) y LEGACY_INACTIVE (llegó inactiva del padrón viejo). La pantalla los mostraba
-- igual, pero reactivar solo aceptaba el primero, así que unas 200 empresas "Dadas de
-- baja" no se podían reactivar. De dónde vino la baja no es un estado: es un motivo.
--
-- El estándar (SAP Business Partner, Dynamics, Oracle Supplier; RMIS/Highway en
-- transporte): un estado inactivo, reversible, y un motivo de catálogo en cada baja y
-- cada reactivación, con auditoría. Esta migración:
--   1. agrega dos vocabularios a app.status_taxonomies (mismo patrón que los motivos
--      de anulación): DEACTIVATION_REASON y REACTIVATION_REASON. `group_id` dice a
--      quién aplica el motivo: all, carrier, driver o asset;
--   2. agrega el motivo vigente a carriers, drivers y assets (status_reason_id,
--      status_note, status_changed_at). El historial completo sigue en audit_log;
--   3. pasa LEGACY_INACTIVE a INACTIVE con el motivo LEGACY_IMPORT, dejando antes
--      el valor viejo en audit_log.
-- El CHECK sin LEGACY_INACTIVE lo deja la contracción (20261028090100), una vez
-- desplegada la API que ya no lo conoce. Nada en SQL, dbt ni Mage lee el valor viejo
-- (verificado el 21/10: solo el CHECK de 20261013090000).

BEGIN;

-- 1. Los vocabularios. La base decide qué vocabularios existen.
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check CHECK (domain = ANY (ARRAY[
    'OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE',
    'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON', 'TRIP_VOID_REASON',
    'DEACTIVATION_REASON', 'REACTIVATION_REASON']));

-- El code no se renombra nunca (la lógica lo lee); la etiqueta se edita en Configuración.
-- OTHER exige comentario. LEGACY_IMPORT es el de las heredadas: se puede retirar de la
-- lista de opciones sin perder a quién se le puso.
INSERT INTO app.status_taxonomies (domain, code, label, group_id, sort_order, active)
SELECT v.domain, v.code, v.label, v.group_id, v.sort_order, true
FROM (VALUES
    ('DEACTIVATION_REASON', 'RELATIONSHIP_ENDED', 'Término de la relación comercial', 'all',     1),
    ('DEACTIVATION_REASON', 'DOCUMENTS_NOT_MET',  'Incumplimiento documental',        'all',     2),
    ('DEACTIVATION_REASON', 'SERVICE_ISSUES',     'Desempeño o incidentes',           'all',     3),
    ('DEACTIVATION_REASON', 'OWN_REQUEST',        'Lo pidió el transportista',        'all',     4),
    ('DEACTIVATION_REASON', 'ASSET_RETIRED',      'Vendido, siniestrado o fuera de servicio', 'asset', 5),
    ('DEACTIVATION_REASON', 'LEGACY_IMPORT',      'Heredada del padrón anterior',     'carrier', 6),
    ('DEACTIVATION_REASON', 'OTHER',              'Otro',                             'all',     7),
    ('REACTIVATION_REASON', 'RELATIONSHIP_RESUMED', 'Retoma la relación comercial',   'all',     1),
    ('REACTIVATION_REASON', 'DOCUMENTS_FIXED',    'Regularizó su documentación',      'all',     2),
    ('REACTIVATION_REASON', 'DEACTIVATED_IN_ERROR', 'Se dio de baja por error',       'all',     3),
    ('REACTIVATION_REASON', 'OTHER',              'Otro',                             'all',     4)
) AS v(domain, code, label, group_id, sort_order)
WHERE NOT EXISTS (
    SELECT 1 FROM app.status_taxonomies t WHERE t.domain = v.domain AND t.code = v.code
);

-- 2. El motivo vigente, en las tres entidades. Lo escribe solo services/lifecycle.py.
ALTER TABLE public.carriers
    ADD COLUMN IF NOT EXISTS status_reason_id uuid REFERENCES app.status_taxonomies (id),
    ADD COLUMN IF NOT EXISTS status_note text,
    ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.drivers
    ADD COLUMN IF NOT EXISTS status_reason_id uuid REFERENCES app.status_taxonomies (id),
    ADD COLUMN IF NOT EXISTS status_note text,
    ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
ALTER TABLE public.assets
    ADD COLUMN IF NOT EXISTS status_reason_id uuid REFERENCES app.status_taxonomies (id),
    ADD COLUMN IF NOT EXISTS status_note text,
    ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

COMMENT ON COLUMN public.carriers.status_reason_id IS
    'Motivo de la última baja o reactivación (app.status_taxonomies, DEACTIVATION_REASON o REACTIVATION_REASON). El historial está en public.audit_log.';
COMMENT ON COLUMN public.drivers.status_reason_id IS
    'Motivo de la última baja o reactivación (app.status_taxonomies, DEACTIVATION_REASON o REACTIVATION_REASON). El historial está en public.audit_log.';
COMMENT ON COLUMN public.assets.status_reason_id IS
    'Motivo de la última baja o reactivación (app.status_taxonomies, DEACTIVATION_REASON o REACTIVATION_REASON). El historial está en public.audit_log.';

-- 3. Las heredadas: primero el valor viejo a audit_log, después el cambio.
INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source)
SELECT NULL, 'CARRIER', c.id, 'update', 'operational_status',
       to_jsonb('LEGACY_INACTIVE'::text), to_jsonb('INACTIVE'::text), 'migration'
  FROM public.carriers c
 WHERE c.operational_status = 'LEGACY_INACTIVE';

UPDATE public.carriers c
   SET operational_status = 'INACTIVE',
       status_reason_id = r.id
  FROM app.status_taxonomies r
 WHERE r.domain = 'DEACTIVATION_REASON' AND r.code = 'LEGACY_IMPORT'
   AND c.operational_status = 'LEGACY_INACTIVE';

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.carriers WHERE operational_status = 'LEGACY_INACTIVE') THEN
        RAISE EXCEPTION 'Quedaron empresas LEGACY_INACTIVE después del traspaso';
    END IF;
END $$;

COMMIT;
