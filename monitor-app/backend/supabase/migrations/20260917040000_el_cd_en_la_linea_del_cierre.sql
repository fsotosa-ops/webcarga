-- La línea del cierre guarda su propio CD (HU-28, ola 3).
--
-- POR QUÉ EN LA LÍNEA Y NO POR JOIN AL LEER
-- Modelado dimensional clásico: un hecho lleva las claves de sus dimensiones
-- TAL COMO ESTABAN al momento del hecho. Si la asistencia por CD se resolviera
-- con un join a public.drivers en tiempo de lectura, cambiarle el CD base a un
-- conductor mañana le cambiaría las cifras a un día ya firmado — que es
-- exactamente el defecto que esta HU vino a arreglar
-- (status_report.py reescribía el pasado en cada viaje nuevo).
--
-- EL CONGELAMIENTO SALE GRATIS
-- No hace falta maquinaria nueva: `recalcular` ya es un no-op cuando el período
-- está CLOSED (services/cierre_lineas.py:254-257), así que una vez firmado el
-- día, esta columna deja de moverse sola.
--
-- SIN NOT NULL A PROPÓSITO
-- NULL significa "este conductor todavía no tiene CD base", que es un pendiente
-- accionable del directorio y se muestra como "Sin CD". No es un dato faltante
-- que haya que rellenar con algo.

BEGIN;

ALTER TABLE app.closure_lines
  ADD COLUMN IF NOT EXISTS home_location_id uuid REFERENCES public.locations(id);

COMMENT ON COLUMN app.closure_lines.home_location_id IS
  'CD base del sujeto ESE día, copiado al calcular la línea. Para DRIVER sale de '
  'public.drivers.home_location_id; para ASSET, del conductor habitual del tracto '
  '(public.vehicle_driver_assignments ACTIVE). Es la dimensión de la ASISTENCIA — el '
  'origen real del viaje es otra cosa y se lee de app.trip_stops. NULL = sin CD asignado.';

-- El corte por CD de un día: (business_date, home_location_id) es exactamente
-- como lo consultan el cierre y las secciones 2, 4 y 7 del reporte.
CREATE INDEX IF NOT EXISTS idx_closure_lines_home_location
  ON app.closure_lines (business_date, home_location_id)
  WHERE home_location_id IS NOT NULL;

COMMIT;
