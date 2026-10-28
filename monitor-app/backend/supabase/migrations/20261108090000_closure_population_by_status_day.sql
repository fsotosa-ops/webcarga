-- La población del Cierre, con el estado de ESE día (plan 2026-10-28, "Empresas en onboarding en el Cierre").
--
-- Hasta acá el roster pedía `operational_status = 'ACTIVE'`, el estado de HOY. Ahora lo pide en
-- app.lifecycle_status_periods (20261107090000) para el día que se cierra. Así:
--   · una empresa que vuelve a onboarding o se da de baja hoy sale del Cierre desde hoy, sin tocar los
--     días anteriores en que sí operó;
--   · una activación que rige desde mañana no la mete en el Cierre de hoy.
--
-- app.closure_population(día) es el universo del día, una sola vez: los conductores del roster de
-- Tractoreo y los tractos de una empresa activa. El recálculo (services/cierre_lineas.recalcular_en) deja
-- exactamente esas líneas: lo que sale queda en audit_log ('closure_line_left_population') y se ve en
-- Pendientes, para que Operaciones lo revise.

BEGIN;

CREATE OR REPLACE FUNCTION app.tractoreo_roster(p_day date)
 RETURNS TABLE (driver_id uuid, home_carrier_id uuid, home_location_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT DISTINCT d.id, da.counterpart_id, d.home_location_id
    FROM public.drivers d
    JOIN app.lifecycle_status_periods sd ON sd.entity_type = 'DRIVER' AND sd.entity_id = d.id
         AND sd.valid_during @> p_day AND sd.status = 'ACTIVE'
    JOIN app.fleet_assignment_periods da ON da.relation = 'DRIVER_CARRIER' AND da.subject_id = d.id
         AND da.valid_during @> p_day
    JOIN app.lifecycle_status_periods sc ON sc.entity_type = 'CARRIER' AND sc.entity_id = da.counterpart_id
         AND sc.valid_during @> p_day AND sc.status = 'ACTIVE'
    JOIN app.fleet_assignment_periods aa ON aa.relation = 'ASSET_CARRIER' AND aa.counterpart_id = da.counterpart_id
         AND aa.valid_during @> p_day
    JOIN public.assets a ON a.id = aa.subject_id AND public.is_power_unit(a.asset_type)
    JOIN app.lifecycle_status_periods sa ON sa.entity_type = 'ASSET' AND sa.entity_id = a.id
         AND sa.valid_during @> p_day AND sa.status = 'ACTIVE'
    JOIN app.status_taxonomies wot ON wot.id = a.webcarga_operation_type_id AND wot.code = 'TRACTOREO'
$function$;

-- Los tractos del día: activos, de una empresa activa ese día (antes, en SQL_ESTADO_TRACTOS).
CREATE OR REPLACE FUNCTION app.closure_asset_population(p_day date)
 RETURNS TABLE (asset_id uuid, carrier_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT a.id, aa.counterpart_id
    FROM public.assets a
    JOIN app.lifecycle_status_periods sa ON sa.entity_type = 'ASSET' AND sa.entity_id = a.id
         AND sa.valid_during @> p_day AND sa.status = 'ACTIVE'
    JOIN app.fleet_assignment_periods aa ON aa.relation = 'ASSET_CARRIER' AND aa.subject_id = a.id
         AND aa.valid_during @> p_day
    JOIN app.lifecycle_status_periods sc ON sc.entity_type = 'CARRIER' AND sc.entity_id = aa.counterpart_id
         AND sc.valid_during @> p_day AND sc.status = 'ACTIVE'
    WHERE public.is_power_unit(a.asset_type)
$function$;

CREATE OR REPLACE FUNCTION app.closure_population(p_day date)
 RETURNS TABLE (subject_type text, subject_id uuid)
 LANGUAGE sql
 STABLE
AS $function$
    SELECT 'DRIVER', r.driver_id FROM app.tractoreo_roster(p_day) r
    UNION
    SELECT 'ASSET', p.asset_id FROM app.closure_asset_population(p_day) p
$function$;

-- El aviso de Pendientes lee lo que salió de un día.
CREATE INDEX IF NOT EXISTS audit_log_closure_line_left_population
    ON public.audit_log ((new_value ->> 'business_date'))
    WHERE action = 'closure_line_left_population';

REVOKE ALL ON FUNCTION app.closure_asset_population(date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app.closure_population(date) FROM PUBLIC, anon, authenticated;

COMMIT;
