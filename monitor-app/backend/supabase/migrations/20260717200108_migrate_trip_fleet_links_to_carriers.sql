-- Repunta app.trip_fleet_links.transporter_id de la tabla legacy congelada
-- app.transporter_profiles hacia public.carriers (modelo vigente de
-- Empresas/Seguros). Sin FK real en trip_fleet_links.transporter_id (soft
-- reference), así que esto es puramente una migración de datos, no un
-- cambio de schema. Verificado antes de aplicar: 26 de 27 empresas
-- vinculadas matchean limpio por RUT/tax_id; la que no matchea
-- ("Agro Mist Spa", 77448678-K) no está onboardeada en Empresas todavía —
-- queda apuntando a un id que ya no resuelve tras repuntar el JOIN en la
-- API (routers/trips.py), degradando a transporter: null, sin error.
UPDATE app.trip_fleet_links fl
SET transporter_id = c.id, updated_at = now()
FROM app.transporter_profiles tp
JOIN public.carriers c ON c.tax_id = tp.rut
WHERE fl.transporter_id = tp.id;
