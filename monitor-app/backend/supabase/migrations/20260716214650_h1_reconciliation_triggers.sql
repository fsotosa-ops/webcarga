-- H1.3: al insertar un compliance_requirements LEGAL_MANDATORY, crear MISSING
-- para todas las entidades existentes del target_entity correspondiente.
-- Nota: el scoping por shipper_id solo está implementado para CARRIER (única
-- combinación con datos reales hoy). Si en el futuro aparece un requirement
-- DRIVER/ASSET con shipper_id, esta función necesita extenderse
-- (driver/asset -> carrier -> carrier_shippers).
CREATE OR REPLACE FUNCTION public.reconcile_new_requirement()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.requirement_level <> 'LEGAL_MANDATORY' THEN
        RETURN NEW;
    END IF;

    IF NEW.target_entity = 'CARRIER' THEN
        IF NEW.shipper_id IS NULL THEN
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT c.id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carriers c
            WHERE NOT EXISTS (
                SELECT 1 FROM public.compliance_records cr
                WHERE cr.entity_id = c.id AND cr.requirement_id = NEW.id AND cr.is_current = true
            );
        ELSE
            INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
            SELECT cs.carrier_id, 'CARRIER', NEW.id, 'MISSING', true
            FROM public.carrier_shippers cs
            WHERE cs.shipper_id = NEW.shipper_id AND cs.status = 'ACTIVE'
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
        WHERE NOT EXISTS (
            SELECT 1 FROM public.compliance_records cr
            WHERE cr.entity_id = a.id AND cr.requirement_id = NEW.id AND cr.is_current = true
        );
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_reconcile_new_requirement
AFTER INSERT ON public.compliance_requirements
FOR EACH ROW EXECUTE FUNCTION public.reconcile_new_requirement();

-- H1.4: al crear/terminar una relación carrier<->shipper, agregar/retirar los
-- compliance_records de los requisitos shipper-scoped correspondientes.
-- "Retirar" = marcar is_current=false (mismo criterio de versionado que ya usa
-- la tabla), no borrar la fila. Respeta is_manual_override: si un usuario ya
-- editó ese record a mano, no se lo retira automáticamente.
CREATE OR REPLACE FUNCTION public.reconcile_carrier_shipper_link()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE') THEN
        INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
        SELECT NEW.carrier_id, 'CARRIER', req.id, 'MISSING', true
        FROM public.compliance_requirements req
        WHERE req.target_entity = 'CARRIER' AND req.shipper_id = NEW.shipper_id
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
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

CREATE TRIGGER trg_reconcile_carrier_shipper
AFTER INSERT OR UPDATE ON public.carrier_shippers
FOR EACH ROW EXECUTE FUNCTION public.reconcile_carrier_shipper_link();
