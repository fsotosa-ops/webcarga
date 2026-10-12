-- Bloque 0 del Directorio, 0.1 (spec docs/superpowers/specs/2026-10-12-directory-block-0-design.md):
-- el inicio de una asignación es el día de Chile, no el de UTC. La base corre en
-- UTC: desde las 21:00 de Chile, CURRENT_DATE ya es mañana, y un traslado del
-- 11/10 a las 21:55 quedaba con fecha 12/10 (F-10).
--
-- Solo cambia el DEFAULT: es metadato, no reescribe la tabla ni toca filas
-- existentes (corregir las viejas va en D2). Cubre a todos los escritores que no
-- mandan start_date, incluido el INSERT de carriers.py:_transferir.
--
-- carrier_fleet_service_types no está: se borró en 20260803030000.
--
-- Re-ejecutable: los tests la corren dentro de su transacción revertida.

ALTER TABLE public.driver_assignments          ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.asset_assignments           ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.vehicle_driver_assignments  ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
ALTER TABLE public.carrier_shippers            ALTER COLUMN start_date SET DEFAULT public.hoy_chile();
