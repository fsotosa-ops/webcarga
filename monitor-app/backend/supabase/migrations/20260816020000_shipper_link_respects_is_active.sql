-- Tramo 3, arreglo sobre Task 2: reconcile_carrier_shipper_link() es la
-- CUARTA vía de siembra de compliance_records (además de los tres triggers
-- reconcile_new_* que ya leen is_active desde 20260816010000). Siembra los
-- requisitos CARRIER que pertenecen a un cliente puntual (shipper_id IS NOT
-- NULL) cuando se crea o reactiva la relación carrier<->shipper.
--
-- No respetaba is_active: el INSERT ... SELECT no lo filtraba, así que un
-- requisito de cliente puntual apagado desde la pantalla de administración
-- se seguiría sembrando igual. Hoy no hay daño (ninguno de los requisitos
-- con shipper_id está inactivo), pero el interruptor is_active quedaría
-- mintiendo para esos requisitos en cuanto alguien lo use — exactamente la
-- inconsistencia que este tramo vino a eliminar.
--
-- Se agrega únicamente `AND req.is_active` al WHERE del INSERT ... SELECT
-- (la vía que siembra). La rama ELSIF que retira registros al desactivarse
-- la relación carrier<->shipper no se toca: no depende de is_active.

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
