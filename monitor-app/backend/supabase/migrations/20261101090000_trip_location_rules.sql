-- Las reglas de lugar del viaje, en la base (diseño de Analítica, 2026-10-21, paso 1).
--
-- Origen, último destino, tipo de operación de un local y zona del destino vivían solo en Python
-- (services/destination_zone.py, services/origen_del_viaje.py). La analítica (dbt en gold) necesita las mismas
-- reglas y un modelo de dbt no puede importar Python. Ahora la regla vive aquí, una sola vez; la API la llama.
--
-- Cambio de comportamiento a propósito (paradas vigentes):
--   * El último destino sale de la lista vigente del viaje (app.trips.stops, la última lectura del TMS o del alta
--     manual), no de "la fila DESTINATION con mayor stop_order" de app.trip_stops. trip_stops guarda también las
--     versiones viejas de las paradas (cuando el TMS cambia de base inserta en vez de actualizar; son historia, no
--     basura), y la regla anterior podía caer en una. Al 21/10 cambia el destino de 85 viajes desde julio.
--   * Un nombre de local que en un mismo cliente tiene dos tipos de operación distintos (2 casos) ya no se
--     resuelve al azar: queda sin resolver.
-- El origen sigue siendo la primera parada ORIGIN por stop_order (Sodimac es multiorigen: varias son reales).

BEGIN;

-- Nombre de local comparable: sin tildes, en mayúsculas, con un solo espacio. Mismo criterio que el
-- normalize_location_name de Python (NFKD a ASCII); sin la extensión unaccent, las letras del español van a mano.
CREATE OR REPLACE FUNCTION app.normalize_location_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT NULLIF(btrim(regexp_replace(
        upper(translate(p_name, 'ÁÉÍÓÚÜÑáéíóúüñÀÈÌÒÙàèìòù', 'AEIOUUNaeiouunAEIOUaeiou')),
        '\s+', ' ', 'g')), '')
$function$;

