-- El tracto hereda el motivo de su conductor habitual
--
-- Solicitud de Cambios Diario 2.0, punto 5 (llamada con Fabián, 01/10): al
-- poner un motivo al conductor, Operaciones tenía que repetirlo en Tractos ·
-- Tractoreo. Medido del 18/09 al 01/10: 108 veces escribió a mano en el tracto
-- EL MISMO motivo del conductor (87 "no trabajó", 21 "trabajando sin
-- asignación"); la propagación que existía escribía "Sin conductor" y sólo
-- para el primer grupo.
--
-- `reason_from_driver_id` es la PROCEDENCIA del motivo del tracto: no nulo =
-- lo heredó de ese conductor, y sigue sus cambios; nulo = lo escribió una
-- persona (o no hay motivo), y nada automático lo pisa. Sin esta columna no
-- se puede seguir al conductor sin pisar a una persona.

ALTER TABLE app.closure_lines
    ADD COLUMN IF NOT EXISTS reason_from_driver_id uuid REFERENCES public.drivers(id);

COMMENT ON COLUMN app.closure_lines.reason_from_driver_id IS
    'Sólo en líneas ASSET: el conductor habitual del que se heredó el motivo. '
    'NULL = motivo escrito por una persona, o sin motivo. Lo escribe sólo services/cierre_lineas.py.';

-- Sin backfill a propósito: los "Sin conductor" que propagó la regla vieja
-- quedan como motivo escrito (NULL), que es un estado válido. Reconocerlos
-- exigía adivinar por cercanía de horas. Todo lo que se escriba desde el
-- despliegue sale de la regla nueva.
