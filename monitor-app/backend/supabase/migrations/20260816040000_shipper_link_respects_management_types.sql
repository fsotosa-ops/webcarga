-- Tramo 3, arreglo sobre Task 2: última de las cinco vías de siembra de
-- compliance_records que quedaba desalineada. reconcile_carrier_shipper_link()
-- ya respeta is_active (20260816020000) pero no miraba
-- applies_to_management_types al sembrar los requisitos CARRIER de un
-- cliente puntual (shipper_id no nulo) cuando se crea o reactiva la
-- relación carrier<->shipper.
--
-- Hoy los 2 requisitos con shipper_id tienen applies_to_management_types en
-- NULL, así que no hay daño observable todavía — pero la pantalla de
-- administración de este tramo va a permitir ponerle una condición de
-- gestión a cualquier requisito de empresa, incluidos los de cliente
-- puntual. Sin este cambio, "las condiciones son la regla" tendría una
-- excepción silenciosa. Las cinco vías de siembra (los tres triggers
-- reconcile_new_*, reconcile_new_requirement y esta) tienen que leer la
-- misma regla completa: interruptor (is_active) y condiciones
-- (applies_to_fleet_service_type_ids / applies_to_management_types).
--
-- Se agrega únicamente la condición de management_types al WHERE del
-- INSERT ... SELECT, uniendo contra public.carriers para poder leer
-- management_types de la empresa (el SELECT solo tenía NEW.carrier_id, un
-- escalar, no una fila de carriers). No se toca nada más.

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
        JOIN public.carriers c ON c.id = NEW.carrier_id
        WHERE req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
          AND req.is_active
          AND (req.applies_to_management_types IS NULL
               OR c.management_types && req.applies_to_management_types)
          AND NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = NEW.carrier_id AND cr.requirement_id = req.id AND cr.is_current = true
          );
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
