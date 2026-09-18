-- Si el TMS lo reporta como origen, ES un CD (HU-28, decisión del usuario 17/09:
-- *"si aparecen dentro de la trazabilidad de origen es porque lo son"*).
--
-- QUÉ REEMPLAZA
-- La siembra de 20260917020000 usaba un umbral de 5 viajes en 90 días y dejaba
-- 12 lugares afuera (Bodega CD Maderas Rengo, Logística Inversa, Saam Renca,
-- y ocho de Walmart con 1-2 viajes). Ese umbral era una heurística mía, no una
-- regla del negocio: separaba "CD de verdad" de "ruido" sin tener con qué
-- decidirlo. La regla del usuario no necesita umbral y es verificable — el
-- origen lo reportó el TMS.
--
-- Y RETIRA UNA EXCLUSIÓN QUE YA NO TIENE SENTIDO
-- `app.reconcile_new_trip_stop_location()` (20260722010000) auto-registra los
-- DESTINATION y se saltaba los ORIGIN a propósito, con este argumento: *"el
-- ORIGIN casi siempre es un CD del transportista, no un local de cliente"*. Era
-- correcto cuando una fila de public.locations sólo podía significar "local de
-- entrega": registrar un CD ahí lo disfrazaba de tienda. Con `is_origin_cd` como
-- ROL aparte eso deja de pasar, y sin el trigger el catálogo de CD se queda
-- viejo el día que aparece uno nuevo, en silencio y sin que nadie lo note.
--
-- El texto del TMS sigue intocado: esto escribe en el catálogo, no en el viaje.

BEGIN;

-- ── 1. El trigger también siembra orígenes, con su rol ──────────────────────
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

    -- Sin generador de carga resuelto no hay a qué entidad anclar el lugar
    -- (public.locations es polimórfico pero entity_id es NOT NULL) — el viaje
    -- sigue visible igual, esto sólo afecta el catálogo.
    IF v_shipper_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- destination_region sólo tiene sentido en un destino.
    INSERT INTO public.locations (entity_type, entity_id, name, region_name, operational_status, is_origin_cd)
    VALUES ('SHIPPER', v_shipper_id, trim(NEW.local),
            CASE WHEN v_es_origen THEN NULL ELSE NEW.destination_region END,
            'ACTIVE', v_es_origen)
    -- Un lugar que ya existía como local de entrega y ahora aparece como origen
    -- SUMA el rol; nunca lo pierde al revés (un destino no apaga is_origin_cd).
    ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO UPDATE
        SET is_origin_cd = public.locations.is_origin_cd OR EXCLUDED.is_origin_cd,
            updated_at   = now()
        WHERE EXCLUDED.is_origin_cd AND NOT public.locations.is_origin_cd;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = app, public, pg_temp;

-- ── 2. Backfill: todo origen ya observado, sin umbral ───────────────────────
-- Ventana completa del histórico, no 90 días: un CD que operó y dejó de operar
-- igual existió, y darlo de baja es un acto explícito desde Configuración.
INSERT INTO public.locations (entity_type, entity_id, name, operational_status, is_origin_cd)
SELECT DISTINCT ON (sh.id, lower(trim(ts.local)))
    'SHIPPER', sh.id, trim(ts.local), 'ACTIVE', true
FROM app.trip_stops ts
JOIN app.trips t ON t.id = ts.trip_id
JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE ts.stop_type = 'ORIGIN' AND ts.local IS NOT NULL AND trim(ts.local) != ''
ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO UPDATE
    SET is_origin_cd = true, updated_at = now()
    WHERE NOT public.locations.is_origin_cd;

COMMIT;
