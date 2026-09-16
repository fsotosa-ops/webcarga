-- Qué significa cada motivo de conductor: trabajó sin asignación, o no trabajó
--
-- Solicitud de Cambios Diario 2.0 (16/09): "Esperando carga, Camino al CD,
-- Disponible para cargar, Se retira sin carga — quienes deben quedar en SÍ
-- trabajando, NO asignados. Acciones informadas no deben pasar a No
-- trabajando". Y: "Los retirados sin carga tienen que quedar trabajando sin
-- asignación. Actualmente quedan No trabajando".
--
-- La causa: el significado de un motivo estaba escrito en el frontend
-- (FlotaDelDiaSection.tsx) como "tiene motivo = no trabajó". Los cuatro
-- motivos ya existían en el catálogo desde el 14/09 y no tenían efecto.
--
-- Pasa a vivir en el catálogo, en `group_id`, la misma columna con la que
-- OPERATIONAL_STATE ya agrupa sus valores y que Configuración ya sabe editar:
--   trabajando_sin_asignacion  → el conductor trabajó y no tuvo carga
--   no_trabajando              → el conductor no trabajó
-- Un motivo sin grupo se lee como no_trabajando, que es lo que hacía la
-- pantalla hasta hoy: nada cambia para los que Operaciones no revise.
--
-- Es una PROPUESTA sembrada; Operaciones la valida desde Configuración ›
-- Motivos de conductor, sin deploy. Casos a revisar con ellos: Conductor backup
-- y Adelanto de ruta quedan en no_trabajando.
--
-- Además: 'Sin conductor' gana `code`. Es el motivo que se escribe solo en el
-- tracto cuando su conductor habitual no trabajó, y buscarlo por etiqueta se
-- rompería el día que alguien lo renombre.

UPDATE app.status_taxonomies
SET group_id = CASE
        WHEN label IN ('Esperando carga', 'Camino al CD', 'Disponible para cargar',
                       'Se retira sin carga', 'Se retiró sin carga', 'Sin carga disponible')
            THEN 'trabajando_sin_asignacion'
        ELSE 'no_trabajando'
    END,
    updated_at = now()
WHERE domain = 'DRIVER_REASON';

UPDATE app.status_taxonomies
SET code = 'SIN_CONDUCTOR', updated_at = now()
WHERE domain = 'DRIVER_REASON' AND label = 'Sin conductor' AND code IS NULL;
