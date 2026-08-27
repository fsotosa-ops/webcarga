-- Los tres motivos que la migración anterior dejó fuera, ahora sembrados
--
-- La migración `20260827130000` sembró 10 de los 13 motivos del documento de
-- bugs del 27/08 y dejó tres afuera con un argumento: duplican a otros que ya
-- existían ("No disponible" contra "Conductor no disponible", "Sin equipo
-- disponible" contra "No tenemos camión", "Sin precio de transporte para esta
-- ruta" contra "No da por tarifa").
--
-- **El usuario confirmó que van los del documento, los trece.** Queda dicho el
-- argumento y queda dicha la decisión, que es de negocio y no técnica: quien
-- opera el cierre sabe si "sin equipo disponible" y "no tenemos camión"
-- significan lo mismo en la conversación real con el mandante.
--
-- Lo que sí conviene mirar después: con los dos de cada par activos, la misma
-- situación se puede cargar con dos etiquetas distintas y la estadística queda
-- partida al medio. Si se confirma que son sinónimos, la salida limpia es
-- apagar el viejo (`active = false`), que lo saca de los desplegables y
-- conserva la FK de todo lo ya cargado — nunca borrarlo.

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order)
VALUES
    ('DRIVER_REASON', 'NO_DISPONIBLE', 'No disponible', '#f3f4f6', '#374151', 21),
    ('TRIP_UNASSIGNED_REASON', 'SIN_EQUIPO_DISPONIBLE', 'Sin equipo disponible',            '#fef9c3', '#854d0e', 11),
    ('TRIP_UNASSIGNED_REASON', 'SIN_PRECIO_RUTA',       'Sin precio de transporte para esta ruta', '#fef2f2', '#b91c1c', 12)
ON CONFLICT (domain, code) WHERE code IS NOT NULL
DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, active = true;
