-- El comentario de texto libre del cierre, por fila
--
-- Hasta ahora una fila del cierre sólo podía decir UNO de trece motivos. El
-- motivo dice la categoría —"Panne"— y no dice el caso: cuál panne, desde
-- cuándo, qué se hizo. Pedido del usuario (07/09): quien cierra el día tiene
-- que poder escribirlo con sus palabras, ahí mismo donde toma la decisión.
--
-- Va en las DOS tablas del cierre porque son dos ejes que se firman por
-- separado —conductores y tractos— y cada uno se resuelve en su propia fila.
--
-- Nullable y sin default: el comentario es opcional. Un texto vacío y un
-- comentario ausente son lo mismo y se guarda NULL para los dos, así que no
-- hay dos maneras de decir "no escribió nada".
--
-- El recompute NO lo pisa: igual que `unassigned_reason_id`, se conserva
-- mientras la fila siga UNASSIGNED y se limpia cuando pasa a ASSIGNED — un
-- comentario que explica por qué alguien no trabajó no puede sobrevivir al día
-- en que sí trabajó. Eso vive en el ON CONFLICT de los routers, no acá.

ALTER TABLE app.driver_day_status
    ADD COLUMN IF NOT EXISTS comentario text;

ALTER TABLE app.equipment_day_status
    ADD COLUMN IF NOT EXISTS comentario text;

COMMENT ON COLUMN app.driver_day_status.comentario IS
    'Texto libre de quien cierra el día. El motivo dice la categoría; esto dice el caso.';
COMMENT ON COLUMN app.equipment_day_status.comentario IS
    'Texto libre de quien cierra el día. El motivo dice la categoría; esto dice el caso.';
