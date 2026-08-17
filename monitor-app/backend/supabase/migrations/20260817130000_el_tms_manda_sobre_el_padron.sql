-- ============================================================================
-- CORRECCIÓN DE PRECEDENCIA: el TMS manda sobre el padrón
-- ============================================================================
-- Encontrado por el usuario mirando el viaje 2032999 en el Monitor: el detalle
-- mostraba un conductor distinto del que reporta el TMS.
--
-- EL ERROR: la versión anterior ponía el padrón ENCIMA del nombre del TMS, lo
-- que invierte la relación entre evidencia e inferencia:
--   · el TMS dice QUIÉN MANEJÓ ESTE VIAJE            -> evidencia directa
--   · el padrón dice quién maneja HABITUALMENTE ese tracto -> inferencia
--
-- Medido antes del arreglo: de 1.002 viajes resueltos por padrón, 46 mostraban
-- una persona SIN NADA EN COMÚN con la que el TMS reportó, y el padrón NUNCA
-- estaba llenando un hueco — siempre pisaba lo que el TMS había dicho. No es
-- un dato peor: es una respuesta confiada y equivocada que tapa la verdad.
--
-- LA CAUSA RAÍZ DE QUE EL NOMBRE FALLARA: el roster guarda "Nombre Apellido" y
-- el TMS reporta "APELLIDO NOMBRE". La igualdad exacta cubría 34% por el
-- ORDEN, no por suciedad de datos. Comparando el CONJUNTO de palabras sube a
-- 59%; aceptando subconjuntos de >=3 palabras (al TMS le sobra o le falta un
-- nombre) llega a 79% con CERO ambigüedad medida.
--
-- El padrón pasa a llenar SILENCIO, no a contradecir. Si el TMS nombró a
-- alguien que no podemos identificar, NO se asigna conductor: queda el nombre
-- crudo a la vista y la celda pide el alta. Misma regla de siempre — una celda
-- vacía hace la pregunta, una mal llenada la esconde.
--
-- EFECTO: la identificación baja de ~100% a 60-88% por día. Esa caída ES la
-- corrección: el 100% incluía respuestas que contradecían al TMS. Lo que queda
-- sin identificar son 27 NOMBRES DISTINTOS (no 350 viajes) — una lista humana,
-- no un problema de algoritmo.
--
-- POR QUÉ NO HAY FUZZY AUTOMÁTICO: los viajes resueltos por RUT —donde la
-- identidad es SEGURA— tienen similitud de nombre de apenas 0,40. Un umbral
-- alto para ser seguro descarta personas que sí son la misma; uno bajo para
-- alcanzarlas inventa coincidencias. La similitud se usa para SUGERIR y
-- ordenar en la pantalla de operaciones, no para decidir sola.

