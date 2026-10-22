-- Quién cuenta en el reporte del Cierre, una sola vez en la base (decisión del usuario, 22/10).
--
-- El roster de Tractoreo y la regla "qué línea entra al reporte" vivían en el SQL de los routers del Cierre
-- (services/driver_roster.py y el WHERE de daily_closures._DETAIL_SQL/_REPORT_SQL). La analítica (dbt,
-- gold.fct_fleet_daily_status) no puede importar Python y contaba todas las líneas: el 02/09 daba 49
-- conductores contra 41 de la Reportería. Mismo cuerpo, sin cambio de criterio:
--
--   app.tractoreo_roster(día): conductor ACTIVE asignado ese día a una empresa ACTIVE que ese día opera al
--     menos un tracto ACTIVE de tipo Tractoreo (minuta 2026-08-03; D2 14/10: asignaciones de ESE día).
--   app.closure_line_in_report(tipo, sujeto, día): una línea de conductor cuenta si estaba en el roster de
--     ese día, o desde el primer día firmado (Bloque 0, 0.4: la firma cuenta todas las líneas). Sin firmas,
--     ninguna línea fuera del roster cuenta. La regla es de conductores: la línea de un equipo siempre cuenta.

BEGIN;

CREATE OR REPLACE FUNCTION app.tractoreo_roster(p_day date)
 RETURNS TABLE (driver_id uuid, home_carrier_id uuid, home_location_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT DISTINCT d.id, da.counterpart_id, d.home_location_id
    FROM public.drivers d
    JOIN app.fleet_assignment_periods da ON da.relation = 'DRIVER_CARRIER' AND da.subject_id = d.id
         AND da.valid_during @> p_day AND d.operational_status = 'ACTIVE'
    JOIN public.carriers c ON c.id = da.counterpart_id AND c.operational_status = 'ACTIVE'
    JOIN app.fleet_assignment_periods aa ON aa.relation = 'ASSET_CARRIER' AND aa.counterpart_id = c.id
         AND aa.valid_during @> p_day
    JOIN public.assets a ON a.id = aa.subject_id AND a.operational_status = 'ACTIVE' AND public.is_power_unit(a.asset_type)
    JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id AND wot.code = 'TRACTOREO'
$function$;

CREATE OR REPLACE FUNCTION app.closure_line_in_report(p_subject_type text, p_subject_id uuid, p_business_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
    SELECT p_subject_type <> 'DRIVER'
        OR COALESCE(p_business_date >= (SELECT min(s.business_date) FROM app.closure_signatures s), false)
        OR EXISTS (SELECT 1 FROM app.tractoreo_roster(p_business_date) r WHERE r.driver_id = p_subject_id)
$function$;

REVOKE ALL ON FUNCTION app.tractoreo_roster(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.closure_line_in_report(text, uuid, date) FROM PUBLIC, anon, authenticated;

COMMIT;
