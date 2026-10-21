-- El tipo de operación de un viaje (plan 2026-10-21, levantamiento con Operaciones).
--
-- Hasta hoy un viaje no tenía tipo propio: se leía del tracto vinculado. El TMS de
-- Sodimac nunca informa la patente, así que en 90 días 111 de 142 viajes Sodimac
-- quedaban sin tipo y el Cierre los mostraba en los dos alcances.
--
-- Estándar (SAP TM, Oracle OTM): el tipo de servicio sale de lo pactado con el cliente;
-- el equipo asignado se valida contra eso y un desacuerdo es una excepción que se avisa.
-- La regla, en este orden (el primero que existe gana):
--   1. lo que Operaciones declaró en el viaje (app.trip_operation_types);
--   2. el cliente, si trabaja con UN solo tipo (shippers.operation_types);
--   3. el tracto resuelto (assets.webcarga_operation_type_id);
--   4. sin tipo.
-- `operation_type_conflict`: se aplicó (2) y el tracto tiene otro tipo. Cuenta el del
-- cliente y el pre-cierre lo avisa; Operaciones lo cambia solo si corresponde.
-- Respuestas de Operaciones (21/10): Sodimac, Iansa y Colun solo Equipo Completo;
-- Walmart los dos; Spot se declara al crear el viaje.

BEGIN;

-- 1. Con qué tipos trabaja cada cliente. Mismo patrón que carriers.management_types
--    (20260815160000): códigos del catálogo, NULL = sin definir, sin arreglo vacío.
ALTER TABLE public.shippers ADD COLUMN IF NOT EXISTS operation_types text[];
ALTER TABLE public.shippers DROP CONSTRAINT IF EXISTS shippers_operation_types_check;
ALTER TABLE public.shippers ADD CONSTRAINT shippers_operation_types_check CHECK (
    operation_types <@ ARRAY['TRACTOREO','EQUIPO_COMPLETO']
    AND cardinality(operation_types) BETWEEN 1 AND 2
    AND (cardinality(operation_types) = 1 OR operation_types[1] <> operation_types[2])
);
COMMENT ON COLUMN public.shippers.operation_types IS
    'Tipos de operación con que trabaja el cliente (TRACTOREO / EQUIPO_COMPLETO). Con uno solo, '
    'ese es el tipo de sus viajes (app.v_trip_fleet_resolution). NULL = sin definir.';

-- Lo que respondió Operaciones, por id (base real; en otra base no hace nada).
UPDATE public.shippers SET operation_types = ARRAY['EQUIPO_COMPLETO']
 WHERE id IN ('6531459b-0dd8-4fdb-8d8c-ef5cba6b6a03',   -- Sodimac
              '5e416730-e1ea-41f0-b51d-1ef8b3c1bda7',   -- Iansa
              'c79cc74a-e1d7-4576-b08f-aee8d4807db0')   -- Colun
   AND operation_types IS NULL;
UPDATE public.shippers SET operation_types = ARRAY['TRACTOREO','EQUIPO_COMPLETO']
 WHERE id = 'd63b5682-991f-4833-8b47-83b35f130f90'      -- Walmart
   AND operation_types IS NULL;

-- 2. Lo que Operaciones declara en un viaje (Spot al crearlo, o al resolver un aviso).
--    Aparte de app.trip_fleet_links: un viaje sin patente no tiene vínculo, y el
--    resolvedor reescribe los vínculos automáticos.
CREATE TABLE IF NOT EXISTS app.trip_operation_types (
    trip_id           uuid PRIMARY KEY,
    operation_type_id uuid NOT NULL REFERENCES app.status_taxonomies (id),
    note              text,
    declared_by       uuid,
    declared_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE app.trip_operation_types IS
    'El tipo de operación que Operaciones declaró para un viaje; gana sobre el cliente y el tracto. '
    'Sin FK a app.trips: el --full-refresh de dbt la borraría.';
ALTER TABLE app.trip_operation_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trip_operation_types_read ON app.trip_operation_types;
CREATE POLICY trip_operation_types_read ON app.trip_operation_types FOR SELECT TO authenticated USING (true);

-- 3. La regla, una vez: tres columnas al final de la vista (CREATE OR REPLACE solo
--    admite agregar al final). Definición vigente: 20261017100000.
CREATE OR REPLACE VIEW app.v_trip_fleet_resolution AS
SELECT t.id AS trip_id,
       fl.carrier_id AS resolved_carrier_id,
       fl.driver_id AS resolved_driver_id,
       fl.tractor_asset_id AS resolved_tractor_asset_id,
       dp.counterpart_id AS resolved_driver_home_carrier_id,
       fl.link_source,
       fl.driver_match_rule,
       fl.resolved_at,
       ap.counterpart_id AS resolved_tractor_home_carrier_id,
       COALESCE(dt.operation_type_id, ct.id, ta.webcarga_operation_type_id) AS resolved_operation_type_id,
       CASE WHEN dt.operation_type_id IS NOT NULL THEN 'declared'
            WHEN ct.id IS NOT NULL THEN 'client'
            WHEN ta.webcarga_operation_type_id IS NOT NULL THEN 'tractor'
       END AS operation_type_source,
       (dt.operation_type_id IS NULL AND ct.id IS NOT NULL
        AND ta.webcarga_operation_type_id IS NOT NULL
        AND ta.webcarga_operation_type_id <> ct.id) AS operation_type_conflict
FROM app.trips t
LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
LEFT JOIN app.fleet_assignment_periods dp
       ON dp.relation = 'DRIVER_CARRIER' AND dp.subject_id = fl.driver_id
      AND dp.valid_during @> COALESCE(t.planning_date, public.hoy_chile())
LEFT JOIN app.fleet_assignment_periods ap
       ON ap.relation = 'ASSET_CARRIER' AND ap.subject_id = fl.tractor_asset_id
      AND ap.valid_during @> COALESCE(t.planning_date, public.hoy_chile())
LEFT JOIN app.trip_operation_types dt ON dt.trip_id = t.id
LEFT JOIN public.shippers sh ON sh.id = t.shipper_id
LEFT JOIN app.status_taxonomies ct
       ON cardinality(sh.operation_types) = 1
      AND ct.domain = 'WEBCARGA_OPERATION_TYPE' AND ct.code = sh.operation_types[1]
LEFT JOIN public.assets ta ON ta.id = fl.tractor_asset_id;

COMMENT ON VIEW app.v_trip_fleet_resolution IS
  'Resolución de flota por viaje (app.trip_fleet_links), la empresa que el conductor y el tracto '
  'tenían el día del viaje, y el tipo de operación del viaje: declarado, del cliente de un solo '
  'tipo o del tracto (plan 2026-10-21).';

COMMIT;
