-- El concepto es ORIGEN, no "CD" (HU-28, corrección del usuario 17/09:
-- *"no todos se llaman CD (centro de distribución) porque no lo son... pero si
-- son un origen"*).
--
-- QUÉ ESTABA MAL
-- `is_origin_cd` nombraba al rol por el más común de sus casos. Medido sobre los
-- 24 orígenes que el TMS reporta: sólo **7 se llaman "CD"**. Los otros 17 son
-- bodegas (`Bod La Farfana 1`), operadores logísticos (`SITRANS`, `Saam Renca`),
-- una devolución (`Logistica Inversa`) y tiendas despachando (`Express Maipú`,
-- `VIÑA DEL MAR`, `HIPER SANTA CRUZ`). Llamarlos a todos CD es falso, y esta app
-- ya tiene la regla escrita: se nombra por el trabajo, no por el caso frecuente.
--
-- Lo que NO cambia: cada lugar conserva el nombre con que el TMS lo reporta, y
-- ahí "CD EL PEÑON" se sigue llamando CD porque lo es. Lo que cambia es cómo se
-- llama la CATEGORÍA.

BEGIN;

ALTER TABLE public.locations RENAME COLUMN is_origin_cd TO is_origin;

COMMENT ON COLUMN public.locations.is_origin IS
  'true = desde este lugar SALE carga. No es excluyente con ser local de entrega: '
  '14 de los 24 orígenes observados son las dos cosas. Se llama `is_origin` y no '
  '`is_origin_cd` porque sólo 7 de los 24 son centros de distribución — el resto son '
  'bodegas, operadores logísticos y tiendas despachando. Lo consume el origen base del '
  'conductor (public.drivers.home_location_id) y el filtro del cierre.';

ALTER INDEX IF EXISTS idx_locations_origin_cd RENAME TO idx_locations_origin;

-- El trigger de auto-registro nombra la columna: se reescribe con el nombre nuevo.
CREATE OR REPLACE FUNCTION app.reconcile_new_trip_stop_location()
RETURNS TRIGGER AS $$
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
    JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
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
$$ LANGUAGE plpgsql SET search_path = app, public, pg_temp;

-- Y el trigger que valida el origen base del conductor.
CREATE OR REPLACE FUNCTION public.drivers_home_location_es_un_cd()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
    IF NEW.home_location_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT l.is_origin AND l.operational_status = 'ACTIVE'
      INTO ok
      FROM public.locations l
     WHERE l.id = NEW.home_location_id;

    IF NOT COALESCE(ok, false) THEN
        RAISE EXCEPTION
            'El origen base tiene que ser un lugar de origen activo (locations.is_origin)'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END $$;

COMMENT ON COLUMN public.drivers.home_location_id IS
  'Origen base del conductor ("home terminal"). Dato maestro declarado por Operaciones, '
  'NO derivado de los viajes. Es la dimensión por la que se agrupa la ASISTENCIA; el '
  'origen real de cada viaje (app.trip_stops) es otra cosa. NULL = todavía sin asignar.';

COMMENT ON COLUMN app.closure_lines.home_location_id IS
  'Origen base del sujeto ESE día, copiado al calcular la línea. Para DRIVER sale de '
  'public.drivers.home_location_id; para ASSET, del conductor habitual del tracto. Es la '
  'dimensión de la ASISTENCIA — el origen real del viaje se lee de app.trip_stops.';

COMMIT;
