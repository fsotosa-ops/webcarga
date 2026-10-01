-- Las transferencias de tractos que el Centralizador revirtió
--
-- Mismo defecto que 20260916220000 (conductores), en el otro endpoint: hasta el
-- 01/10, `POST /carriers/{id}/assets` no marcaba is_manual_override y el loader
-- de Mage `load_asset_asignments_07` devolvía el tracto a la empresa del Excel
-- Centralizador EETT. BDLC92 (Rafael Villegas) se transfirió a Villegom 6 veces
-- entre el 01/09 y el 01/10 y volvía cada día a Mendieta.
--
-- Medido al 01/10: 18 tractos transferidos desde la app. 1 revertido (DTBY52,
-- de vuelta en Charlotte) y 15 que hoy coinciden pero SIN marca — se revertirían
-- en la próxima corrida del loader en que el Excel los contradiga. A todos se
-- les deja la decisión de la app ACTIVE y TODAS sus filas marcadas: una fila
-- vieja sin marca la reactiva el upsert del loader y choca contra
-- idx_asset_assignments_one_active.
--
-- Fuera: si la fila de la decisión quedó INACTIVE y marcada (HYXB37 y JDYY73,
-- Hasa Spa), alguien la desactivó después a propósito; no se revive.
--
-- Sin ids escritos a mano: se calcula al correr. Re-ejecutable.

BEGIN;

CREATE TEMP TABLE _a_reparar ON COMMIT DROP AS
WITH ultima_decision AS (
    SELECT DISTINCT ON (entity_id)
        entity_id AS asset_id, action, actor,
        CASE WHEN action = 'assign' THEN (new_value #>> '{}')::uuid END AS carrier_id
    FROM public.audit_log
    WHERE entity_type = 'ASSET'
      AND ((action = 'assign' AND field = 'carrier_id') OR (action = 'unassign'))
    ORDER BY entity_id, occurred_at DESC, id DESC
)
SELECT u.asset_id, u.carrier_id, u.actor
FROM ultima_decision u
JOIN public.carriers c ON c.id = u.carrier_id
JOIN public.assets a ON a.id = u.asset_id
WHERE u.action = 'assign'
  AND NOT EXISTS (
      SELECT 1 FROM public.asset_assignments x
      WHERE x.asset_id = u.asset_id AND x.carrier_id = u.carrier_id
        AND x.status = 'INACTIVE' AND x.is_manual_override
  );

UPDATE public.asset_assignments a
SET status = 'INACTIVE'
FROM _a_reparar r
WHERE a.asset_id = r.asset_id AND a.carrier_id <> r.carrier_id AND a.status = 'ACTIVE';

INSERT INTO public.asset_assignments (asset_id, carrier_id, status, is_manual_override, overridden_by, overridden_at)
SELECT asset_id, carrier_id, 'ACTIVE', true, actor, now() FROM _a_reparar
ON CONFLICT (asset_id, carrier_id) DO UPDATE SET status = 'ACTIVE';

-- Todas las filas de esos tractos quedan como decisión humana.
UPDATE public.asset_assignments a
SET is_manual_override = true,
    overridden_by = COALESCE(a.overridden_by, r.actor),
    overridden_at = COALESCE(a.overridden_at, now())
FROM _a_reparar r
WHERE a.asset_id = r.asset_id AND NOT a.is_manual_override;

INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, new_value, source)
SELECT NULL, 'ASSET', r.asset_id, 'assign', 'carrier_id', to_jsonb(r.carrier_id::text), 'migration'
FROM _a_reparar r
WHERE NOT EXISTS (
    -- Re-ejecutarla no duplica el rastro.
    SELECT 1 FROM public.audit_log l
    WHERE l.entity_type = 'ASSET' AND l.entity_id = r.asset_id AND l.source = 'migration'
      AND l.new_value = to_jsonb(r.carrier_id::text)
);

COMMIT;
