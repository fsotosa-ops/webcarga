-- Motivos de anulación: CONTRACT (spec 2026-10-10 motivos de anulación, §2.1).
-- La API desplegada ya no lee ni escribe void_reason. Se retira y el CHECK queda
-- definitivo: anulado ⇔ quién y motivo de catálogo; el comentario es opcional.
-- El modelo dbt `trips` deja de llevarla en la MISMA ventana (sync_all_columns).
-- IF EXISTS: si una corrida de dbt con el modelo nuevo llegara antes, sync_all_columns
-- ya habría borrado app.trips.void_reason y, con ella, su CHECK.

BEGIN;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM app.trips_manual WHERE voided_at IS NOT NULL AND void_reason_id IS NULL)
       OR EXISTS (SELECT 1 FROM app.trips WHERE voided_at IS NOT NULL AND void_reason_id IS NULL) THEN
        RAISE EXCEPTION 'Hay anulados sin motivo de catálogo: no se puede retirar void_reason';
    END IF;
END $$;

ALTER TABLE app.trips_manual DROP CONSTRAINT IF EXISTS ck_trips_manual_void_complete;
ALTER TABLE app.trips DROP CONSTRAINT IF EXISTS ck_trips_void_complete;
ALTER TABLE app.trips_manual DROP COLUMN IF EXISTS void_reason;
ALTER TABLE app.trips DROP COLUMN IF EXISTS void_reason;

ALTER TABLE app.trips_manual ADD CONSTRAINT ck_trips_manual_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NULL) = (void_reason_id IS NULL)
    AND (voided_at IS NOT NULL OR void_note IS NULL));
ALTER TABLE app.trips ADD CONSTRAINT ck_trips_void_complete CHECK (
    (voided_at IS NULL) = (voided_by IS NULL)
    AND (voided_at IS NULL) = (void_reason_id IS NULL)
    AND (voided_at IS NOT NULL OR void_note IS NULL));

COMMIT;
