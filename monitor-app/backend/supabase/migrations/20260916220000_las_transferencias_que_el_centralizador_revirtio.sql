-- Las transferencias que el Centralizador revirtió
--
-- Hasta el 16/09, `POST /carriers/{id}/drivers` no marcaba is_manual_override
-- y el loader de Mage `load_driver_assignments_06` devolvía al conductor a la
-- empresa del Excel Centralizador EETT. Los dos arreglos ya están vivos (commit
-- 2737df9c y el guardia NOT EXISTS del loader). Esto repara lo que ya se había
-- perdido: al 16/09, 5 conductores, 3 de ellos sin ninguna empresa activa.
--
-- La fuente es `public.audit_log`: la última decisión humana sobre la empresa
-- de cada conductor. Se reaplica sólo si esa última decisión fue un `assign`,
-- no un `unassign` posterior, y si su fila no quedó ACTIVE. Mismo efecto que
-- el endpoint arreglado: la fila pedida ACTIVE y marcada, y las demás
-- INACTIVE y marcadas.
--
-- Sin ids escritos a mano: se calcula al correr.

CREATE TEMP TABLE _a_reparar ON COMMIT DROP AS
WITH ultima_decision AS (
    SELECT DISTINCT ON (entity_id)
        entity_id AS driver_id, action, actor,
        CASE WHEN action = 'assign' THEN (new_value #>> '{}')::uuid END AS carrier_id
    FROM public.audit_log
    WHERE entity_type = 'DRIVER'
      AND ((action = 'assign' AND field = 'carrier_id') OR (action = 'unassign'))
    ORDER BY entity_id, occurred_at DESC, id DESC
)
SELECT u.driver_id, u.carrier_id, u.actor
FROM ultima_decision u
JOIN public.carriers c ON c.id = u.carrier_id
WHERE u.action = 'assign'
  AND NOT EXISTS (
      SELECT 1 FROM public.driver_assignments a
      WHERE a.driver_id = u.driver_id AND a.carrier_id = u.carrier_id AND a.status = 'ACTIVE'
  );

UPDATE public.driver_assignments a
SET status = 'INACTIVE', is_manual_override = true,
    overridden_by = r.actor, overridden_at = now()
FROM _a_reparar r
WHERE a.driver_id = r.driver_id AND a.carrier_id <> r.carrier_id AND a.status = 'ACTIVE';

INSERT INTO public.driver_assignments (driver_id, carrier_id, status, is_manual_override, overridden_by, overridden_at)
SELECT driver_id, carrier_id, 'ACTIVE', true, actor, now() FROM _a_reparar
ON CONFLICT (driver_id, carrier_id) DO UPDATE SET
    status = 'ACTIVE', is_manual_override = true,
    overridden_by = EXCLUDED.overridden_by, overridden_at = now();

INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, new_value, source)
SELECT NULL, 'DRIVER', driver_id, 'assign', 'carrier_id', to_jsonb(carrier_id::text), 'migration'
FROM _a_reparar;
