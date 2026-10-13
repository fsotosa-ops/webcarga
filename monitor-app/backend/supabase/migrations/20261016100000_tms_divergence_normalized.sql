-- Divergencia TMS: comparar valores normalizados, no texto crudo (encargo
-- 2026-10-12-tms-divergence-system-note, seguimiento aprobado por el usuario).
--
-- 20261016090000 comparaba el texto tal cual, como lo hacía el código Python:
-- de 248 viajes con vínculo manual que "divergían", 192 eran el mismo nombre
-- escrito distinto. Ahora:
--   conductor: public.name_tokens(TMS) distinto de public.name_tokens(vinculado)
--              (la misma normalización que usa el matcher de app.resolve_trip_fleet)
--   patente:   public.canonical_plate en ambos lados; si alguno no tiene forma
--              de patente, upper(btrim()) de ambos.
-- El texto de la nota, la deduplicación y la regla de solo vínculo manual no
-- cambian. Las notas existentes no se tocan.
--
-- Solo CREATE OR REPLACE FUNCTION. Re-ejecutable, sin BEGIN/COMMIT.

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
        compared AS (
            -- Nombre: mismo conjunto de palabras (public.name_tokens, la
            -- normalización del matcher: sin orden, mayúsculas, tildes ni
            -- espacios de más). Patente: public.canonical_plate; si alguno de
            -- los dos lados no tiene forma de patente, upper(btrim()).
            SELECT r.*,
                   r.tms_driver IS NOT NULL
                   AND public.name_tokens(r.tms_driver) IS DISTINCT FROM public.name_tokens(r.linked_driver)
                       AS driver_differs,
                   r.tms_plate IS NOT NULL
                   AND CASE WHEN public.canonical_plate(r.tms_plate) IS NOT NULL
                             AND public.canonical_plate(r.linked_plate) IS NOT NULL
                            THEN public.canonical_plate(r.tms_plate) <> public.canonical_plate(r.linked_plate)
                            ELSE upper(btrim(r.tms_plate)) IS DISTINCT FROM upper(btrim(r.linked_plate))
                       END AS plate_differs
            FROM reported r
        ),
        divergent AS (
            -- El texto cita el valor crudo del TMS, como siempre.
            SELECT c.trip_id,
                   'Divergencia TMS: ' || concat_ws(', ',
                       CASE WHEN c.driver_differs THEN 'conductor reportado por TMS: ' || c.tms_driver END,
                       CASE WHEN c.plate_differs  THEN 'patente reportado por TMS: '   || c.tms_plate  END) AS body
            FROM compared c
            WHERE c.driver_differs OR c.plate_differs
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
