-- ============================================================================
-- Capas 3 y 4 · la resolución deja de calcularse al leer y pasa a guardarse
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md
--
-- EL DEFECTO DE RAIZ QUE ESTO CORRIGE. `app.v_trip_fleet_resolution` decidia
-- quien manejo cada viaje EN CADA LECTURA, con un COALESCE de tres niveles
-- sobre comparacion de strings. Consecuencia: corregir manana la tipografia
-- del nombre de un conductor cambia quien aparece en un dia que operaciones
-- cerro ayer. Un cierre es una afirmacion sobre un instante; si se recalcula,
-- no afirma nada. Para un modulo de cierre eso es descalificante.
--
-- LAS DOS CAPAS VAN EN LA MISMA MIGRACION a proposito: entre una y otra la
-- vista leeria una tabla a medio llenar.
--
-- NO SE CREA NINGUNA TABLA. `app.trip_fleet_links` ya existia con la forma
-- correcta —UNIQUE(trip_id), FK a drivers/carriers/assets, los valores crudos,
-- link_source, created_by— y estaba congelada desde el backfill del 18/07 con
-- 432 de 1.541 viajes. Solo le faltaba quien la escribiera.

BEGIN;

-- ── Procedencia del match ───────────────────────────────────────────────────
-- `link_source` responde COMO SE CREO EL VINCULO ('manual' | 'auto') y se deja
-- intacto. La regla que identifico al CONDUCTOR es otra pregunta, y meterla en
-- la misma columna obligaria a inventar un valor para "resolvi el tracto pero
-- no al conductor". Columna propia, NULL cuando no hay conductor o cuando lo
-- puso una persona (ahi la persona ES la procedencia).
ALTER TABLE app.trip_fleet_links
    ADD COLUMN IF NOT EXISTS driver_match_rule text,
    ADD COLUMN IF NOT EXISTS resolved_at       timestamptz;

ALTER TABLE app.trip_fleet_links DROP CONSTRAINT IF EXISTS tfl_driver_match_rule_check;
ALTER TABLE app.trip_fleet_links
    ADD CONSTRAINT tfl_driver_match_rule_check
    CHECK (driver_match_rule IS NULL
           OR driver_match_rule IN ('tms_rut','padron','nombre'));

COMMENT ON COLUMN app.trip_fleet_links.driver_match_rule IS
    'Que regla identifico al conductor: tms_rut (el TMS trajo el RUT) | padron '
    '(patente -> conductor habitual, 94,2% con evidencia fresca) | nombre '
    '(igualdad exacta, 34%). Es la columna que hace el sistema MEDIBLE: '
    'permite preguntar cuantos cierres se apoyan en un match debil.';
COMMENT ON COLUMN app.trip_fleet_links.resolved_at IS
    'Cuando corrio el resolvedor sobre este viaje.';

CREATE INDEX IF NOT EXISTS idx_tfl_driver_match_rule
    ON app.trip_fleet_links (driver_match_rule);

