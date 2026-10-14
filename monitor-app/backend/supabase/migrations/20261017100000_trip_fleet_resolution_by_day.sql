-- D2 (Entrega A, criterio A10): el MISMATCH del Monitor juzga con la empresa del día
-- del viaje, no con la de hoy, y mira también el tracto.
--
-- Hasta acá resolved_driver_home_carrier_id salía de la asignación ACTIVE de hoy: al
-- transferir a un conductor, todos sus viajes anteriores pasaban a MISMATCH. Ahora sale
-- de app.fleet_assignment_periods en t.planning_date (sin fecha, hoy). La columna nueva va al final
-- (CREATE OR REPLACE VIEW solo admite agregar columnas al final).
CREATE OR REPLACE VIEW app.v_trip_fleet_resolution AS
SELECT t.id AS trip_id,
       fl.carrier_id AS resolved_carrier_id,
       fl.driver_id AS resolved_driver_id,
       fl.tractor_asset_id AS resolved_tractor_asset_id,
       dp.counterpart_id AS resolved_driver_home_carrier_id,
       fl.link_source,
       fl.driver_match_rule,
       fl.resolved_at,
       ap.counterpart_id AS resolved_tractor_home_carrier_id
FROM app.trips t
LEFT JOIN app.trip_fleet_links fl ON fl.trip_id = t.id
LEFT JOIN app.fleet_assignment_periods dp
       ON dp.relation = 'DRIVER_CARRIER' AND dp.subject_id = fl.driver_id
      AND dp.valid_during @> COALESCE(t.planning_date, public.hoy_chile())
LEFT JOIN app.fleet_assignment_periods ap
       ON ap.relation = 'ASSET_CARRIER' AND ap.subject_id = fl.tractor_asset_id
      AND ap.valid_during @> COALESCE(t.planning_date, public.hoy_chile());

COMMENT ON VIEW app.v_trip_fleet_resolution IS
  'Resolución de flota por viaje (app.trip_fleet_links) más la empresa que el conductor y el tracto '
  'tenían el día del viaje (app.fleet_assignment_periods). D2, 14/10.';
