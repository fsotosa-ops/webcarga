-- El matcher por nombre prefiere la ficha activa
--
-- Brian Celis (Solicitud de Cambios Diario 2.0, punto 5; llamada del 01/10):
-- el directorio tiene dos fichas con el mismo nombre — 18659820-2 ACTIVA y
-- 19003069-5 INACTIVA — y by_name exigia UN solo candidato, asi que ningun
-- viaje suyo se resolvia solo: 27 vinculos a mano en 30 dias. Era el unico
-- nombre duplicado del directorio.
--
-- Regla: si varias fichas comparten el nombre y exactamente una esta activa,
-- se elige esa. Dos activas siguen siendo ambiguas y quedan sin resolver
-- (una celda vacia hace la pregunta; una mal llenada la esconde). El RUT del
-- TMS sigue ganando antes que el nombre.
--
-- Copia de la definicion viva (20260823210000) con solo by_name y by_partial
-- cambiados. Mas abajo, el mismo criterio en el padron de conductor habitual.
-- Al final re-resuelve los viajes auto sin conductor de 45 dias; los vinculos
-- manuales no se tocan (el resolvedor los excluye).
--
-- Aplicada el 01/10 en tres partes por el MCP (la llamada entera fallo por
-- tamano): 32 viajes resueltos. 30 eran de conductores cuya ficha se creo
-- DESPUES del viaje (nada los habia vuelto a resolver); 9 caen en dias ya
-- firmados — sus lineas de cierre no se tocan (un dia CLOSED no se recalcula).

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

    RETURN QUERY SELECT v_written,
        COALESCE(jsonb_object_agg(x.rule, x.n), '{}'::jsonb)
    FROM (SELECT COALESCE(driver_match_rule,'sin identificar') AS rule, count(*) AS n
          FROM trip_resolution GROUP BY 1) x;
END;
$function$;

-- El padrón no vuelve a colgar un tracto de una ficha dada de baja.
CREATE OR REPLACE FUNCTION public.sync_habitual_drivers(freshness_days integer DEFAULT 90)
 RETURNS TABLE(opened integer, closed integer, missing_asset integer, missing_driver integer, skipped_as_stale integer)
 LANGUAGE plpgsql
 SET search_path TO 'public', 'silver', 'pg_catalog'
AS $function$
DECLARE v_opened int := 0; v_closed int := 0;
BEGIN
    DROP TABLE IF EXISTS resolved_registry;
    CREATE TEMP TABLE resolved_registry ON COMMIT DROP AS
    SELECT p.plate, p.tax_id, p.last_dispatched_on,
           a.id AS asset_id, d.id AS driver_id
    FROM silver.int_habitual_driver_by_tractor p
    LEFT JOIN public.assets  a ON a.license_plate = p.plate
    -- Sólo una ficha ACTIVA puede ser conductor habitual (01/10): el Excel
    -- legacy trae el RUT viejo de Brian Celis (19003069-5, ficha dada de baja)
    -- y cada sincronización volvía a colgar de ahí el tracto FCCP42. Con la
    -- ficha inactiva fuera, el padrón calla (missing_driver) y no cierra el
    -- vínculo que ya existe.
    LEFT JOIN public.drivers d ON d.tax_id        = p.tax_id
                              AND d.operational_status = 'ACTIVE'
    -- EL CORTE DE FRESCURA. Medido contra julio: evidencia de menos de 3
    -- meses acierta 94,2% (673 casos); de 3 a 6 meses acierta 4,0% (25
    -- casos). Una entrada vieja no agrega una conjetura peor, agrega un
    -- nombre casi seguro equivocado — y en el Cierre un nombre plausible se
    -- confirma solo. La celda vacia hace la pregunta.
    WHERE p.last_dispatched_on >= current_date - freshness_days;

    WITH closing AS (
        UPDATE public.vehicle_driver_assignments v
        SET status = 'INACTIVE', end_date = CURRENT_DATE
        FROM resolved_registry p
        WHERE v.asset_id = p.asset_id AND v.status = 'ACTIVE'
          AND NOT v.is_manual_override
          AND p.driver_id IS NOT NULL AND v.driver_id IS DISTINCT FROM p.driver_id
        RETURNING 1
    ) SELECT count(*) INTO v_closed FROM closing;

    WITH opening AS (
        INSERT INTO public.vehicle_driver_assignments
            (asset_id, driver_id, status, start_date,
             is_manual_override, source, source_confirmed_at)
        SELECT p.asset_id, p.driver_id, 'ACTIVE', CURRENT_DATE,
               false, 'padron_legacy', p.last_dispatched_on
        FROM resolved_registry p
        WHERE p.asset_id IS NOT NULL AND p.driver_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.vehicle_driver_assignments v
                          WHERE v.asset_id = p.asset_id AND v.status = 'ACTIVE'
                            AND v.is_manual_override)
        ON CONFLICT (asset_id, driver_id) DO UPDATE
            SET status = 'ACTIVE', end_date = NULL, source = 'padron_legacy',
                source_confirmed_at = EXCLUDED.source_confirmed_at
            WHERE NOT public.vehicle_driver_assignments.is_manual_override
        RETURNING 1
    ) SELECT count(*) INTO v_opened FROM opening;

    RETURN QUERY SELECT v_opened, v_closed,
        (SELECT count(*)::int FROM resolved_registry WHERE asset_id IS NULL),
        (SELECT count(*)::int FROM resolved_registry WHERE driver_id IS NULL),
        (SELECT count(*)::int FROM silver.int_habitual_driver_by_tractor
          WHERE last_dispatched_on < current_date - freshness_days);
END;
$function$;

-- Los vínculos habituales que hoy apuntan a una ficha INACTIVA pasan a la
-- ficha ACTIVA de la misma persona, si hay exactamente una con el mismo nombre
-- (la misma regla del matcher de arriba). Al 01/10: FCCP42 (Brian Celis). Si
-- no hay una única ficha activa se deja como está — FLPY18 queda para que
-- Operaciones decida — porque elegir a ciegas es peor que la celda que pregunta.
UPDATE public.vehicle_driver_assignments v
SET driver_id = activo.id
FROM public.drivers inactivo,
     LATERAL (
         SELECT min(d.id::text)::uuid AS id
         FROM public.drivers d
         WHERE d.operational_status = 'ACTIVE'
           AND public.name_tokens(d.full_name) = public.name_tokens(inactivo.full_name)
         HAVING count(*) = 1
     ) activo
WHERE v.driver_id = inactivo.id AND v.status = 'ACTIVE'
  AND inactivo.operational_status <> 'ACTIVE'
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_driver_assignments x
                  WHERE x.asset_id = v.asset_id AND x.driver_id = activo.id);

-- Re-resolver los viajes automáticos sin conductor de los últimos 45 días;
-- los vínculos manuales no se tocan (el resolvedor los excluye).
SELECT app.resolve_trip_fleet(array(
    SELECT t.id FROM app.trips t
    JOIN app.trip_fleet_links l ON l.trip_id = t.id
    WHERE l.link_source = 'auto' AND l.driver_id IS NULL
      AND t.planning_date >= current_date - 45
));
