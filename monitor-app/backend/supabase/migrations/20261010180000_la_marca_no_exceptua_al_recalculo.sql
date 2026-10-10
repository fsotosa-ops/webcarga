-- La marca del Cierre ya no exceptúa lo que escribe el recálculo (revisión final, 10/10).
--
-- 20261010120000/150000 salían de la función si la transacción declaraba
-- app.origen_escritura = 'recalculo_cierre'. Era para que el recálculo no se
-- reencolara, pero dejaba desactualizados los OTROS días abiertos cuando el
-- pre-cierre corregía el directorio (todos dependen de él), y escondía la regla
-- en una variable de sesión. No hace falta: las correcciones convergen —la
-- pasada siguiente no encuentra nada que corregir y no escribe— y una sentencia
-- que no toca filas ya no marca.

BEGIN;

CREATE OR REPLACE FUNCTION app.marcar_cierre_pendiente()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'app', 'public', 'pg_catalog'
AS $$
BEGIN
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

COMMIT;
