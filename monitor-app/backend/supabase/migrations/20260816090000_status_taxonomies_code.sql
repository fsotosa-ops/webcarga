-- El catálogo gana un identificador estable, separado del nombre visible.
--
-- `app.status_taxonomies` era el ÚNICO catálogo del esquema sin código propio:
--
--   app.alert_thresholds       doc_type          + label
--   app.temperature_ranges     cargo_type        + label
--   app.trip_statuses          id (ASIGNADO)     + label
--   public.compliance_requirements requirement_code + name
--   app.status_taxonomies      uuid              + label   <-- el que faltaba
--
-- Por eso `public.carrier_management_types()` tenía que reconocer un tipo de
-- gestión POR SU NOMBRE VISIBLE ('Tractoreo', 'Equipo Completo'). Renombrar
-- una etiqueta desde Configuración —que es precisamente lo que la pantalla
-- ofrece hacer— dejaba de reconocerla, la función caía a lo declarado y las
-- reglas por gestión pasaban a alcanzar a otras empresas. Sin error, sin
-- registro: el mismo modo de falla silencioso del hallazgo C1 del Tramo 3.
--
-- `code` es nullable a propósito: sólo lo necesitan los vocabularios a los que
-- OTRAS tablas apuntan por texto. Hoy es uno solo (WEBCARGA_OPERATION_TYPE,
-- referenciado desde carriers.management_types y desde
-- compliance_requirements.applies_to_management_types). Los subtipos de
-- vehículo se referencian por uuid y no necesitan código.

ALTER TABLE app.status_taxonomies
    ADD COLUMN IF NOT EXISTS code text;

COMMENT ON COLUMN app.status_taxonomies.code IS
    'Identificador estable, independiente del nombre visible. Obligatorio sólo '
    'en los vocabularios que otras tablas referencian por texto. Nunca se '
    'renombra: para eso está `label`.';

-- Único dentro de su vocabulario: dos filas con el mismo código volverían a
-- dejar la resolución a criterio del plan de Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS status_taxonomies_domain_code_key
    ON app.status_taxonomies (domain, code)
    WHERE code IS NOT NULL;

-- La siembra es por etiqueta —lo que se está corrigiendo— porque es la única
-- llave que hay HOY, y corre una sola vez contra las etiquetas de hoy. El
-- bloque falla si no encuentra exactamente lo que espera: una siembra a medias
-- dejaría empresas sin tipo de gestión derivado y nadie se enteraría.
DO $$
DECLARE
    n int;
BEGIN
    UPDATE app.status_taxonomies SET code = 'TRACTOREO'
     WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND label = 'Tractoreo' AND code IS NULL;

    UPDATE app.status_taxonomies SET code = 'EQUIPO_COMPLETO'
     WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND label = 'Equipo Completo' AND code IS NULL;

    SELECT count(*) INTO n
      FROM app.status_taxonomies
     WHERE domain = 'WEBCARGA_OPERATION_TYPE' AND code IS NOT NULL;

    IF n <> 2 THEN
        RAISE EXCEPTION
            'Se esperaban 2 tipos de operacion con codigo y hay %. Las etiquetas '
            'del catalogo no son las que esta migracion conoce: revisar a mano '
            'antes de seguir.', n;
    END IF;
END $$;

-- Y la función deja de mirar el nombre visible.
CREATE OR REPLACE FUNCTION public.carrier_management_types(p_carrier_id uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT COALESCE(
        -- La flota manda cuando existe: el tipo de gestión observado sale de
        -- los vehículos activos de la empresa.
        (
            SELECT array_agg(DISTINCT t.code) FILTER (WHERE t.code IS NOT NULL)
            FROM public.asset_assignments aa
            JOIN public.assets a ON a.id = aa.asset_id
            JOIN app.status_taxonomies t ON t.id = a.webcarga_operation_type_id
            WHERE aa.carrier_id = p_carrier_id AND aa.status = 'ACTIVE'
        ),
        -- Y lo declarado cubre el hueco de las que todavía no tienen flota.
        (SELECT c.management_types FROM public.carriers c WHERE c.id = p_carrier_id)
    );
$function$;
