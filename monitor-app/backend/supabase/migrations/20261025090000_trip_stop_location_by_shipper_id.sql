-- Configuración, Parte 3 (revisión final): el lugar de una parada nueva se
-- registra para el cliente DEL VIAJE (app.trips.shipper_id), no para el cliente
-- cuyo nombre coincide con el texto que manda el TMS. Con Directorio › Clientes
-- se puede renombrar un cliente, y el cruce por nombre cortaba el alta de sus
-- lugares en silencio. Es la misma regla que ya usa el resto del modelo (spec
-- 2026-10-11: el cliente del viaje es un id).
--
-- Medido en la real el 2026-10-16 (viajes de 30 días): 0 de 1.012 resuelven
-- distinto por id que por nombre; el único sin id tampoco calzaba por nombre.
-- Un cliente desactivado sigue sin recibir lugares nuevos, como antes.
-- Cuerpo igual a 20260917060000 salvo el SELECT del cliente. Re-ejecutable.

CREATE OR REPLACE FUNCTION app.reconcile_new_trip_stop_location()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'pg_temp'
AS $function$
DECLARE
    v_shipper_id uuid;
    v_es_origen  boolean;
BEGIN
    IF NEW.stop_type NOT IN ('DESTINATION', 'ORIGIN') OR NEW.local IS NULL OR trim(NEW.local) = '' THEN
        RETURN NEW;
    END IF;
    v_es_origen := NEW.stop_type = 'ORIGIN';

    SELECT sh.id INTO v_shipper_id
    FROM app.trips t
    JOIN public.shippers sh ON sh.id = t.shipper_id AND sh.status = 'ACTIVE'
    WHERE t.id = NEW.trip_id;

    IF v_shipper_id IS NULL THEN
        RETURN NEW;
    END IF;

    INSERT INTO public.locations (entity_type, entity_id, name, region_name, operational_status, is_origin)
    VALUES ('SHIPPER', v_shipper_id, trim(NEW.local),
            CASE WHEN v_es_origen THEN NULL ELSE NEW.destination_region END,
            'ACTIVE', v_es_origen)
    ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO UPDATE
        SET is_origin  = public.locations.is_origin OR EXCLUDED.is_origin,
            updated_at = now()
        WHERE EXCLUDED.is_origin AND NOT public.locations.is_origin;

    RETURN NEW;
END;
$function$;
