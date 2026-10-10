-- Motivos de anulación de catálogo (spec 2026-10-10 motivos de anulación, §2). EXPAND.
--
-- El motivo deja de ser texto libre: se elige de TRIP_VOID_REASON (mismo catálogo que
-- TRIP_UNASSIGNED_REASON, dominio aparte: anular corrige un registro, no es un resultado
-- de negocio). void_reason_id + void_note reemplazan a void_reason en tres fases:
-- este expand (columnas nuevas, carga, CHECK de transición), el despliegue de la API que
-- ya no lee void_reason, y el contract (20261011010000) que la retira. El modelo dbt
-- `trips` se actualiza en Mage en la MISMA ventana (sync_all_columns).

BEGIN;

-- La base es la que decide qué vocabularios existen (status_taxonomies_domain_check).
ALTER TABLE app.status_taxonomies DROP CONSTRAINT status_taxonomies_domain_check;
ALTER TABLE app.status_taxonomies ADD CONSTRAINT status_taxonomies_domain_check CHECK (domain = ANY (ARRAY[
    'OPERATIONAL_STATE', 'DRIVER_REASON', 'EQUIPMENT_STATE', 'FLEET_SERVICE_TYPE',
    'WEBCARGA_OPERATION_TYPE', 'TRIP_UNASSIGNED_REASON', 'TRIP_VOID_REASON']));

INSERT INTO app.status_taxonomies (domain, code, label, bg_color, text_color, sort_order, active)
VALUES
    ('TRIP_VOID_REASON', 'DUPLICADO',         'Duplicado',                               '#f3f4f6', '#374151', 1, true),
    ('TRIP_VOID_REASON', 'CARGADO_POR_ERROR', 'Cargado por error',                       '#f3f4f6', '#374151', 2, true),
    ('TRIP_VOID_REASON', 'DATOS_INCORRECTOS', 'Datos incorrectos (se registró de nuevo)', '#f3f4f6', '#374151', 3, true),
    ('TRIP_VOID_REASON', 'OTRO',              'Otro',                                    '#f3f4f6', '#374151', 4, true);

ALTER TABLE app.trips_manual
    ADD COLUMN void_reason_id uuid REFERENCES app.status_taxonomies (id),
    ADD COLUMN void_note text;
-- Sin FK en app.trips: el --full-refresh de dbt la recrea y borra las FK.
ALTER TABLE app.trips
    ADD COLUMN void_reason_id uuid,
    ADD COLUMN void_note text;

-- Los anulados existentes (los 6 duplicados del 23/09) pasan a DUPLICADO.
DO $$
DECLARE
    otros int;
BEGIN
    SELECT count(*) INTO otros FROM app.trips_manual
    WHERE voided_at IS NOT NULL AND void_reason IS DISTINCT FROM 'Duplicado';
    IF otros > 0 THEN
        RAISE EXCEPTION 'Hay % anulados con un motivo distinto de "Duplicado": mapearlos a mano', otros;
    END IF;
END $$;

UPDATE app.trips_manual SET void_reason_id = r.id
FROM app.status_taxonomies r
WHERE r.domain = 'TRIP_VOID_REASON' AND r.code = 'DUPLICADO' AND app.trips_manual.voided_at IS NOT NULL;

UPDATE app.trips SET void_reason_id = r.id
FROM app.status_taxonomies r
WHERE r.domain = 'TRIP_VOID_REASON' AND r.code = 'DUPLICADO' AND app.trips.voided_at IS NOT NULL;

-- CHECK de transición: mientras la API vieja siga desplegada escribe void_reason sin
-- void_reason_id. El contract deja el definitivo.
ALTER TABLE app.trips_manual DROP CONSTRAINT ck_trips_manual_void_complete;
ALTER TABLE app.trips_manual ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NOT NULL OR (void_reason IS NULL AND void_reason_id IS NULL AND void_note IS NULL))
    AND (voided_at IS NULL OR void_reason IS NOT NULL OR void_reason_id IS NOT NULL));
ALTER TABLE app.trips DROP CONSTRAINT ck_trips_void_complete;
ALTER TABLE app.trips ADD CONSTRAINT ck_trips_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NOT NULL OR (void_reason IS NULL AND void_reason_id IS NULL AND void_note IS NULL))
    AND (voided_at IS NULL OR void_reason IS NOT NULL OR void_reason_id IS NOT NULL));

COMMIT;
