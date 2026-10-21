-- Ciclo de vida del Directorio (plan 2026-10-21). CONTRACT.
--
-- Aplicar DESPUÉS de desplegar la API que ya no conoce LEGACY_INACTIVE (la expansión
-- 20261028090000 traspasó las heredadas a INACTIVE con el motivo LEGACY_IMPORT). Con la
-- API vieja todavía arriba, un alta con LEGACY_INACTIVE fallaría contra este CHECK.

BEGIN;

-- Si algo volvió a escribir el valor viejo entre la expansión y hoy, se traspasa igual.
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

ALTER TABLE public.carriers DROP CONSTRAINT carriers_operational_status_check;
ALTER TABLE public.carriers ADD CONSTRAINT carriers_operational_status_check
    CHECK (operational_status IN ('ACTIVE', 'ONBOARDING', 'INACTIVE'));

COMMIT;
