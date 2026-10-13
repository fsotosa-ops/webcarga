-- La "Divergencia TMS" pasa a ser una nota automática del sistema, sin autor
-- (encargo 2026-10-12-tms-divergence-system-note, aprobado por el usuario).
--
-- Antes la escribía GET /trips/{id} (_log_tms_divergence_once, trips.py) a
-- nombre de quien abría el viaje. Ahora la escribe app.resolve_trip_fleet —la
-- que corre el trigger de app.trips que recrea el post_hook de dbt— cuando
-- llega el dato del TMS, con author_id NULL. Abrir un viaje ya no escribe nada.
--
-- La regla es la misma que tenía el código Python, con una diferencia pedida
-- por el encargo: solo con vínculo MANUAL (link_source = 'manual'). Python
-- miraba app.trips.fleet_link_id, que también apunta a vínculos automáticos;
-- 64 de las 98 notas existentes eran de viajes con vínculo automático, donde
-- el "conductor vinculado" sale del mismo TMS y la diferencia es de formato.
--   conductor: fleet->>'driver_name_tms' (no vacío) distinto de
--              COALESCE(drivers.full_name, fl.driver_name_raw, fleet->>'driver_name_tms')
--   patente:   fleet->>'tractor_plate' (no vacío) distinto de
--              COALESCE(assets.license_plate, fl.tractor_plate, fleet->>'tractor_plate')
-- Mismo texto, y solo si la última nota de divergencia del viaje no es igual.
--
-- Re-ejecutable, sin BEGIN/COMMIT. Sin triggers nuevos en app.trips (los
-- dueños son los post_hooks de dbt).

-- 1 · Solo una nota del sistema puede no tener autor.
ALTER TABLE app.trip_notes ALTER COLUMN author_id DROP NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conrelid = 'app.trip_notes'::regclass
                     AND conname = 'trip_notes_author_required_unless_system') THEN
        ALTER TABLE app.trip_notes ADD CONSTRAINT trip_notes_author_required_unless_system
            CHECK (author_id IS NOT NULL OR note_type = 'sistema');
    END IF;
END;
$$;

COMMENT ON COLUMN app.trip_notes.author_id IS
  'Quién escribió la nota. NULL solo en notas automáticas del sistema (note_type = ''sistema''), '
  'p. ej. la Divergencia TMS que escribe app.log_tms_divergence. La pantalla las muestra como "Sistema".';

