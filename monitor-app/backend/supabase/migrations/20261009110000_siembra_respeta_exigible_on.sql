-- HU-C1, entrega 2b (F3): la siembra respeta "¿cuándo se exige?".
--
-- Un documento "solo cuando se solicita" (exigible_on = 'ON_REQUEST': trabajo
-- en altura, soldador, guardias…) NO se siembra a nadie al activarse ni al
-- crear una entidad: existe solo si alguien lo solicita
-- (POST /compliance-records/requests), con is_manual_override.
--
-- Las 5 funciones parten de pg_get_functiondef en producción (08/10), como
-- advierte 20260816080000:22, y el ÚNICO cambio en cada una es la puerta
-- `exigible_on <> 'ON_REQUEST'` junto a `is_active`. La misma puerta vive en
-- SQL_ENTIDADES_QUE_APLICAN (services/requirement_conditions.py), que usa la
-- vista previa y el recalcular: si divergen, la vista previa miente.
--
-- MONTH_AFTER_START y ON_ENTITY_END SÍ se siembran: cuándo se vuelven
-- exigibles lo decide la lectura (exigible_sql en services/vencimientos.py).

CREATE OR REPLACE FUNCTION public.reconcile_carrier_shipper_link()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF TG_OP = 'INSERT' OR (NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE') THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT NEW.carrier_id, 'CARRIER', req.id, 'MISSING', true
        FROM public.compliance_requirements req
        WHERE req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
          AND req.is_active
          AND req.exigible_on <> 'ON_REQUEST'
          AND (req.applies_to_management_types IS NULL
               OR public.carrier_management_types(NEW.carrier_id) && req.applies_to_management_types)
          AND NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = NEW.carrier_id AND cr.requirement_id = req.id AND cr.is_current = true
          )
        ON CONFLICT (entity_id, requirement_id) DO UPDATE SET
            is_current = true
        WHERE NOT public.compliance_records.is_current;
    ELSIF TG_OP = 'UPDATE' AND NEW.status <> 'ACTIVE' AND OLD.status = 'ACTIVE' THEN
        UPDATE public.compliance_records cr
        SET is_current = false
        FROM public.compliance_requirements req
        WHERE cr.entity_id = NEW.carrier_id AND cr.requirement_id = req.id
          AND req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
          AND cr.is_current = true
          AND NOT cr.is_manual_override;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_asset()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'ASSET', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'ASSET'
      AND req.is_active
      AND req.exigible_on <> 'ON_REQUEST'
      AND (req.applies_to_fleet_service_type_ids IS NULL
           OR NEW.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_carrier()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'CARRIER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'CARRIER'
      AND req.is_active
      AND req.exigible_on <> 'ON_REQUEST'
      AND req.shipper_id IS NULL
      AND (req.applies_to_management_types IS NULL
           OR public.carrier_management_types(NEW.id) && req.applies_to_management_types)
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_driver()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Un conductor no tiene subtipo ni gestión propios: sólo lo filtra is_active.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'DRIVER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'DRIVER' AND req.is_active
      AND req.exigible_on <> 'ON_REQUEST'
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT NEW.is_active OR NEW.exigible_on = 'ON_REQUEST' THEN
        RETURN NEW;
    END IF;

    IF NEW.target_entity = 'CARRIER' THEN
        IF NEW.shipper_id IS NULL THEN
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT c.id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carriers c
            WHERE (NEW.applies_to_management_types IS NULL
                   OR public.carrier_management_types(c.id) && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = c.id AND cr.requirement_id = NEW.id AND cr.is_current = true
            );
        ELSE
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT cs.carrier_id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carrier_shippers cs
            WHERE cs.shipper_id = NEW.shipper_id AND cs.status = 'ACTIVE'
              AND (NEW.applies_to_management_types IS NULL
                   OR public.carrier_management_types(cs.carrier_id) && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = cs.carrier_id AND cr.requirement_id = NEW.id AND cr.is_current = true
              );
        END IF;
    ELSIF NEW.target_entity = 'DRIVER' THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT d.id, 'DRIVER', NEW.id, 'MISSING', true
        FROM public.drivers d
        WHERE NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = d.id AND cr.requirement_id = NEW.id AND cr.is_current = true
        );
    ELSIF NEW.target_entity = 'ASSET' THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT a.id, 'ASSET', NEW.id, 'MISSING', true
        FROM public.assets a
        WHERE (NEW.applies_to_fleet_service_type_ids IS NULL
               OR a.fleet_service_type_id = ANY(NEW.applies_to_fleet_service_type_ids))
          AND NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = a.id AND cr.requirement_id = NEW.id AND cr.is_current = true
        );
    END IF;

    RETURN NEW;
END;
$function$;
