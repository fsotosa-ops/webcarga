-- Directorio · D1 "Una sola respuesta" (spec docs/superpowers/specs/2026-10-12-directory-d1-one-answer-design.md §4):
-- los hechos de la flota viven en la base, con una sola definición cada uno.
--
--   app.active_fleet                     qué es la flota activa de una empresa
--   app.carrier_of(tipo, id)             de qué empresa es una entidad
--   public.carrier_management_types(id)  tipos de operación, solo desde los tractos de la flota activa
--   CHECK en operational_status          los ciclos de vida del glosario (§3)
--
-- Sin triggers ni REFRESH nuevos. Re-ejecutable: CREATE OR REPLACE, y los CHECK
-- se agregan solo si no existen. Los tests la corren dentro de su transacción
-- revertida; se aplica en la Task 10 del plan, sin un job de Mage en vuelo.
-- ── 1. La flota activa ──────────────────────────────────────────────────────
-- Conductores y equipos ACTIVE con asignación ACTIVE. NO filtra el estado de la
-- empresa: la ficha de una empresa dada de baja muestra su flota como historial,
-- y quien llama decide si exige empresa activa (in_scope_sql lo exige).
-- Una fila por entidad: los índices únicos idx_driver_assignments_one_active e
-- idx_asset_assignments_one_active permiten una sola asignación ACTIVE. No pasa
-- por vehicle_driver_assignments: un conductor con dos tractos sigue siendo uno.
CREATE OR REPLACE VIEW app.active_fleet AS
SELECT da.carrier_id, 'DRIVER'::text AS entity_type, d.id AS entity_id
FROM public.drivers d
JOIN public.driver_assignments da ON da.driver_id = d.id AND da.status = 'ACTIVE'
WHERE d.operational_status = 'ACTIVE'
UNION ALL
SELECT aa.carrier_id, 'ASSET'::text AS entity_type, a.id AS entity_id
FROM public.assets a
JOIN public.asset_assignments aa ON aa.asset_id = a.id AND aa.status = 'ACTIVE'
WHERE a.operational_status = 'ACTIVE';

COMMENT ON VIEW app.active_fleet IS
  'Flota activa: conductores y equipos con operational_status = ACTIVE y asignación ACTIVE, por empresa '
  '(sin filtrar el estado de la empresa). UNICA definición de "flota activa". Llamadores: '
  'public.carrier_management_types(), app/services/fleet_compliance.py (carrier_compliance_cte) y, desde D1, '
  'los conteos de flota del Directorio y la vista rápida.';

REVOKE ALL ON app.active_fleet FROM anon, authenticated;

-- ── 2. De qué empresa es ────────────────────────────────────────────────────
-- CARRIER es la misma empresa. DRIVER y ASSET, la empresa de su asignación
-- ACTIVE, sin importar el estado de la entidad ni de la empresa. Cualquier otro
-- tipo: NULL. En D2 recibe una fecha y lee el historial; quien la llama no cambia.
CREATE OR REPLACE FUNCTION app.carrier_of(p_entity_type text, p_entity_id uuid)
RETURNS uuid
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT CASE p_entity_type
        WHEN 'CARRIER' THEN p_entity_id
        WHEN 'DRIVER'  THEN (SELECT da.carrier_id FROM public.driver_assignments da
                             WHERE da.driver_id = p_entity_id AND da.status = 'ACTIVE')
        WHEN 'ASSET'   THEN (SELECT aa.carrier_id FROM public.asset_assignments aa
                             WHERE aa.asset_id = p_entity_id AND aa.status = 'ACTIVE')
    END
$$;

COMMENT ON FUNCTION app.carrier_of(text, uuid) IS
  'Empresa de una entidad: CARRIER es ella misma; DRIVER y ASSET, la de su asignación ACTIVE (cualquier estado); '
  'otro tipo, NULL. Reemplaza los LEFT JOIN sueltos de entity_summary.py, del embudo (compliance.py) y de '
  'daily_closures.py. ultima_empresa_sql (documentos al término) sigue aparte hasta D2.';

REVOKE ALL ON FUNCTION app.carrier_of(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 3. Tipos de operación, solo desde los tractos de la flota activa ────────
-- Misma firma, misma regla ("la flota manda cuando existe, lo declarado cubre el
-- hueco", 20260816050000; por código desde 20260816090000). Cambia solo QUÉ
-- vehículos cuentan: los tractos de app.active_fleet, no cualquier asignación
-- ACTIVE (que incluía equipos dados de baja y ramplas; E-g de la spec: el tipo
-- de operación sale del tracto). Medido el 12/10: cambia 1 empresa, INACTIVE, y
-- ningún requisito usa applies_to_management_types.
CREATE OR REPLACE FUNCTION public.carrier_management_types(p_carrier_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT COALESCE(
        (
            SELECT array_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL)
            FROM app.active_fleet af
            JOIN public.assets a ON a.id = af.entity_id AND a.asset_type = 'TRACTOCAMION'
            JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id
            WHERE af.carrier_id = p_carrier_id AND af.entity_type = 'ASSET'
        ),
        (SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id)
    );
$function$;

-- El COMMENT de 20260816050000, con la fuente nueva: CREATE OR REPLACE lo
-- conserva, pero describe asset_assignments y ya no sería cierto.
COMMENT ON FUNCTION public.carrier_management_types(uuid) IS
    'Tipo de gestion de una empresa, en codigos (TRACTOREO / EQUIPO_COMPLETO). La flota manda cuando existe (los tractos de app.active_fleet -> assets.webcarga_operation_type_id -> status_taxonomies.code), lo declarado (carriers.management_types) cubre el hueco. UNICA definicion del concepto: la llaman las cuatro ramas CARRIER de siembra (reconcile_new_carrier, reconcile_carrier_shipper_link, las dos de reconcile_new_requirement), la vista previa del recalcular (app/services/requirement_conditions.py, SQL_ENTIDADES_QUE_APLICAN["CARRIER"]) y la pantalla de Certificacion (app/routers/compliance.py). Si cambia esta funcion, cambian los tres lados a la vez -- ese es el punto.';

-- d1:checks
-- ── 4. Los ciclos de vida del glosario ──────────────────────────────────────
-- La marca de arriba separa los CHECK: tests/d1_subjects.apply_fleet_facts
-- ejecuta solo lo anterior, para no tomar locks exclusivos en cada test.
-- Esta migración no lleva BEGIN/COMMIT (la envuelve quien la aplica).
-- Verificado el 12/10: todas las filas cumplen. ADD CONSTRAINT toma un lock
-- exclusivo breve sobre tablas chicas (251, 101 y 139 filas). Solo si no existe:
-- la migración se re-ejecuta en cada test.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.carriers'::regclass AND conname = 'carriers_operational_status_check') THEN
        ALTER TABLE public.carriers ADD CONSTRAINT carriers_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'ONBOARDING', 'INACTIVE', 'LEGACY_INACTIVE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.drivers'::regclass AND conname = 'drivers_operational_status_check') THEN
        ALTER TABLE public.drivers ADD CONSTRAINT drivers_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'INACTIVE'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'public.assets'::regclass AND conname = 'assets_operational_status_check') THEN
        ALTER TABLE public.assets ADD CONSTRAINT assets_operational_status_check
            CHECK (operational_status IN ('ACTIVE', 'INACTIVE'));
    END IF;
END $$;
