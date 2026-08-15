-- Tramo 3, Task 2: los tres triggers reconcile_new_* dejan de llevar la
-- regla de negocio escrita adentro y pasan a leerla de las columnas del
-- catálogo agregadas en la migración anterior (is_active,
-- applies_to_fleet_service_type_ids, applies_to_management_types).
--
-- Desaparecen requirement_level como interruptor de siembra y el allowlist
-- de códigos a mano (MANTENCION_FRIO, RESOLUCION_SANITARIA / asset_type =
-- 'RAMPLA'). Misma forma para los tres, cada uno mira su propia dimensión.
--
-- Decisión explícita: el trigger de vehículos NO cae de vuelta a asset_type
-- cuando fleet_service_type_id es nulo. Sin el atributo, no se siembra; se
-- reconcilia después con el recalcular.

CREATE OR REPLACE FUNCTION public.reconcile_new_asset()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'ASSET', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'ASSET'
      AND req.is_active
      AND (req.applies_to_fleet_service_type_ids IS NULL
           OR NEW.fleet_service_type_id = ANY(req.applies_to_fleet_service_type_ids))
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_driver()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- Un conductor no tiene subtipo ni gestión propios: sólo lo filtra is_active.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'DRIVER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'DRIVER' AND req.is_active
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_new_carrier()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    -- shipper_id IS NULL se conserva: los requisitos de un cliente puntual los
    -- siembra trg_reconcile_carrier_shipper cuando se crea la relación, que una
    -- empresa recién creada todavía no tiene.
    INSERT INTO public.compliance_records (entity_id, entity_type, requirement_id, status, is_current)
    SELECT NEW.id, 'CARRIER', req.id, 'MISSING', true
    FROM public.compliance_requirements req
    WHERE req.target_entity = 'CARRIER'
      AND req.is_active
      AND req.shipper_id IS NULL
      AND (req.applies_to_management_types IS NULL
           OR NEW.management_types && req.applies_to_management_types)
    ON CONFLICT (entity_id, requirement_id) DO NOTHING;
    RETURN NEW;
END;
$function$;
