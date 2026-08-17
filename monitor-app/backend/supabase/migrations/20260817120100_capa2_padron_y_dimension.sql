-- ============================================================================
-- Capa 2 · DIMENSION — quién maneja qué, con vigencia y procedencia
-- ============================================================================
-- Spec: docs/superpowers/specs/2026-08-17-modelo-resolucion-flota-design.md
--
-- POR QUE ES UNA TABLA Y NO UNA VISTA. `public.vehicle_driver_assignments` no
-- puede derivarse, por tres razones que no son de gusto:
--   1. Guarda CORRECCIONES HUMANAS (is_manual_override). Ese dato no existe en
--      ninguna fuente: nace ahi.
--   2. Tiene VIGENCIA (start_date/end_date/status). Una derivacion sobre
--      bronze solo puede mostrar "el ultimo" y pierde la historia — justo lo
--      que un cierre necesita conservar.
--   3. El padron la SIEMBRA, pero operaciones la POSEE.
--
-- El padron, en cambio, si es derivacion pura: vive en `silver` porque es una
-- conformacion de bronze, siguiendo la arquitectura medallion que el proyecto
-- ya usa (int_tms_trips_conformed, stg_qanalytics_trips).
--
--     bronze (crudo) -> silver (conformado) -> public (maestro) -> app (operacion)
--
-- ⚠ DEUDA: esta vista deberia ser un modelo dbt en el proyecto de Mage, como
--   el resto de silver. Se crea por migracion porque el push a Mage lo bloquea
--   el clasificador de permisos. Migrar cuando se destrabe.

BEGIN;

CREATE OR REPLACE VIEW silver.int_habitual_driver_by_tractor AS
WITH dispatches AS (
    SELECT public.canonical_plate(o.patente_camion) AS plate,
           public.canonical_rut(o.rut_chofer)       AS tax_id,
           btrim(o.chofer)                          AS driver_name_raw,
           CASE WHEN btrim(o.f_despacho) ~ '^\d{4}-\d{2}-\d{2}'
                THEN to_timestamp(btrim(o.f_despacho), 'YYYY-MM-DD HH24:MI:SS')::date
           END                                      AS dispatched_on
    FROM bronze.raw_bd_ot o
),
valid AS (
    -- Las tres condiciones son la misma idea: si no se puede identificar al
    -- tracto, a la persona, o cuando fue, la fila no sirve como evidencia.
    SELECT * FROM dispatches
    WHERE plate IS NOT NULL AND tax_id IS NOT NULL AND dispatched_on IS NOT NULL
),
-- bronze.raw_bd_ot es append-only por hash de fila y ADEMAS tiene 3.477 filas
-- duplicadas: el `WHERE NOT EXISTS` de bd_ot_master.sql compara contra el
-- destino pero no dentro del propio lote, asi que dos filas identicas en una
-- misma carga entran las dos. Sin este DISTINCT un conductor pesaria mas por
-- haberse recargado, no por haber manejado mas.
deduped AS (
    SELECT DISTINCT plate, tax_id, driver_name_raw, dispatched_on FROM valid
),
ranked AS (
    SELECT plate, tax_id, max(driver_name_raw) AS driver_name_raw,
           max(dispatched_on) AS last_dispatched_on, count(*) AS dispatches
    FROM deduped GROUP BY plate, tax_id
)
SELECT DISTINCT ON (plate)
    plate, tax_id, driver_name_raw, last_dispatched_on, dispatches
FROM ranked
-- El desempate es deliberado: manda QUIEN LO MANEJO MAS RECIENTEMENTE, y
-- recien despues quien lo manejo mas veces. Un conductor que hizo 200 viajes
-- hasta marzo no es el habitual de un tracto que otro maneja desde junio.
ORDER BY plate, last_dispatched_on DESC, dispatches DESC, tax_id;

COMMENT ON VIEW silver.int_habitual_driver_by_tractor IS
    'Conductor habitual por tracto, conformado desde bronze.raw_bd_ot. Es una '
    'INFERENCIA: quien la consuma DEBE cortar por last_dispatched_on — '
    'evidencia < 3 meses acierta 94,2%, entre 3 y 6 meses acierta 4,0%.';

-- ── Procedencia en la dimension ─────────────────────────────────────────────
-- `start_date` dice cuando ESCRIBIMOS la fila; `source_confirmed_at` dice de
-- cuando es la EVIDENCIA. Una fila sembrada hoy con evidencia de mayo se ve
-- nueva por la primera y vieja por la segunda — y la que importa es la
-- segunda. Sin esta columna el envejecimiento del padron es invisible.
ALTER TABLE public.vehicle_driver_assignments
    ADD COLUMN IF NOT EXISTS source              text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_confirmed_at date;

