-- La cola del Cierre pasa a ser de solo inserciones (corrige 20261010120000).
--
-- La primera versión hacía un upsert por día (`ON CONFLICT DO UPDATE SET
-- version = version + 1`). Reproducido el 10/10: dos ediciones de empresas
-- DISTINTAS se bloqueaban entre sí, porque las dos marcaban las mismas filas de
-- la cola y la segunda esperaba el bloqueo de la primera hasta que terminara. Con
-- los triggers activos, una corrida de dbt dejaba esperando a toda la app
-- mientras durara su transacción; y dos transacciones que tomaban las filas en
-- distinto orden se bloqueaban mutuamente (deadlock en la suite).
--
-- Ahora cada marca INSERTA una fila: un INSERT no espera a otro. El ejecutor lee
-- las marcas de cada día, recalcula, y borra EXACTAMENTE las que leyó (por id):
-- una marca que llega durante el cálculo sobrevive y se procesa en la corrida
-- siguiente. "Pendiente desde" es la marca más antigua del día.
--
-- La función conserva su nombre: los triggers de las tablas de la API y los del
-- post_hook de dbt la siguen llamando sin cambios.

BEGIN;

DROP TABLE app.closure_recompute_queue;

CREATE TABLE app.closure_recompute_queue (
    id            bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    business_date date        NOT NULL,
    requested_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX closure_recompute_queue_por_dia ON app.closure_recompute_queue (business_date);

-- Sin políticas: la usan la API y los triggers (rol postgres), nadie desde PostgREST.
ALTER TABLE app.closure_recompute_queue ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE app.closure_recompute_queue IS
    'Marcas de días del Cierre con cambios pendientes, una fila por marca (solo '
    'inserciones). La llenan los triggers trg_marcar_cierre_*; la vacía POST '
    '/api/v1/internal/closures/recompute, borrando por id las marcas que leyó.';

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

COMMENT ON FUNCTION app.marcar_cierre_pendiente() IS
    'Inserta una marca por cada día abierto de los últimos 45 días y hoy (Chile). '
    'La usan todos los trg_marcar_cierre_*; espera la tabla de transición "cambiadas".';

-- Siembra: los días abiertos de la ventana y hoy arrancan marcados.
INSERT INTO app.closure_recompute_queue (business_date)
SELECT p.business_date FROM app.closure_periods p
WHERE p.status = 'OPEN' AND p.business_date BETWEEN public.hoy_chile() - 45 AND public.hoy_chile()
UNION
SELECT public.hoy_chile()
WHERE NOT EXISTS (SELECT 1 FROM app.closure_periods c WHERE c.business_date = public.hoy_chile() AND c.status = 'CLOSED');

COMMIT;
