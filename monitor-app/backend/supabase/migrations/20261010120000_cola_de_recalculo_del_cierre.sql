-- El recálculo del Cierre sale de la lectura (spec 2026-10-10).
--
-- Hasta hoy cada GET del Cierre recalculaba el día completo: 139 consultas,
-- tres veces por sesión. Desde acá, cuando cambia un dato de entrada de las
-- líneas, un trigger ENCOLA los días abiertos; un ejecutor llamado por Cloud
-- Scheduler los recalcula. Los GET leen.
--
-- La cola es una tabla propia y no una columna de closure_periods: recalcular,
-- firmar y poner un motivo toman esa fila con FOR UPDATE durante todo su
-- trabajo, y una marca ahí haría esperar a cada escritura de dbt y de la API, y
-- abriría un ciclo de bloqueos (spec §3.2).
--
-- `version` sube con cada marca; el ejecutor borra la entrada solo si la versión
-- que leyó no cambió. `requested_at` se fija al encolar: es "pendiente desde".
--
-- Los triggers de app.trips y app.trip_stops NO van acá: los crea el post_hook
-- de dbt, porque un --full-refresh borra lo que cree una migración (memoria
-- reference_dbt_post_hook_owns_db_objects).

BEGIN;

CREATE TABLE app.closure_recompute_queue (
    business_date date PRIMARY KEY,
    requested_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    version       bigint      NOT NULL DEFAULT 1
);

-- Sin políticas: la usan la API y los triggers (rol postgres), nadie desde PostgREST.
ALTER TABLE app.closure_recompute_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.closure_recompute_queue IS
    'Días del Cierre con cambios pendientes de recalcular. La llenan los triggers '
    'trg_marcar_cierre_*; la vacía POST /api/v1/internal/closures/recompute.';

CREATE OR REPLACE FUNCTION app.marcar_cierre_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $$
BEGIN
    -- Lo que escribe el propio recálculo (correcciones del pre-cierre) no lo
    -- vuelve a encolar: ya está calculando ese día.
    IF current_setting('app.origen_escritura', true) = 'recalculo_cierre' THEN
        RETURN NULL;
    END IF;
    -- Un trigger por sentencia se dispara aunque la sentencia no toque filas.
    IF NOT EXISTS (SELECT 1 FROM cambiadas) THEN
        RETURN NULL;
    END IF;

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
    )
    ON CONFLICT (business_date) DO UPDATE
        SET version = app.closure_recompute_queue.version + 1;
    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION app.marcar_cierre_pendiente() IS
    'Encola los días abiertos de los últimos 45 días y hoy (Chile). La usan todos '
    'los trg_marcar_cierre_*; espera la tabla de transición "cambiadas".';

-- Tres triggers por tabla (uno por evento), todos con la tabla de transición
-- llamada "cambiadas", para que una sola función sirva a todos.
DO $$
DECLARE
    tabla text;
BEGIN
    FOREACH tabla IN ARRAY ARRAY[
        'app.trip_fleet_links', 'public.assets', 'public.asset_assignments', 'public.drivers',
        'public.driver_assignments', 'public.vehicle_driver_assignments', 'public.carriers',
        'app.trip_statuses'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_ins ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_ins AFTER INSERT ON %s '
                       'REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_upd ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_upd AFTER UPDATE ON %s '
                       'REFERENCING NEW TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
        EXECUTE format('DROP TRIGGER IF EXISTS trg_marcar_cierre_del ON %s', tabla);
        EXECUTE format('CREATE TRIGGER trg_marcar_cierre_del AFTER DELETE ON %s '
                       'REFERENCING OLD TABLE AS cambiadas FOR EACH STATEMENT '
                       'EXECUTE FUNCTION app.marcar_cierre_pendiente()', tabla);
    END LOOP;
END $$;

-- Siembra: los días abiertos de la ventana y hoy arrancan encolados.
INSERT INTO app.closure_recompute_queue (business_date)
SELECT p.business_date FROM app.closure_periods p
WHERE p.status = 'OPEN' AND p.business_date BETWEEN public.hoy_chile() - 45 AND public.hoy_chile()
UNION
SELECT public.hoy_chile()
WHERE NOT EXISTS (SELECT 1 FROM app.closure_periods c WHERE c.business_date = public.hoy_chile() AND c.status = 'CLOSED')
ON CONFLICT (business_date) DO NOTHING;

COMMIT;
