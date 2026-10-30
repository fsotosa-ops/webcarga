-- Nombres de relleno del TMS (30/10, Cierre › Por regularizar).
--
-- Algunos viajes llegan con "POR CONFIRMAR /" como conductor: no es una persona, es la
-- forma del TMS de decir "todavía no hay". La pantalla lo tomaba como un nombre y ofrecía
-- emparejarlo (o darlo de alta) en el Directorio.
--
-- Es el estándar de calidad de datos para los "valores nulos de la fuente": una lista
-- configurable de valores que significan "sin dato", aplicada UNA vez, conservando el
-- valor crudo. La lista es un catálogo de Configuración (dominio
-- TMS_PLACEHOLDER_DRIVER_NAME), no un literal en el código; la regla es una función que
-- leen todos los que necesitan el nombre del TMS (Monitor, Por regularizar, "sin
-- identificar"). El crudo en app.trips / app.trip_fleet_links no se toca.
--
-- La comparación es por palabras (public.name_tokens): "POR CONFIRMAR /", "por confirmar"
-- y "Confirmar, por" son el mismo relleno. Un nombre sin ninguna letra ("/", ".") tampoco
-- es un nombre.

BEGIN;

ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check CHECK (domain = ANY (ARRAY[
    'OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE',
    'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON', 'TRIP_VOID_REASON',
    'DEACTIVATION_REASON', 'REACTIVATION_REASON', 'ACTIVATION_EXCEPTION_REASON',
    'RETURN_TO_ONBOARDING_REASON', 'TMS_PLACEHOLDER_DRIVER_NAME']));

INSERT INTO app.status_taxonomies (domain, code, label, sort_order, active)
SELECT 'TMS_PLACEHOLDER_DRIVER_NAME', 'POR_CONFIRMAR', 'POR CONFIRMAR', 1, true
WHERE NOT EXISTS (
    SELECT 1 FROM app.status_taxonomies
    WHERE domain = 'TMS_PLACEHOLDER_DRIVER_NAME' AND code = 'POR_CONFIRMAR'
);

-- El nombre del conductor que informó el TMS, sin los rellenos: NULL si no es un nombre.
CREATE OR REPLACE FUNCTION app.tms_driver_name(p_raw text)
RETURNS text
LANGUAGE sql STABLE
SET search_path TO 'public', 'app', 'pg_catalog'
AS $$
    SELECT CASE
        WHEN public.name_tokens(p_raw) IS NULL THEN NULL
        WHEN EXISTS (
            SELECT 1 FROM app.status_taxonomies x
            WHERE x.domain = 'TMS_PLACEHOLDER_DRIVER_NAME' AND x.active
              AND public.name_tokens(x.label) = public.name_tokens(p_raw)
        ) THEN NULL
        ELSE p_raw
    END
$$;
COMMENT ON FUNCTION app.tms_driver_name(text) IS
    'El nombre de conductor que informó el TMS, o NULL si es un relleno del catálogo '
    'TMS_PLACEHOLDER_DRIVER_NAME (Configuración) o no tiene ninguna letra. El crudo no se toca.';
REVOKE ALL ON FUNCTION app.tms_driver_name(text) FROM PUBLIC, anon, authenticated;

COMMIT;
