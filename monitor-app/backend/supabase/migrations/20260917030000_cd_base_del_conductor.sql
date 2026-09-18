-- El CD base del conductor (HU-28, docs/user-stories/20260917/01-hu-asistencia-y-cierre-por-cd.md).
--
-- QUÉ ES, Y QUÉ NO ES
-- Es el "home terminal" del estándar del rubro (Samsara, Motive, McLeod,
-- Trimble/TMW; en EE.UU. la FMCSA lo exige para anclar los registros de
-- jornada): dato maestro DECLARADO de la persona, no una derivación.
--
-- NO reemplaza ni contradice al TMS. El origen real de cada viaje sigue
-- viviendo, intocado, en app.trip_stops.local. Este campo responde otra
-- pregunta: de qué CD es la asistencia de este conductor el día que NO hizo
-- ningún viaje — el día en que el TMS, por definición, no dice nada.
--
-- POR QUÉ NO SE DERIVA DEL HISTORIAL
-- Medido el 2026-09-17: el 35% de los conductores de Walmart cargan en más de
-- un CD, y su CD dominante concentra el 90,5% de sus viajes. Calcularlo
-- parecería robusto y no lo es: cambiaría solo cuando alguien cubre otro CD dos
-- semanas, y con él cambiaría la asistencia de meses ya firmados. Eso
-- contradice la decisión del modelo de cierre del 16/09 — un día firmado no se
-- recalcula. La varianza entre el CD base y el origen real es información que
-- el reporte muestra, no ruido que haya que promediar.
--
-- POR QUÉ NO LLEVA VIGENCIA PROPIA
-- Medido: las 4 tablas de asignación de este repo (driver_assignments,
-- asset_assignments, vehicle_driver_assignments, carrier_shippers) tienen
-- `end_date` poblado en 0 de 402 filas. La vigencia ya está declarada cuatro
-- veces y no se usa ninguna. Agregar una quinta sería declararla cinco veces.
-- La historia vive donde ya vive: en public.audit_log (lo escribe
-- record_manual_edit) y, congelada, en la línea del cierre de cada día.

BEGIN;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS home_location_id uuid REFERENCES public.locations(id);

COMMENT ON COLUMN public.drivers.home_location_id IS
  'CD base del conductor ("home terminal"). Dato maestro declarado por Operaciones, '
  'NO derivado de los viajes. Es la dimensión por la que se agrupa la ASISTENCIA; el '
  'origen real de cada viaje (app.trip_stops) es otra cosa y va por separado. '
  'NULL = todavía no se le asignó, que es un pendiente accionable del directorio.';

CREATE INDEX IF NOT EXISTS idx_drivers_home_location
  ON public.drivers (home_location_id) WHERE home_location_id IS NOT NULL;

-- Una FK sola no alcanza: dice que apunta a UNA ubicación, no que apunte a un
-- CD de origen activo. Sin esto, un selector mal armado deja asignado un local
-- de entrega como CD base y el error aparece semanas después, en el reporte.
-- Mismo recurso y mismo motivo que app.closure_lines_valida_sujeto()
-- (20260916235000_modelo_de_cierre_periodos_y_lineas.sql:76-100).
CREATE OR REPLACE FUNCTION public.drivers_home_location_es_un_cd()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ok boolean;
BEGIN
    IF NEW.home_location_id IS NULL THEN
        RETURN NEW;
    END IF;
    SELECT l.is_origin_cd AND l.operational_status = 'ACTIVE'
      INTO ok
      FROM public.locations l
     WHERE l.id = NEW.home_location_id;

    IF NOT COALESCE(ok, false) THEN
        RAISE EXCEPTION
            'El CD base tiene que ser un centro de distribución de origen activo (locations.is_origin_cd)'
            USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS drivers_home_location_es_un_cd ON public.drivers;
CREATE TRIGGER drivers_home_location_es_un_cd
    BEFORE INSERT OR UPDATE OF home_location_id ON public.drivers
    FOR EACH ROW EXECUTE FUNCTION public.drivers_home_location_es_un_cd();

COMMIT;