-- El tipo de operación de un local del cliente (RM, Z0, Region Norte, Region Sur), desde public.locations.
-- El local llega como lo escribe el TMS: "ALAMEDA - 72" (nombre y número de local) o solo un nombre.
--   1. Con número: el local activo del cliente con ese número. Si hay más de uno (el número se repite en 3 de 490
--      locales), desempata el nombre exacto y, si no, el que contiene al otro (el TMS antepone el formato:
--      "SBA San Bernardo Eucaliptus" vs "San Bernardo Eucaliptus"). Sin desempate seguro: NULL.
--   2. Sin número, o con un número que el cliente no tiene: por nombre. Ambiguo: NULL.
-- Nunca cruza clientes: el número de local solo vale dentro del cliente.
CREATE OR REPLACE FUNCTION app.location_operation_type(p_shipper_id uuid, p_local text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'app', 'public', 'pg_catalog'
AS $function$
DECLARE
    v_parts text[];
    v_name  text;
    v_num   text;
    v_types text[];
BEGIN
    IF p_shipper_id IS NULL OR NULLIF(btrim(p_local), '') IS NULL THEN
        RETURN NULL;
    END IF;
    v_parts := regexp_match(btrim(p_local), '^(.*?)\s*-\s*(\d+)\s*$');
    IF v_parts IS NULL THEN
        v_name := app.normalize_location_name(p_local);
    ELSE
        v_name := app.normalize_location_name(v_parts[1]);
        v_num := v_parts[2];
    END IF;

    IF v_num IS NOT NULL THEN
        SELECT array_agg(l.operation_type ORDER BY l.id) INTO v_types
        FROM public.locations l
        WHERE l.entity_type = 'SHIPPER' AND l.entity_id = p_shipper_id
          AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
          AND l.site_number = v_num;
        IF cardinality(v_types) = 1 THEN
            RETURN v_types[1];
        END IF;
        IF cardinality(v_types) > 1 THEN
            IF v_name IS NULL THEN
                RETURN NULL;
            END IF;
            SELECT array_agg(DISTINCT l.operation_type) INTO v_types
            FROM public.locations l
            WHERE l.entity_type = 'SHIPPER' AND l.entity_id = p_shipper_id
              AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
              AND l.site_number = v_num AND app.normalize_location_name(l.name) = v_name;
            IF cardinality(v_types) = 1 THEN
                RETURN v_types[1];
            END IF;
            SELECT array_agg(l.operation_type) INTO v_types
            FROM public.locations l
            WHERE l.entity_type = 'SHIPPER' AND l.entity_id = p_shipper_id
              AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
              AND l.site_number = v_num
              AND (strpos(v_name, app.normalize_location_name(l.name)) > 0
                   OR strpos(app.normalize_location_name(l.name), v_name) > 0);
            RETURN CASE WHEN cardinality(v_types) = 1 THEN v_types[1] END;
        END IF;
    END IF;

    IF v_name IS NULL THEN
        RETURN NULL;
    END IF;
    SELECT array_agg(DISTINCT l.operation_type) INTO v_types
    FROM public.locations l
    WHERE l.entity_type = 'SHIPPER' AND l.entity_id = p_shipper_id
      AND l.operational_status = 'ACTIVE' AND l.operation_type IS NOT NULL
      AND app.normalize_location_name(l.name) = v_name;
    RETURN CASE WHEN cardinality(v_types) = 1 THEN v_types[1] END;
END;
$function$;

-- La zona de un tipo de operación, como la muestran el Reporte y el Cierre.
CREATE OR REPLACE FUNCTION app.operation_type_zone(p_operation_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
    SELECT CASE
        WHEN p_operation_type = 'RM' THEN 'RM'
        WHEN p_operation_type = 'Z0' THEN 'Z0'
        WHEN p_operation_type IN ('Region Norte', 'Region Sur') THEN 'Región'
        ELSE 'Sin clasificar'
    END
$function$;

-- El origen del viaje: su primera parada ORIGIN (10/10). La vista app.v_driver_daily_trip_legs usa el mismo
-- criterio escrito en su cuerpo (20260823190000).
CREATE OR REPLACE FUNCTION app.trip_origin_local(p_trip_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT ts.local FROM app.trip_stops ts
    WHERE ts.trip_id = p_trip_id AND ts.stop_type = 'ORIGIN'
    ORDER BY ts.stop_order ASC
    LIMIT 1
$function$;

-- El último destino vigente del viaje: el último de app.trips.stops (solo trae destinos, en orden). Sin lista
-- vigente (un viaje viejo sin `stops`), la fila DESTINATION con mayor stop_order, como antes.
CREATE OR REPLACE FUNCTION app.trip_last_destination_local(p_trip_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT COALESCE(
        (SELECT e.value->>'local'
         FROM app.trips t, jsonb_array_elements(CASE WHEN jsonb_typeof(t.stops) = 'array' THEN t.stops END)
              WITH ORDINALITY AS e(value, n)
         WHERE t.id = p_trip_id
         ORDER BY e.n DESC
         LIMIT 1),
        (SELECT ts.local FROM app.trip_stops ts
         WHERE ts.trip_id = p_trip_id AND ts.stop_type = 'DESTINATION'
         ORDER BY ts.stop_order DESC
         LIMIT 1)
    )
$function$;

-- La zona del destino del viaje (RM, Z0, Región, Sin clasificar): la de su último destino vigente.
CREATE OR REPLACE FUNCTION app.trip_destination_zone(p_trip_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT app.operation_type_zone(
        app.location_operation_type(t.shipper_id, app.trip_last_destination_local(t.id)))
    FROM app.trips t
    WHERE t.id = p_trip_id
$function$;

-- Las búsquedas de location_operation_type: por número de local y por nombre normalizado, dentro del cliente.
CREATE INDEX IF NOT EXISTS idx_locations_shipper_site_number
    ON public.locations (entity_id, site_number) WHERE entity_type = 'SHIPPER' AND operational_status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_locations_shipper_normalized_name
    ON public.locations (entity_id, app.normalize_location_name(name))
    WHERE entity_type = 'SHIPPER' AND operational_status = 'ACTIVE';

-- normalize_location_name queda pública: la usa un índice de public.locations, y quien inserte un local la ejecuta.
REVOKE ALL ON FUNCTION app.location_operation_type(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.operation_type_zone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.trip_origin_local(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.trip_last_destination_local(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.trip_destination_zone(uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
