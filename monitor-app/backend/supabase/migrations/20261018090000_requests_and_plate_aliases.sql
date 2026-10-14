-- Entrega B (plan 2026-10-14): pedidos de Operaciones a Certificación y alias de patente.
--
-- 1 · app.certification_requests: "Pedir a Certificación". Operaciones no sube documentos; pide.
--     Un solo pedido abierto por (entidad, requisito): pedir dos veces lo mismo no duplica.
-- 2 · app.asset_plate_aliases: corregir la patente de un equipo conserva el equipo (P12, 14/10);
--     la patente anterior queda como alias.
-- 3 · app.resolve_trip_fleet, desde la definición que corría en la base el 14/10
--     (pg_get_functiondef), con dos cambios:
--     a) las dos uniones por patente (tracto y rampla) prefieren la patente vigente y caen en el alias;
--     b) la empresa del tracto, y la del conductor en un vínculo manual, son las del DÍA del viaje
--        (app.fleet_assignment_periods, D2), no las de hoy.
--
-- Re-ejecutable, sin BEGIN/COMMIT.

CREATE TABLE IF NOT EXISTS app.certification_requests (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type     text NOT NULL CHECK (entity_type IN ('CARRIER', 'DRIVER', 'ASSET')),
    entity_id       uuid NOT NULL,
    requirement_id  uuid REFERENCES public.compliance_requirements(id),
    note            text,
    trip_id         uuid REFERENCES app.trips(id) ON DELETE SET NULL,
    closure_date    date,
    status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'RESOLVED')),
    created_by      uuid NOT NULL REFERENCES auth.users(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    resolved_by     uuid REFERENCES auth.users(id),
    resolved_at     timestamptz,
    resolution_note text,
    CONSTRAINT certification_requests_resolved_has_who
        CHECK (status = 'OPEN' OR resolved_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS certification_requests_one_open
    ON app.certification_requests (entity_type, entity_id,
        COALESCE(requirement_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS certification_requests_open
    ON app.certification_requests (created_at DESC) WHERE status = 'OPEN';

COMMENT ON TABLE app.certification_requests IS
  'Pedidos de Operaciones a Certificación ("Pedir a Certificación", Entrega B 14/10). Un solo pedido '
  'abierto por (entidad, requisito). Lo resuelve Certificación (documents.review) o se da por resuelto '
  'cuando el requisito pedido queda al día (se calcula al leer).';

REVOKE ALL ON app.certification_requests FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS app.asset_plate_aliases (
    plate       text PRIMARY KEY,
    asset_id    uuid NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
    reason      text NOT NULL,
    created_by  uuid REFERENCES auth.users(id),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS asset_plate_aliases_asset ON app.asset_plate_aliases (asset_id);

COMMENT ON TABLE app.asset_plate_aliases IS
  'Patentes anteriores de un equipo (P12, 14/10: una patente nueva es el mismo equipo). Las usa '
  'app.resolve_trip_fleet para que un viaje con la patente vieja resuelva al mismo equipo.';

REVOKE ALL ON app.asset_plate_aliases FROM anon, authenticated;

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
               COALESCE(t.planning_date, public.hoy_chile())                 AS trip_day,
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
        LEFT JOIN LATERAL (
            SELECT x.id FROM (
                SELECT a.id, 0 AS prio FROM public.assets a WHERE a.license_plate = c.tractor_plate
                UNION ALL
                SELECT pa.asset_id, 1 FROM app.asset_plate_aliases pa WHERE pa.plate = c.tractor_plate
            ) x ORDER BY x.prio LIMIT 1
        ) ta ON true
        LEFT JOIN LATERAL (
            SELECT x.id FROM (
                SELECT a.id, 0 AS prio FROM public.assets a WHERE a.license_plate = c.trailer_plate
                UNION ALL
                SELECT pa.asset_id, 1 FROM app.asset_plate_aliases pa WHERE pa.plate = c.trailer_plate
            ) x ORDER BY x.prio LIMIT 1
        ) tr ON true
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
           wf.tractor_asset_id, wf.trailer_asset_id, aa.counterpart_id AS carrier_id,
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
    -- D2: la empresa del tracto EL DÍA del viaje, no la de hoy. Un viaje viejo que se
    -- vuelve a resolver no cambia de empresa por una transferencia posterior.
    LEFT JOIN app.fleet_assignment_periods aa
           ON aa.relation = 'ASSET_CARRIER' AND aa.subject_id = wf.tractor_asset_id
          AND aa.valid_during @> wf.trip_day;

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
    -- D2: la empresa del conductor el día del viaje.
    UPDATE app.trip_fleet_links fl
    SET carrier_id = da.counterpart_id,
        updated_at = now()
    FROM app.trips t, app.fleet_assignment_periods da
    WHERE fl.link_source = 'manual'
      AND fl.carrier_id IS NULL
      AND fl.driver_id IS NOT NULL
      AND t.id = fl.trip_id
      AND da.relation = 'DRIVER_CARRIER' AND da.subject_id = fl.driver_id
      AND da.valid_during @> COALESCE(t.planning_date, public.hoy_chile())
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
