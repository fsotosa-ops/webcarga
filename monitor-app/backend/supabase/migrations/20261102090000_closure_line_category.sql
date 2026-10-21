-- La categoría de una línea del Cierre, en la base (diseño de Analítica, 21/10).
--
-- Vivía como un CASE en services/cierre_lineas.py (_CATEGORIA). La analítica (dbt, gold.fct_fleet_daily_status)
-- necesita la misma regla y un modelo de dbt no puede importar Python. Mismo cuerpo, sin cambios de criterio:
--   ASSIGNED → ASIGNADO; MISMATCH → POR_REGULARIZAR; sin motivo → SIN_RESOLVER;
--   motivo del grupo trabajando_sin_asignacion → TRABAJANDO_SIN_ASIGNACION; cualquier otro (o sin grupo) →
--   NO_TRABAJANDO. Qué significa un motivo vive en el catálogo (status_taxonomies.group_id, 20260917000000).

BEGIN;

CREATE OR REPLACE FUNCTION app.closure_line_category(p_status text, p_reason_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
    SELECT CASE
        WHEN p_status = 'ASSIGNED' THEN 'ASIGNADO'
        WHEN p_status = 'MISMATCH' THEN 'POR_REGULARIZAR'
        WHEN p_reason_id IS NULL THEN 'SIN_RESOLVER'
        WHEN (SELECT r.group_id FROM app.status_taxonomies r WHERE r.id = p_reason_id) = 'trabajando_sin_asignacion'
            THEN 'TRABAJANDO_SIN_ASIGNACION'
        ELSE 'NO_TRABAJANDO'
    END
$function$;

REVOKE ALL ON FUNCTION app.closure_line_category(text, uuid) FROM PUBLIC, anon, authenticated;

COMMIT;
