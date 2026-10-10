-- La marca del Cierre sigue el estándar de nombres de la base (10/10).
--
-- Las funciones y triggers de la base van en inglés, verbo + objeto:
-- protect_manual_overrides, resolve_trip_fleet, set_updated_at,
-- trg_trips_resolve_fleet_ins, trg_reconcile_new_driver; y la tabla de
-- transición se llama `changed`. 20261010120000 creó app.marcar_cierre_pendiente()
-- y trg_marcar_cierre_*, con la tabla de transición `cambiadas`. Esta migración
-- los reemplaza por app.enqueue_closure_recompute() y
-- trg_enqueue_closure_recompute_{ins,upd,del}. La lógica no cambia (la de
-- 20261010180000: solo inserciones, sin excepción de origen).
--
-- Incluye app.trips y app.trip_stops: el post_hook de dbt (Mage) se actualiza en
-- la misma ventana entre corridas, porque una versión de cada lado haría fallar
-- la corrida.

BEGIN;

CREATE FUNCTION app.enqueue_closure_recompute()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $$
BEGIN
    -- Un trigger por sentencia se dispara aunque la sentencia no toque filas.
    IF NOT EXISTS (SELECT 1 FROM changed) THEN
        RETURN NULL;
    END IF;

    -- Solo INSERT: no toma bloqueos que otra transacción pueda estar esperando.
    INSERT INTO app.closure_recompute_queue (business_date)
    SELECT dias.d
    FROM (
        SELECT p.business_date AS d
        FROM app.closure_periods p
        WHERE p.status = 'OPEN'
          AND p.business_date BETWEEN public.hoy_chile() - 45 AND public.hoy_chile()
        UNION
        SELECT public.hoy_chile()
    ) dias
    WHERE NOT EXISTS (
        SELECT 1 FROM app.closure_periods c WHERE c.business_date = dias.d AND c.status = 'CLOSED'
    );
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app.enqueue_closure_recompute() IS
    'Encola los días abiertos de los últimos 45 días y hoy (Chile) en '
    'app.closure_recompute_queue. La usan los trg_enqueue_closure_recompute_*; '
    'espera la tabla de transición "changed".';

DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'app.trip_fleet_links', 'public.assets', 'public.asset_assignments', 'public.drivers',
        'public.driver_assignments', 'public.vehicle_driver_assignments', 'public.carriers',
        'app.trip_statuses', 'app.trips', 'app.trip_stops'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_ins ON %s', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_upd ON %s', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_del ON %s', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_ins ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_enqueue_closure_recompute_ins AFTER INSERT ON %s '
                       'REFERENCING NEW TABLE AS changed FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.enqueue_closure_recompute()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_upd ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_enqueue_closure_recompute_upd AFTER UPDATE ON %s '
                       'REFERENCING NEW TABLE AS changed FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.enqueue_closure_recompute()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_enqueue_closure_recompute_del ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_enqueue_closure_recompute_del AFTER DELETE ON %s '
                       'REFERENCING OLD TABLE AS changed FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.enqueue_closure_recompute()', tabla);
    END LOOP;
END $$;

DROP FUNCTION app.marcar_cierre_pendiente();

COMMENT ON TABLE app.closure_recompute_queue IS
    'Marcas de días del Cierre con cambios pendientes, una fila por marca (solo '
    'inserciones). La llenan los triggers trg_enqueue_closure_recompute_*; la vacía '
    'POST /api/v1/internal/closures/recompute, borrando por id las marcas que leyó.';

COMMIT;