-- ── El resolvedor: la precedencia, en UN solo lugar ─────────────────────────
CREATE OR REPLACE FUNCTION app.resolve_trip_fleet(p_trip_ids uuid[] DEFAULT NULL)
RETURNS TABLE (written int, by_rule jsonb)
LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $fn$
DECLARE v_written int := 0;
BEGIN
    -- `true` = local a la transaccion: se limpia sola al terminar, no puede
    -- quedar encendida y desactivar el trigger para el resto de la sesion.
    PERFORM set_config('app.resolving_fleet', 'on', true);

    DROP TABLE IF EXISTS trip_resolution;
    CREATE TEMP TABLE trip_resolution ON COMMIT DROP AS
    WITH candidates AS (
        SELECT t.id AS trip_id,
               public.canonical_plate(NULLIF(t.fleet->>'tractor_plate',''))  AS tractor_plate,
               public.canonical_plate(NULLIF(t.fleet->>'trailer_plate',''))  AS trailer_plate,
               public.canonical_rut(NULLIF(t.fleet->>'driver_rut_tms',''))   AS tms_rut,
               NULLIF(btrim(t.fleet->>'driver_name_tms'), '')                AS driver_name_raw,
               NULLIF(btrim(t.fleet->>'transporter_name_tms'), '')           AS transporter_name_raw
        FROM app.trips t
        WHERE (p_trip_ids IS NULL OR t.id = ANY(p_trip_ids))
          -- PRECEDENCIA 1: lo que dijo una persona es TERMINAL. Ni se lee.
          AND NOT EXISTS (SELECT 1 FROM app.trip_fleet_links fl
                          WHERE fl.trip_id = t.id AND fl.link_source = 'manual')
    ),
    with_fleet AS (
        -- El maestro ya es canonico POR CHECK: se normaliza solo el lado no
        -- confiable y la comparacion usa el indice unico.
        SELECT c.*, ta.id AS tractor_asset_id, tr.id AS trailer_asset_id
        FROM candidates c
        LEFT JOIN public.assets ta ON ta.license_plate = c.tractor_plate
        LEFT JOIN public.assets tr ON tr.license_plate = c.trailer_plate
    )
    SELECT wf.trip_id, wf.driver_name_raw, wf.transporter_name_raw,
           wf.tractor_plate, wf.trailer_plate,
           wf.tractor_asset_id, wf.trailer_asset_id, aa.carrier_id,
           -- PRECEDENCIA 2, 3, 4. El orden del COALESCE ES la regla, y vive en
           -- UN solo lugar de todo el sistema.
           COALESCE(d_rut.id, vda.driver_id, d_name.id) AS driver_id,
           CASE WHEN d_rut.id      IS NOT NULL THEN 'tms_rut'
                WHEN vda.driver_id IS NOT NULL THEN 'padron'
                WHEN d_name.id     IS NOT NULL THEN 'nombre'
           END AS driver_match_rule
    FROM with_fleet wf
    -- 2 · El TMS trajo el RUT: identidad directa, sin inferencia.
    LEFT JOIN public.drivers d_rut
           ON wf.tms_rut IS NOT NULL AND d_rut.tax_id = wf.tms_rut
    -- 3 · El padron: patente -> conductor habitual vigente.
    LEFT JOIN public.vehicle_driver_assignments vda
           ON vda.asset_id = wf.tractor_asset_id AND vda.status = 'ACTIVE'
    -- 4 · Ultimo recurso: igualdad exacta de nombre. Acierta el 34%, y por eso
    --     se REGISTRA como tal en vez de disfrazarse de dato firme.
    LEFT JOIN public.drivers d_name
           ON wf.driver_name_raw IS NOT NULL
          AND lower(btrim(d_name.full_name)) = lower(wf.driver_name_raw)
    LEFT JOIN public.asset_assignments aa
           ON aa.asset_id = wf.tractor_asset_id AND aa.status = 'ACTIVE';

    -- NO RESOLVER ES UNA RESPUESTA: si no se identifico nada, no se escribe
    -- fila. Un vacio obliga a decidir; un dato plausible pero equivocado se
    -- confirma solo. Misma razon por la que la siembra descarta lo viejo.
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
           OR r.carrier_id IS NOT NULL
        ON CONFLICT (trip_id) DO UPDATE SET
            driver_id = EXCLUDED.driver_id, driver_name_raw = EXCLUDED.driver_name_raw,
            carrier_id = EXCLUDED.carrier_id, transporter_name_raw = EXCLUDED.transporter_name_raw,
            tractor_plate = EXCLUDED.tractor_plate, trailer_plate = EXCLUDED.trailer_plate,
            tractor_asset_id = EXCLUDED.tractor_asset_id, trailer_asset_id = EXCLUDED.trailer_asset_id,
            driver_match_rule = EXCLUDED.driver_match_rule,
            resolved_at = EXCLUDED.resolved_at, updated_at = now()
        -- Red de seguridad: el filtro de candidatos ya excluyo lo manual, pero
        -- si algo se colara, aca no pasa.
        WHERE app.trip_fleet_links.link_source <> 'manual'
        RETURNING trip_id
    ) SELECT count(*) INTO v_written FROM written;

    -- `app.trips.fleet_link_id` es un puntero inverso redundante de
    -- `trip_fleet_links.trip_id UNIQUE`. trips.py ya dejo de usarlo (Fase 1 del
    -- hardening, 18/07) pero compliance.py TODAVIA une por ahi, asi que se
    -- mantiene en la MISMA transaccion para que no pueda derivar.
    -- ⚠ DEUDA: colapsarlo exige tocar el modelo dbt (la columna vive en
    --   app.trips, con merge_exclude_columns). No se improvisa.
    UPDATE app.trips t SET fleet_link_id = fl.id
    FROM app.trip_fleet_links fl
    WHERE fl.trip_id = t.id AND t.fleet_link_id IS DISTINCT FROM fl.id;

    RETURN QUERY SELECT v_written,
        COALESCE(jsonb_object_agg(x.rule, x.n), '{}'::jsonb)
    FROM (SELECT COALESCE(driver_match_rule,'sin conductor') AS rule, count(*) AS n
          FROM trip_resolution GROUP BY 1) x;