-- 2 · La detección, cuando llega el dato del TMS.
CREATE OR REPLACE FUNCTION app.log_tms_divergence(p_trip_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'app', 'public', 'pg_catalog'
AS $function$
DECLARE v_written int := 0;
BEGIN
    -- Best-effort, como lo era en Python: una nota nunca rompe la carga del TMS.
    BEGIN
        WITH reported AS (
            SELECT t.id AS trip_id,
                   NULLIF(t.fleet->>'driver_name_tms', '') AS tms_driver,
                   COALESCE(d.full_name, fl.driver_name_raw, t.fleet->>'driver_name_tms') AS linked_driver,
                   NULLIF(t.fleet->>'tractor_plate', '') AS tms_plate,
                   COALESCE(ta.license_plate, fl.tractor_plate, t.fleet->>'tractor_plate') AS linked_plate
            FROM app.trips t
            JOIN app.trip_fleet_links fl ON fl.trip_id = t.id AND fl.link_source = 'manual'
            LEFT JOIN public.drivers d ON d.id = fl.driver_id
            LEFT JOIN public.assets ta ON ta.id = fl.tractor_asset_id
            WHERE (p_trip_ids IS NULL OR t.id = ANY(p_trip_ids))
        ),
        divergent AS (
            SELECT r.trip_id,
                   'Divergencia TMS: ' || concat_ws(', ',
                       CASE WHEN r.tms_driver IS DISTINCT FROM r.linked_driver
                            THEN 'conductor reportado por TMS: ' || r.tms_driver END,
                       CASE WHEN r.tms_plate IS DISTINCT FROM r.linked_plate
                            THEN 'patente reportado por TMS: ' || r.tms_plate END) AS body
            FROM reported r
            WHERE (r.tms_driver IS NOT NULL AND r.tms_driver IS DISTINCT FROM r.linked_driver)
               OR (r.tms_plate  IS NOT NULL AND r.tms_plate  IS DISTINCT FROM r.linked_plate)
        ),
        written AS (
            -- clock_timestamp(): dos cargas en la misma transacción no empatan
            -- en created_at, que es lo que ordena "la última nota".
            INSERT INTO app.trip_notes (trip_id, author_id, body, note_type, created_at)
            SELECT v.trip_id, NULL, v.body, 'sistema', clock_timestamp()
            FROM divergent v
            WHERE (SELECT n.body FROM app.trip_notes n
                   WHERE n.trip_id = v.trip_id AND n.note_type = 'sistema'
                     AND n.body LIKE 'Divergencia TMS:%'
                   ORDER BY n.created_at DESC LIMIT 1) IS DISTINCT FROM v.body
            RETURNING 1
        ) SELECT count(*) INTO v_written FROM written;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'app.log_tms_divergence: % (%)', SQLERRM, SQLSTATE;
        RETURN 0;
    END;
    RETURN v_written;
END;
$function$;

COMMENT ON FUNCTION app.log_tms_divergence(uuid[]) IS
  'Divergencia TMS: si el viaje tiene vínculo manual y el TMS reporta otro conductor o patente, '
  'escribe una nota ''sistema'' sin autor en app.trip_notes, una vez por valor. La llama '
  'app.resolve_trip_fleet (trigger de app.trips). Antes la escribía GET /trips/{id}.';

-- 3 · app.resolve_trip_fleet la llama al final. Todo lo demás, igual que en vivo
--     (20261001110000).
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
        -- Con varios candidatos gana el UNICO activo: una ficha dada de baja
        -- con el mismo nombre no es una ambiguedad real (Brian Celis, 01/10:
        -- 27 vinculos a mano en un mes por un duplicado inactivo).
        SELECT wf.trip_id,
               CASE WHEN count(*) = 1 THEN min(d.id::text)
                    ELSE min(d.id::text) FILTER (WHERE d.operational_status = 'ACTIVE')
               END::uuid AS driver_id
        FROM with_fleet wf JOIN public.drivers d
          ON public.name_tokens(d.full_name) = wf.tms_tokens
        WHERE wf.tms_tokens IS NOT NULL
        GROUP BY wf.trip_id
        HAVING count(*) = 1 OR count(*) FILTER (WHERE d.operational_status = 'ACTIVE') = 1
    ),
    -- 4 · Subconjunto: al TMS le sobra o le falta un nombre. Exige >=3
    --     palabras en comun y UN solo candidato — medido: 0 ambiguos.
    by_partial AS (
        SELECT wf.trip_id,
               CASE WHEN count(*) = 1 THEN min(d.id::text)
                    ELSE min(d.id::text) FILTER (WHERE d.operational_status = 'ACTIVE')
               END::uuid AS driver_id
        FROM with_fleet wf JOIN public.drivers d
          ON (public.name_tokens(d.full_name) <@ wf.tms_tokens
              OR wf.tms_tokens <@ public.name_tokens(d.full_name))
         AND cardinality(ARRAY(SELECT unnest(public.name_tokens(d.full_name))
                               INTERSECT SELECT unnest(wf.tms_tokens))) >= 3
        WHERE wf.tms_tokens IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM by_name bn WHERE bn.trip_id = wf.trip_id)
        GROUP BY wf.trip_id
        HAVING count(*) = 1 OR count(*) FILTER (WHERE d.operational_status = 'ACTIVE') = 1
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

    -- LLENAR EL SILENCIO DE UN LINK MANUAL, SIN CONTRADECIRLO NUNCA.
    -- (ver 20260823210000: una inferencia llena un silencio, nunca contradice
    -- un dato declarado; por eso el WHERE exige carrier_id IS NULL.)
    UPDATE app.trip_fleet_links fl
    SET carrier_id = da.carrier_id,
        updated_at = now()
    FROM public.driver_assignments da
    WHERE fl.link_source = 'manual'
      AND fl.carrier_id IS NULL
      AND fl.driver_id IS NOT NULL
      AND da.driver_id = fl.driver_id
      AND da.status = 'ACTIVE'
      AND (p_trip_ids IS NULL OR fl.trip_id = ANY(p_trip_ids));

    UPDATE app.trips t SET fleet_link_id = fl.id
    FROM app.trip_fleet_links fl
    WHERE fl.trip_id = t.id AND t.fleet_link_id IS DISTINCT FROM fl.id;

    -- La divergencia con el TMS se anota cuando llega el dato (20261016090000).
    PERFORM app.log_tms_divergence(p_trip_ids);

    RETURN QUERY SELECT v_written,
        COALESCE(jsonb_object_agg(x.rule, x.n), '{}'::jsonb)
    FROM (SELECT COALESCE(driver_match_rule,'sin identificar') AS rule, count(*) AS n
          FROM trip_resolution GROUP BY 1) x;
END;
$function$;

COMMENT ON FUNCTION app.resolve_trip_fleet(uuid[]) IS
  'Capa 3: resuelve conductor/tracto/empresa y MATERIALIZA la respuesta en app.trip_fleet_links. '
  'Precedencia: manual (terminal) > tms_rut > padron > nombre. Sin argumento procesa todos. Idempotente. '
  'Al final anota la Divergencia TMS de los vínculos manuales (app.log_tms_divergence).';

-- 4 · Las notas de divergencia que ya existen pierden el autor falso (quien
--     abrió el viaje). Antes se copia cada fila a audit_log para poder
--     restaurarla. Las demás notas 'sistema' no se tocan. Re-ejecutable: la
--     segunda corrida no encuentra notas con autor y no copia nada.
--     audit_log.id es GENERATED ALWAYS AS IDENTITY: no se nombra.
-- tms-divergence:data
WITH antes AS (
    SELECT n.* FROM app.trip_notes n
    WHERE n.note_type = 'sistema' AND n.body LIKE 'Divergencia TMS:%' AND n.author_id IS NOT NULL
    FOR UPDATE
),
copia AS (
    INSERT INTO public.audit_log (actor, entity_type, entity_id, action, field, old_value, new_value, source, doc_code)
    SELECT NULL, 'TRIP_NOTE', a.id, 'update', 'author_id', to_jsonb(a), NULL, 'migration', NULL
    FROM antes a
)
UPDATE app.trip_notes n SET author_id = NULL
FROM antes a
WHERE n.id = a.id;
