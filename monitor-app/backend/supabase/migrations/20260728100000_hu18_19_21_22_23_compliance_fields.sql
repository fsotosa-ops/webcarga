-- HU-18/19/21/22/23 (backlog HU-18 a HU-24, épica Gestión documental) —
-- alta/baja/reconciliación de campos en el motor de compliance polimórfico
-- (public.compliance_requirements + public.compliance_records). HU-20 y
-- HU-24 quedan diferidos (ver AGENTLOG.md), sin cambios en esta migración.

-- ====================================================================
-- HU-18: Roll SII (CARRIER, LEGAL_MANDATORY) — campo nuevo.
-- ====================================================================
INSERT INTO public.compliance_requirements
    (target_entity, requirement_code, name, requirement_level, requires_file, has_expiration)
SELECT 'CARRIER', 'ROLL_SII', 'Rol SII', 'LEGAL_MANDATORY', true, false
WHERE NOT EXISTS (
    SELECT 1 FROM public.compliance_requirements
    WHERE target_entity = 'CARRIER' AND requirement_code = 'ROLL_SII'
);

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT c.id, 'CARRIER', req.id, 'MISSING', true
FROM public.carriers c
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'CARRIER' AND req.requirement_code = 'ROLL_SII'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;

-- ====================================================================
-- HU-19: unificar RIOHS Timbrado + Reglamento Interno en un solo campo.
-- 0 registros aprobados en ninguno de los dos (verificado contra la base
-- real) — se elimina RIOHS como duplicado, Reglamento Interno queda único.
-- ====================================================================
DELETE FROM public.compliance_records
WHERE requirement_id = (
    SELECT id FROM public.compliance_requirements
    WHERE target_entity = 'CARRIER' AND requirement_code = 'RIOHS'
);

DELETE FROM public.compliance_requirements
WHERE target_entity = 'CARRIER' AND requirement_code = 'RIOHS';

-- ====================================================================
-- HU-21: Seguro de Carga (ASSET, LEGAL_MANDATORY) — campo nuevo, checklist
-- documental simple (no se vincula al módulo relacional de Seguros).
-- ====================================================================
INSERT INTO public.compliance_requirements
    (target_entity, requirement_code, name, requirement_level, requires_file, has_expiration)
SELECT 'ASSET', 'SEGURO_CARGA', 'Seguro de Carga', 'LEGAL_MANDATORY', true, true
WHERE NOT EXISTS (
    SELECT 1 FROM public.compliance_requirements
    WHERE target_entity = 'ASSET' AND requirement_code = 'SEGURO_CARGA'
);

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT a.id, 'ASSET', req.id, 'MISSING', true
FROM public.assets a
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'ASSET' AND req.requirement_code = 'SEGURO_CARGA'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;

-- ====================================================================
-- HU-22/23: Mantención Cámara Frío + Resolución Sanitaria ya existen en el
-- catálogo (CONDITIONAL_OPTIONAL) pero nunca se siembran — reconcile_new_asset()
-- solo cubre LEGAL_MANDATORY. Se amplía para sembrar estos dos códigos
-- puntuales cuando el activo es semirremolque (asset_type = 'RAMPLA').
-- No se agrega columna nueva (ej. applies_to_asset_type): con solo estos 2
-- casos, un allowlist hardcodeado en la función es más simple que un
-- catálogo genérico especulativo.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.reconcile_new_asset()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'ASSET', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'ASSET'
      AND (
          req.requirement_level = 'LEGAL_MANDATORY'
          OR (req.requirement_code IN ('MANTENCION_FRIO', 'RESOLUCION_SANITARIA') AND NEW.asset_type = 'RAMPLA')
      )
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
SELECT a.id, 'ASSET', req.id, 'MISSING', true
FROM public.assets a
CROSS JOIN public.compliance_requirements req
WHERE req.target_entity = 'ASSET'
  AND req.requirement_code IN ('MANTENCION_FRIO', 'RESOLUCION_SANITARIA')
  AND a.asset_type = 'RAMPLA'
ON CONFLICT (entity_id, requirement_id) DO NOTHING;
