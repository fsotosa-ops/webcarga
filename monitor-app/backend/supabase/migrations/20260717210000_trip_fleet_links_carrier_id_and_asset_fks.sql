-- Fase 1.5: hardening estructural real de app.trip_fleet_links.
-- Hasta ahora carrier_id/driver_id no tenían FK real (solo PK/UNIQUE/CHECK)
-- y el vehículo se guardaba como texto libre (tractor_plate/trailer_plate),
-- sin vínculo a public.assets pese a que ese modelo ya existe en Empresas.
-- Verificado antes de aplicar: 609 links, 1 huérfano (Agro Mist Spa, no
-- onboardeada), driver_id 0/609, tractor_plate 606/609 (99.5%) matchea por
-- patente contra public.assets.license_plate, trailer_plate 1/609 (matchea).

-- 1. Limpiar el único carrier_id huérfano antes del FK
UPDATE app.trip_fleet_links SET transporter_id = NULL
WHERE transporter_id IS NOT NULL AND transporter_id NOT IN (SELECT id FROM public.carriers);

-- 2. Rename (absorbe el ítem de higienización transporter_id→carrier_id)
ALTER TABLE app.trip_fleet_links RENAME COLUMN transporter_id TO carrier_id;

-- 3. Columnas nuevas para vehículos reales
ALTER TABLE app.trip_fleet_links ADD COLUMN tractor_asset_id uuid;
ALTER TABLE app.trip_fleet_links ADD COLUMN trailer_asset_id uuid;

-- 4. Bootstrap una sola vez, vía match de patente (mismo patrón que carrier_id/RUT en Fase 1)
UPDATE app.trip_fleet_links fl SET tractor_asset_id = a.id
FROM public.assets a
WHERE fl.tractor_plate IS NOT NULL
  AND upper(replace(fl.tractor_plate,' ','')) = upper(replace(a.license_plate,' ',''));

UPDATE app.trip_fleet_links fl SET trailer_asset_id = a.id
FROM public.assets a
WHERE fl.trailer_plate IS NOT NULL
  AND upper(replace(fl.trailer_plate,' ','')) = upper(replace(a.license_plate,' ',''));

-- 5. FK reales (ahora seguro, sin filas huérfanas)
ALTER TABLE app.trip_fleet_links
  ADD CONSTRAINT trip_fleet_links_carrier_id_fkey FOREIGN KEY (carrier_id) REFERENCES public.carriers(id),
  ADD CONSTRAINT trip_fleet_links_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id),
  ADD CONSTRAINT trip_fleet_links_tractor_asset_id_fkey FOREIGN KEY (tractor_asset_id) REFERENCES public.assets(id),
  ADD CONSTRAINT trip_fleet_links_trailer_asset_id_fkey FOREIGN KEY (trailer_asset_id) REFERENCES public.assets(id);
