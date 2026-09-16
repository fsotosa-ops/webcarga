-- Los vínculos manuales con la patente contradicha
--
-- Hasta el commit 9c30f7a9 (16/09), el formulario de flota mandaba el
-- tractor_asset_id del tracto habitual del conductor junto con la patente que
-- la persona había corregido a mano, y el endpoint guardaba los dos. Quedaron
-- vínculos que dicen una patente y apuntan a otro activo. El caso reportado es
-- el 2048292 de Lara: dice CVZP50, apunta a FWKL67, y las vueltas del día se
-- repartían entre dos tractos.
--
-- Misma regla que `_activo_de_la_patente`: la patente es lo que la persona vio
-- y escribió, así que el activo sale de ella. Sólo se tocan vínculos manuales
-- cuya patente SÍ existe en el directorio; si no existiera, no habría con qué
-- reemplazar y se dejaría como está. Al 16/09 eran 3.

UPDATE app.trip_fleet_links fl
SET tractor_asset_id = a.id, updated_at = now()
FROM public.assets a, public.assets actual
WHERE fl.link_source = 'manual'
  AND fl.tractor_plate IS NOT NULL
  AND actual.id = fl.tractor_asset_id
  AND upper(trim(a.license_plate)) = upper(trim(fl.tractor_plate))
  AND upper(trim(actual.license_plate)) <> upper(trim(fl.tractor_plate));
