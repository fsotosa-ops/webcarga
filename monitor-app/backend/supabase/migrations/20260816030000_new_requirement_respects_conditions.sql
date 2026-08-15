-- Tramo 3, arreglo sobre Task 2: reconcile_new_requirement() es la QUINTA vía
-- de siembra de compliance_records — corre en AFTER INSERT ON
-- compliance_requirements (trigger trg_reconcile_new_requirement, migración
-- 20260716214650_h1_reconciliation_triggers.sql) y siembra retroactivamente
-- a las entidades ya existentes cuando se crea un requisito nuevo.
--
-- Cortaba con `requirement_level <> 'LEGAL_MANDATORY'` y, si pasaba ese
-- filtro, sembraba a TODAS las entidades del target_entity sin mirar
-- is_active, applies_to_fleet_service_type_ids ni applies_to_management_types.
-- Resultado: crear un requisito nuevo con condiciones no las respetaría en
-- absoluto — un condicional (is_active pero con requirement_level distinto
-- de LEGAL_MANDATORY) no sembraría nada, y uno con applies_to_* restringido
-- sembraría a todos igual. Con esto sin tocar, dos de las cinco vías de
-- siembra quedaban desalineadas del contrato de este tramo: is_active +
-- applies_to_fleet_service_type_ids + applies_to_management_types SON la
-- regla, no requirement_level. Las cinco vías tienen que leer la misma regla.

CREATE OR REPLACE FUNCTION public.reconcile_new_requirement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT NEW.is_active THEN
        RETURN NEW;
    END IF;

    IF NEW.target_entity = 'CARRIER' THEN
        IF NEW.shipper_id IS NULL THEN
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT c.id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carriers c
            WHERE (NEW.applies_to_management_types IS NULL
                   OR c.management_types && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = c.id AND cr.requirement_id = NEW.id AND cr.is_current = true
            );
        ELSE
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT cs.carrier_id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carrier_shippers cs
            JOIN public.carriers c ON c.id = cs.carrier_id
            WHERE cs.shipper_id = NEW.shipper_id AND cs.status = 'ACTIVE'
              AND (NEW.applies_to_management_types IS NULL
                   OR c.management_types && NEW.applies_to_management_types)
              AND NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = cs.carrier_id AND cr.requirement_id = NEW.id AND cr.is_current = true
              );
        END IF;
    ELSIF NEW.target_entity = 'DRIVER' THEN
        -- Un conductor no tiene subtipo ni gestión propios: sólo lo filtra is_active (arriba).
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