END;
$fn$;

COMMENT ON FUNCTION app.resolve_trip_fleet(uuid[]) IS
    'Capa 3: resuelve conductor/tracto/empresa y MATERIALIZA la respuesta en '
    'app.trip_fleet_links. Precedencia: manual (terminal) > tms_rut > padron > '
    'nombre. Sin argumento procesa todos. Idempotente.';

-- ── El trigger: ningun viaje sin intento de resolucion ──────────────────────
-- A diferencia de la siembra (capa 2, deliberada), esto SI es automatico: si
-- depende de que alguien se acuerde de correrlo, vuelve el problema.
CREATE OR REPLACE FUNCTION app.trg_resolve_trip_fleet()
RETURNS trigger LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $fn$
BEGIN
    -- pg_trigger_depth() NO sirve como guardia aca: vale 1 tanto cuando lo
    -- dispara el merge de dbt (queremos que corra) como cuando lo dispara el
    -- UPDATE de fleet_link_id del propio resolvedor (no queremos). Son
    -- indistinguibles por profundidad. La bandera de transaccion si los
    -- distingue, porque solo la pone el resolvedor.
    IF coalesce(current_setting('app.resolving_fleet', true), 'off') = 'on' THEN
        RETURN NULL;
    END IF;
    PERFORM app.resolve_trip_fleet(array(SELECT id FROM changed));
    RETURN NULL;
END;
$fn$;

-- FOR EACH STATEMENT, no FOR EACH ROW: dbt materializa app.trips con `merge`
-- en lotes de cientos de filas, y el resolvedor arma una tabla temporal por
-- invocacion. Por fila seria una tabla temporal por viaje.
DROP TRIGGER IF EXISTS trg_trips_resolve_fleet_ins ON app.trips;
CREATE TRIGGER trg_trips_resolve_fleet_ins
    AFTER INSERT ON app.trips
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.trg_resolve_trip_fleet();

DROP TRIGGER IF EXISTS trg_trips_resolve_fleet_upd ON app.trips;
CREATE TRIGGER trg_trips_resolve_fleet_upd
    AFTER UPDATE ON app.trips
    REFERENCING NEW TABLE AS changed
    FOR EACH STATEMENT EXECUTE FUNCTION app.trg_resolve_trip_fleet();

-- ── Capa 4: la vista deja de RESOLVER y pasa a LEER ─────────────────────────
-- De siete JOIN a dos. Misma firma que antes, asi que los 5 routers y 18
-- lugares que la consumen no cambian una linea — y ganan driver_match_rule.
CREATE OR REPLACE VIEW app.v_trip_fleet_resolution AS
SELECT
    t.id                 AS trip_id,
    fl.carrier_id        AS resolved_carrier_id,
    fl.driver_id         AS resolved_driver_id,
    fl.tractor_asset_id  AS resolved_tractor_asset_id,
    da_home.carrier_id   AS resolved_driver_home_carrier_id,
    fl.link_source,
    fl.driver_match_rule,
    fl.resolved_at
FROM app.trips t
LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
-- Empresa PROPIA del conductor resuelto (independiente de la del tracto):
-- permite detectar MISMATCH cuando conductor y tracto calzan cada uno por su
-- lado pero bajo empresas distintas.
LEFT JOIN public.driver_assignments da_home
       ON da_home.driver_id = fl.driver_id AND da_home.status = 'ACTIVE';

COMMIT;

-- ⚠ PENDIENTE EN MAGE: los dos triggers se pierden con un `dbt --full-refresh`
--   (DROP + CREATE TABLE AS SELECT). Hay que agregarlos al post_hook del
--   modelo `app/trips.sql`, junto a trg_protect_manual_overrides, que existe
--   por exactamente esta razon. El push a Mage lo bloquea el clasificador de
--   permisos: pegar a mano estas dos lineas en el post_hook.
--
-- Backfill inicial, 2026-08-17: written=1443,
--   {padron: 1154, nombre: 27, tms_rut: 7, sin conductor: 344}
-- SELECT * FROM app.resolve_trip_fleet();
