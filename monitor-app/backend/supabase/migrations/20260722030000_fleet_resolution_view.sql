-- Fase B (ítem 5, feedback post-weekly 2026-07-22): la cadena de
-- resolución driver/tracto/carrier (stored en trip_fleet_links → auto por
-- patente contra asset_assignments → auto por vehicle_driver_assignments →
-- match exacto de nombre contra el roster) estaba duplicada en 4 lugares
-- (_TRIP_FROM en trips.py, available_drivers, available_assets, y
-- daily_closures.py) — la duplicación fue la causa raíz de un bug real
-- (Ronda 38: daily_closures.py tenía la cadena completa de 3 niveles,
-- available_drivers/available_assets y _TRIP_FROM solo tenían 2, un
-- conductor con viaje resuelto en vivo podía seguir apareciendo como
-- "disponible"). Vista estándar de Postgres, no una tabla materializada —
-- confirmado con EXPLAIN que el planner la inlinea directo en la consulta
-- que la usa (mismo plan de ejecución que el SQL duplicado de hoy, mismos
-- índices existentes ya cubren cada join), así que consolidar acá no cuesta
-- performance y elimina el riesgo de que las 4 copias vuelvan a divergir.
--
-- Verificado contra datos reales (planning_date=2026-07-21, 46 viajes)
-- antes de aplicar: carrier_id/tractor_asset_id idénticos a la resolución
-- vieja (0 diffs), driver_id resuelve 21 casos más (0 regresiones) gracias
-- al 3er nivel que ya tenía daily_closures.py pero faltaba acá.
CREATE VIEW app.v_trip_fleet_resolution AS
SELECT
    t.id AS trip_id,
    COALESCE(fl.carrier_id, c_auto.id) AS resolved_carrier_id,
    COALESCE(fl.driver_id, vda_auto.driver_id, d_by_name.id) AS resolved_driver_id,
    COALESCE(fl.tractor_asset_id, ta_auto.id) AS resolved_tractor_asset_id,
    -- Empresa PROPIA del conductor resuelto (independiente de la empresa
    -- resuelta para el tracto) — permite detectar MISMATCH cuando conductor
    -- y tracto calzan cada uno por su lado pero bajo empresas distintas.
    da_home.carrier_id AS resolved_driver_home_carrier_id
FROM app.trips t
LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
LEFT JOIN public.assets ta_auto
    ON fl.tractor_asset_id IS NULL
   AND upper(trim(ta_auto.license_plate)) =
       upper(trim(COALESCE(NULLIF(t.fleet->>'tractor_plate', ''), t.fleet->>'trailer_plate')))
LEFT JOIN public.asset_assignments aa_auto ON aa_auto.asset_id = ta_auto.id AND aa_auto.status = 'ACTIVE'
LEFT JOIN public.carriers c_auto ON c_auto.id = aa_auto.carrier_id
LEFT JOIN public.vehicle_driver_assignments vda_auto ON vda_auto.asset_id = ta_auto.id AND vda_auto.status = 'ACTIVE'
LEFT JOIN public.drivers d_by_name
    ON fl.driver_id IS NULL AND vda_auto.driver_id IS NULL
   AND lower(trim(d_by_name.full_name)) = lower(trim(t.fleet->>'driver_name_tms'))
LEFT JOIN public.driver_assignments da_home
    ON da_home.driver_id = COALESCE(fl.driver_id, vda_auto.driver_id, d_by_name.id) AND da_home.status = 'ACTIVE';
