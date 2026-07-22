-- Fase 4 (HU-15, 2026-07-22): "una nueva ubicación queda guardada aunque
-- esté incompleta" — hoy public.locations solo se poblaba desde un sync de
-- una sola vez contra la planilla oficial (20260717230000). Cuando el TMS
-- reporta un destino que no está en esa planilla, el viaje sigue viéndose
-- bien en el Diario (regla de Pablo: "todo lo que venga del TMS lo tomamos
-- como válido"), pero el local nunca queda registrado — 259 combos
-- (generador de carga, local) confirmados hoy sin fila en public.locations.
--
-- Mismo patrón que trg_reconcile_new_driver/_carrier/_asset
-- (20260716230029): un trigger AFTER INSERT que siembra un registro
-- incompleto para completar después (HU-16), en vez de un pipeline Mage
-- recurrente — no requiere credenciales de un archivo fuente, y cubre
-- tanto la ingesta TMS (dbt) como la creación manual de viajes (API), ya
-- que ambas terminan insertando en app.trip_stops.
--
-- Solo DESTINATION: el ORIGIN casi siempre es un CD del transportista, no
-- un local de cliente (ver comentario en TripSlideOver.tsx sobre
-- origin_operation_type). "Incompleto" no es una columna nueva — se
-- deriva en el momento de mostrarlo (operation_type IS NULL), mismo
-- criterio ya usado en el Diario para "Sin clasificar".
CREATE OR REPLACE FUNCTION app.reconcile_new_trip_stop_location()
RETURNS TRIGGER AS $$
DECLARE
    v_shipper_id uuid;
BEGIN
    IF NEW.stop_type IS DISTINCT FROM 'DESTINATION' OR NEW.local IS NULL OR trim(NEW.local) = '' THEN
        RETURN NEW;
    END IF;

    SELECT sh.id INTO v_shipper_id
    FROM app.trips t
    JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
    WHERE t.id = NEW.trip_id;

    -- Sin generador de carga resuelto no hay a qué entidad anclar el local
    -- (public.locations es polimórfico pero entity_id es NOT NULL) — el
    -- viaje sigue visible igual, esto solo afecta el catálogo de locales.
    IF v_shipper_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- ON CONFLICT contra el índice case-insensitive real (20260718020412)
    -- — (entity_type, entity_id, name, site_number) plano no matchea, la
    -- clave real es sobre lower(name).
    INSERT INTO public.locations (entity_type, entity_id, name, region_name, operational_status)
    VALUES ('SHIPPER', v_shipper_id, trim(NEW.local), NEW.destination_region, 'ACTIVE')
    ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = app, public, pg_temp;

CREATE TRIGGER trg_reconcile_new_trip_stop_location
AFTER INSERT ON app.trip_stops
FOR EACH ROW EXECUTE FUNCTION app.reconcile_new_trip_stop_location();

-- Backfill único: los 259 combos (generador de carga, local) ya observados
-- en trip_stops históricos pero nunca registrados en public.locations
-- (el trigger de arriba solo cubre inserciones futuras).
INSERT INTO public.locations (entity_type, entity_id, name, region_name, operational_status)
SELECT DISTINCT ON (sh.id, lower(trim(ts.local)))
    'SHIPPER', sh.id, trim(ts.local), ts.destination_region, 'ACTIVE'
FROM app.trip_stops ts
JOIN app.trips t ON t.id = ts.trip_id
JOIN public.shippers sh ON lower(trim(sh.name)) = lower(trim(t.client_name)) AND sh.status = 'ACTIVE'
WHERE ts.stop_type = 'DESTINATION' AND ts.local IS NOT NULL AND trim(ts.local) != ''
ON CONFLICT (entity_type, entity_id, lower(name), site_number) DO NOTHING;
