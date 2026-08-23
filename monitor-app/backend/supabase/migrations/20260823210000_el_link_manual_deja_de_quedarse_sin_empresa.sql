-- Un link manual sin empresa deja de quedarse sin empresa para siempre.
--
-- Es el reclamo de Pablo sobre Edgar, y la causa no era la que parecia. Nada
-- "se revertia": `resolve_trip_fleet()` excluye los links manuales en DOS
-- lugares —no entran al calculo, y el ON CONFLICT no los pisa— justamente para
-- proteger la eleccion humana, y eso esta bien. El efecto colateral es que si
-- al vincular se eligio SOLO al conductor, el `carrier_id` nacio NULL y ese
-- NULL quedo congelado: ninguna corrida vuelve a mirarlo.
--
-- Medido el 2026-08-23: 25 links manuales, 14 sin empresa, y LOS 14 tienen un
-- conductor que si la tiene. Cero casos con empresa distinta a la del
-- conductor.
--
-- El arreglo NO relaja las guardas: agrega un UPDATE que solo toca filas con
-- `carrier_id IS NULL`. Una inferencia llena un silencio, nunca contradice — la
-- misma regla que la capa 5 del propio resolvedor ("el padron SOLO si el TMS no
-- dijo nada").

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

    -- LLENAR EL SILENCIO DE UN LINK MANUAL, SIN CONTRADECIRLO NUNCA.
    --
    -- El reclamo de Pablo sobre Edgar: identificaba al conductor a mano, y el
    -- viaje volvia a aparecer sin empresa. No se revertia nada — el link manual
    -- se conserva intacto, que es justo lo que las dos guardas de arriba
    -- protegen. Lo que pasaba es mas simple: al vincular SOLO al conductor, el
    -- `carrier_id` nacia NULL, y como el link manual queda EXCLUIDO de todo el
    -- calculo, ese NULL se congelaba para siempre. Ninguna corrida lo tocaba.
    --
    -- Medido el 2026-08-23: de 25 links manuales, 14 no tienen empresa Y LOS 14
    -- tienen un conductor que si la tiene. Y hay CERO casos donde la empresa
    -- del link difiera de la de su conductor, asi que rellenar no puede
    -- contradecir una eleccion humana hoy — y por construccion tampoco manana.
    --
    -- La regla es la que el proyecto ya aplica en la capa 5 de arriba ("el
    -- padron SOLO si el TMS no dijo nada"): una inferencia LLENA UN SILENCIO,
    -- nunca contradice un dato declarado. Por eso el WHERE exige
    -- `carrier_id IS NULL`: si una persona eligio empresa, esto no la mira.
    --
    -- No toca `resolved_at`: ese campo cuenta cuando se resolvio el link, y
    -- este UPDATE no re-resuelve nada, completa un campo que faltaba.
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
