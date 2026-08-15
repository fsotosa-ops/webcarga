-- Tramo 3: la regla de a quién se le exige cada documento sale del código de
-- base y pasa a ser dato del catálogo.
--
-- Hoy los tres triggers reconcile_new_* llevan DOS reglas pegadas:
--   requirement_level = 'LEGAL_MANDATORY'
--   OR (requirement_code IN ('MANTENCION_FRIO','RESOLUCION_SANITARIA')
--       AND NEW.asset_type = 'RAMPLA')
-- `requirement_level` es una etiqueta de SEVERIDAD —se usa para mostrar
-- "BÁSICA"/"ADICIONAL"— y hacía de interruptor de siembra a escondidas.

ALTER TABLE public.compliance_requirements
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS applies_to_fleet_service_type_ids UUID[],
    ADD COLUMN IF NOT EXISTS applies_to_management_types TEXT[];

ALTER TABLE public.compliance_requirements
    ADD CONSTRAINT compliance_requirements_management_types_check CHECK (
        applies_to_management_types IS NULL
        OR (applies_to_management_types <@ ARRAY['TRACTOREO','EQUIPO_COMPLETO']
            AND cardinality(applies_to_management_types) BETWEEN 1 AND 2)
    );

COMMENT ON COLUMN public.compliance_requirements.is_active IS
    'Si el requisito esta vigente. Los CONDITIONAL_OPTIONAL de empresa (SEGURO_EETT, SEGURO_RC_EMPRESA) quedan en false hasta que negocio defina la regla (D8).';
COMMENT ON COLUMN public.compliance_requirements.applies_to_fleet_service_type_ids IS
    'Subtipos de vehiculo a los que aplica. NULL = sin restriccion por subtipo.';
COMMENT ON COLUMN public.compliance_requirements.applies_to_management_types IS
    'Tipos de gestion de empresa a los que aplica. NULL = sin restriccion.';

-- ── Backfill: reproduce EXACTAMENTE la conducta de hoy ────────────────────
-- Los dos condicionales de empresa no se sembraban porque el trigger sólo
-- miraba LEGAL_MANDATORY. Ahora se dice explícito.
UPDATE public.compliance_requirements
   SET is_active = false
 WHERE requirement_code IN ('SEGURO_EETT', 'SEGURO_RC_EMPRESA');

-- Los dos de vehículo se sembraban a toda RAMPLA. Se expresa como "todos los
-- subtipos que NO son el tracto", que equivale a la regla vieja PARA TODO
-- VEHÍCULO QUE YA TIENE fleet_service_type_id CARGADO -- no para todos los
-- datos actuales: hay 1 vehículo RAMPLA sin subtipo cargado
-- (fleet_service_type_id NULL) que queda fuera, porque
-- `NULL = ANY(applies_to_fleet_service_type_ids)` da NULL, no true, y la
-- fila no se siembra (I2, Ronda de arreglo 3). El remedio es cargarle el
-- subtipo a ese vehículo, no volver a mirar asset_type acá: esa decisión ya
-- se tomó a propósito y sigue en pie, ver
-- 20260816010000_reconcile_reads_conditions.sql:9-11.
UPDATE public.compliance_requirements
   SET applies_to_fleet_service_type_ids = (
        SELECT array_agg(id) FROM app.status_taxonomies
         WHERE domain = 'FLEET_SERVICE_TYPE' AND label <> 'Tractocamión'
   )
 WHERE requirement_code IN ('MANTENCION_FRIO', 'RESOLUCION_SANITARIA');