CREATE OR REPLACE FUNCTION public.name_tokens(input text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'pg_catalog' AS $fn$
    SELECT array_agg(w ORDER BY w)
    FROM unnest(regexp_split_to_array(
        translate(lower(btrim(coalesce(input,''))), 'áéíóúñü', 'aeiounu'), '\s+')) w
    WHERE w <> '';
$fn$;

COMMENT ON FUNCTION public.name_tokens(text) IS
    'Palabras de un nombre, sin acentos, en minúscula y ORDENADAS. Compara '
    'personas sin depender del orden: el roster guarda "Nombre Apellido" y el '
    'TMS reporta "APELLIDO NOMBRE".';

ALTER TABLE app.trip_fleet_links DROP CONSTRAINT IF EXISTS tfl_driver_match_rule_check;
ALTER TABLE app.trip_fleet_links
    ADD CONSTRAINT tfl_driver_match_rule_check
    CHECK (driver_match_rule IS NULL
           OR driver_match_rule IN ('tms_rut','nombre','nombre_parcial','padron'));

CREATE OR REPLACE FUNCTION app.resolve_trip_fleet(p_trip_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(written integer, by_rule jsonb)
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'pg_catalog'
AS $function$
DECLARE v_written int := 0;
BEGIN
    PERFORM set_config('app.resolving_fleet', 'on', true);

    DROP TABLE IF EXISTS trip_resolution;
    CREATE TEMP TABLE trip_resolution ON COMMIT DROP AS
    WITH candidates AS (
        SELECT t.id AS trip_id,
               public.canonical_plate(NULLIF(t.fleet->>'tractor_plate',''))  AS tractor_plate,
               public.canonical_plate(NULLIF(t.fleet->>'trailer_plate',''))  AS trailer_plate,
               public.canonical_rut(NULLIF(t.fleet->>'driver_rut_tms',''))   AS tms_rut,
               NULLIF(btrim(t.fleet->>'driver_name_tms'), '')                AS driver_name_raw,
               public.name_tokens(t.fleet->>'driver_name_tms')               AS tms_tokens,
               NULLIF(btrim(t.fleet->>'transporter_name_tms'), '')           AS transporter_name_raw
        FROM app.trips t
        WHERE (p_trip_ids IS NULL OR t.id = ANY(p_trip_ids))
          AND NOT EXISTS (SELECT 1 FROM app.trip_fleet_links fl
                          WHERE fl.trip_id = t.id AND fl.link_source = 'manual')
    ),
    with_fleet AS (
        SELECT c.*, ta.id AS tractor_asset_id, tr.id AS trailer_asset_id
        FROM candidates c
        LEFT JOIN public.assets ta ON ta.license_plate = c.tractor_plate
        LEFT JOIN public.assets tr ON tr.license_plate = c.trailer_plate
    ),
    -- 3 · El nombre del TMS, por CONJUNTO de palabras (no por orden).
    by_name AS (
        SELECT wf.trip_id, min(d.id::text)::uuid AS driver_id
        FROM with_fleet wf JOIN public.drivers d
          ON public.name_tokens(d.full_name) = wf.tms_tokens
        WHERE wf.tms_tokens IS NOT NULL
        GROUP BY wf.trip_id HAVING count(*) = 1
    ),
    -- 4 · Subconjunto: al TMS le sobra o le falta un nombre. Exige >=3
    --     palabras en comun y UN solo candidato — medido: 0 ambiguos.
    by_partial AS (
        SELECT wf.trip_id, min(d.id::text)::uuid AS driver_id
        FROM with_fleet wf JOIN public.drivers d
          ON (public.name_tokens(d.full_name) <@ wf.tms_tokens
              OR wf.tms_tokens <@ public.name_tokens(d.full_name))
         AND cardinality(ARRAY(SELECT unnest(public.name_tokens(d.full_name))
                               INTERSECT SELECT unnest(wf.tms_tokens))) >= 3
        WHERE wf.tms_tokens IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM by_name bn WHERE bn.trip_id = wf.trip_id)
        GROUP BY wf.trip_id HAVING count(*) = 1
    )
    SELECT wf.trip_id, wf.driver_name_raw, wf.transporter_name_raw,
           wf.tractor_plate, wf.trailer_plate,
           wf.tractor_asset_id, wf.trailer_asset_id, aa.carrier_id,
           COALESCE(d_rut.id, bn.driver_id, bp.driver_id,
                    -- 5 · El padron SOLO si el TMS no dijo nada. Nunca
                    --     contradice un nombre reportado.
                    CASE WHEN wf.tms_tokens IS NULL THEN vda.driver_id END) AS driver_id,
           CASE WHEN d_rut.id     IS NOT NULL THEN 'tms_rut'
                WHEN bn.driver_id IS NOT NULL THEN 'nombre'
                WHEN bp.driver_id IS NOT NULL THEN 'nombre_parcial'
                WHEN wf.tms_tokens IS NULL AND vda.driver_id IS NOT NULL THEN 'padron'
           END AS driver_match_rule
    FROM with_fleet wf
    LEFT JOIN public.drivers d_rut
           ON wf.tms_rut IS NOT NULL AND d_rut.tax_id = wf.tms_rut
    LEFT JOIN by_name    bn ON bn.trip_id = wf.trip_id
    LEFT JOIN by_partial bp ON bp.trip_id = wf.trip_id
    LEFT JOIN public.vehicle_driver_assignments vda
           ON vda.asset_id = wf.tractor_asset_id AND vda.status = 'ACTIVE'
    LEFT JOIN public.asset_assignments aa
           ON aa.asset_id = wf.tractor_asset_id AND aa.status = 'ACTIVE';

    WITH written AS (
        INSERT INTO app.trip_fleet_links (
            trip_id, driver_id, driver_name_raw, carrier_id, transporter_name_raw,
            tractor_plate, trailer_plate, tractor_asset_id, trailer_asset_id,
            link_source, driver_match_rule, resolved_at)
        SELECT r.trip_id, r.driver_id, r.driver_name_raw, r.carrier_id, r.transporter_name_raw,
               r.tractor_plate, r.trailer_plate, r.tractor_asset_id, r.trailer_asset_id,
               'auto', r.driver_match_rule, now()
        FROM trip_resolution r
        WHERE r.driver_id IS NOT NULL OR r.tractor_asset_id IS NOT NULL
           OR r.carrier_id IS NOT NULL OR r.driver_name_raw IS NOT NULL
        ON CONFLICT (trip_id) DO UPDATE SET
            driver_id = EXCLUDED.driver_id, driver_name_raw = EXCLUDED.driver_name_raw,
            carrier_id = EXCLUDED.carrier_id, transporter_name_raw = EXCLUDED.transporter_name_raw,
            tractor_plate = EXCLUDED.tractor_plate, trailer_plate = EXCLUDED.trailer_plate,
            tractor_asset_id = EXCLUDED.tractor_asset_id, trailer_asset_id = EXCLUDED.trailer_asset_id,
            driver_match_rule = EXCLUDED.driver_match_rule,
            resolved_at = EXCLUDED.resolved_at, updated_at = now()
        WHERE app.trip_fleet_links.link_source <> 'manual'
        RETURNING trip_id
    ) SELECT count(*) INTO v_written FROM written;

    UPDATE app.trips t SET fleet_link_id = fl.id
    FROM app.trip_fleet_links fl
    WHERE fl.trip_id = t.id AND t.fleet_link_id IS DISTINCT FROM fl.id;

    RETURN QUERY SELECT v_written,
        COALESCE(jsonb_object_agg(x.rule, x.n), '{}'::jsonb)
    FROM (SELECT COALESCE(driver_match_rule,'sin identificar') AS rule, count(*) AS n
          FROM trip_resolution GROUP BY 1) x;
END;
$function$;
