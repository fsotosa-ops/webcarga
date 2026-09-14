-- El comentario del cierre deja de ser un pie de página del motivo
--
-- La migración 20260907200000 lo definió como "texto libre de quien cierra el
-- día. El motivo dice la categoría; esto dice el caso", y dejó escrita la
-- regla de que el recompute lo limpia al pasar a ASSIGNED, "porque un
-- comentario que explica por qué alguien no trabajó no puede sobrevivir al día
-- en que sí trabajó".
--
-- Medido el 14/09, una semana después: 0 comentarios guardados en las 4.540
-- filas de las dos tablas. La causa era la puerta, no el campo — el frontend
-- sólo dibujaba el input si la fila YA tenía motivo guardado, y eso son 287 de
-- 4.540 filas. En el 94% restante había un guion.
--
-- Decisión del usuario (14/09): se puede comentar CUALQUIER fila, con motivo o
-- sin él, con carga o sin ella. Eso le cambia el significado al campo: pasa de
-- ser un pie de página del motivo a ser una nota del día de esa fila. Y por lo
-- tanto deja de limpiarse en el recalculo — borrar por un recálculo algo que
-- una persona escribió a mano es perderlo.
--
-- El motivo, `resolved_by` y `resolved_at` SÍ se siguen limpiando al pasar a
-- ASSIGNED: esos son del motivo y no tienen sentido en una fila con carga.
-- Eso vive en el ON CONFLICT de los routers, no acá.
--
-- Esta migración no cambia datos ni estructura: sólo corrige los COMMENT, que
-- si no quedarían afirmando una regla que el código ya no cumple.

COMMENT ON COLUMN app.driver_day_status.comentario IS
    'Nota de texto libre de quien cierra el día, sobre esta fila y este día. '
    'Se puede escribir con motivo o sin él, y con carga o sin ella. '
    'El recalculo NO la borra: la escribió una persona.';

COMMENT ON COLUMN app.equipment_day_status.comentario IS
    'Nota de texto libre de quien cierra el día, sobre esta fila y este día. '
    'Se puede escribir con motivo o sin él, y con carga o sin ella. '
    'El recalculo NO la borra: la escribió una persona.';