COMMENT ON COLUMN public.vehicle_driver_assignments.source IS
    'Quien afirma la asignacion: manual | padron_legacy | tms.';
COMMENT ON COLUMN public.vehicle_driver_assignments.source_confirmed_at IS
    'Fecha de la EVIDENCIA que la respalda, no de la escritura.';

ALTER TABLE public.vehicle_driver_assignments DROP CONSTRAINT IF EXISTS vda_source_check;
ALTER TABLE public.vehicle_driver_assignments
    ADD CONSTRAINT vda_source_check CHECK (source IN ('manual','padron_legacy','tms'));

-- La redundancia con is_manual_override se vuelve SEGURA haciendola
-- verificable, en vez de confiar en la disciplina. Se conserva el booleano
-- porque es convencion del proyecto (assets, drivers) y hay codigo que lo lee:
-- romperla en una sola tabla es peor que la redundancia.
ALTER TABLE public.vehicle_driver_assignments DROP CONSTRAINT IF EXISTS vda_source_coherente;
ALTER TABLE public.vehicle_driver_assignments DROP CONSTRAINT IF EXISTS vda_source_matches_manual_flag;
ALTER TABLE public.vehicle_driver_assignments
    ADD CONSTRAINT vda_source_matches_manual_flag
    CHECK (is_manual_override = (source = 'manual'));

-- ── La siembra ──────────────────────────────────────────────────────────────
-- DELIBERADA, no automatica: depende de que Mage recargue un Excel que se esta
-- muriendo, y un trigger sobre bronze pondria logica de negocio en la capa
-- cruda e invertiria el flujo. El RESOLVEDOR (capa 3) si es automatico.
CREATE OR REPLACE FUNCTION public.sync_habitual_drivers(freshness_days int DEFAULT 90)
RETURNS TABLE (opened int, closed int, missing_asset int, missing_driver int, skipped_as_stale int)
LANGUAGE plpgsql
SET search_path TO 'public', 'silver', 'pg_catalog'
AS $fn$
DECLARE v_opened int := 0; v_closed int := 0;
BEGIN
    -- ON COMMIT DROP limpia al CONFIRMAR la transaccion, no al terminar la
    -- funcion: sin este DROP, llamarla dos veces en la misma transaccion
    -- —que es lo que hace el test de idempotencia— revienta.
    DROP TABLE IF EXISTS resolved_registry;
    CREATE TEMP TABLE resolved_registry ON COMMIT DROP AS
    SELECT p.plate, p.tax_id, p.last_dispatched_on,
           a.id AS asset_id, d.id AS driver_id
    FROM silver.int_habitual_driver_by_tractor p
    LEFT JOIN public.assets  a ON a.license_plate = p.plate
    LEFT JOIN public.drivers d ON d.tax_id        = p.tax_id
    -- EL CORTE DE FRESCURA, que es la decision de diseno mas importante de
    -- esta capa. Medido contra julio: evidencia de menos de 3 meses acierta
    -- 94,2% (673 casos); de 3 a 6 meses acierta 4,0% (25 casos). Una entrada
    -- vieja no agrega una conjetura peor, agrega un nombre casi seguro
    -- equivocado — y en el Cierre un nombre plausible se confirma solo. La
    -- celda vacia HACE LA PREGUNTA; la celda mal llenada la esconde.
    WHERE p.last_dispatched_on >= current_date - freshness_days;

    -- 1. Cerrar lo automatico desactualizado. `NOT is_manual_override` es la
    --    regla que sostiene el diseno: quien corrigio a mano sabe algo que la
    --    inferencia no.
    WITH closing AS (
        UPDATE public.vehicle_driver_assignments v
        SET status = 'INACTIVE', end_date = CURRENT_DATE
        FROM resolved_registry p
        WHERE v.asset_id = p.asset_id AND v.status = 'ACTIVE'
          AND NOT v.is_manual_override
          AND p.driver_id IS NOT NULL AND v.driver_id IS DISTINCT FROM p.driver_id
        RETURNING 1
    ) SELECT count(*) INTO v_closed FROM closing;

    -- 2. Abrir la vigente. ON CONFLICT reactiva un par que ya existia
    --    inactivo: un conductor que volvio al mismo tracto no necesita fila
    --    nueva.
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
$fn$;

COMMENT ON FUNCTION public.sync_habitual_drivers(int) IS
    'Siembra public.vehicle_driver_assignments desde '
    'silver.int_habitual_driver_by_tractor. DELIBERADA, no automatica. '
    'Idempotente. NUNCA pisa is_manual_override = true.';

COMMIT;

-- Primera corrida, 2026-08-17: opened=46, closed=0, missing_asset=3,
-- missing_driver=10, skipped_as_stale=419.
-- SELECT * FROM public.sync_habitual_drivers(90);
