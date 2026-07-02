-- Protege campos operativos que ahora el pipeline (app_trips.sql) actualiza
-- en cada corrida con valores derivados de current_status_tms/fleet, salvo
-- que el operador los haya sobreescrito manualmente vía PATCH /trips/{id}
-- (que agrega el nombre del campo a manually_edited_fields en el mismo UPDATE).
--
-- Diseño de dos niveles:
--   1. observaciones/comentarios/fleet_link_id/manually_edited_fields/
--      edited_by/edited_at: el pipeline NUNCA los incluye en su UPDATE
--      (merge_exclude_columns en app_trips.sql) — no necesitan trigger.
--   2. activo/trabajando/asignado/estado_manual/primera_vuelta: el pipeline
--      SÍ los actualiza en cada corrida (para reflejar el estado real del
--      viaje), pero este trigger revierte al valor anterior si el campo
--      específico está en manually_edited_fields (seteado por la API en
--      el mismo UPDATE que cambia el valor, por lo que ese UPDATE puntual
--      no se ve afectado — solo las corridas siguientes del pipeline).
--
-- Funciona sin importar quién emite el UPDATE (dbt merge, SQL directo,
-- FastAPI) porque la señal de protección vive en la fila misma
-- (manually_edited_fields), no en el origen de la conexión.

CREATE OR REPLACE FUNCTION app.protect_manual_overrides()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF 'activo' = ANY(OLD.manually_edited_fields) THEN
        NEW.activo := OLD.activo;
    END IF;
    IF 'trabajando' = ANY(OLD.manually_edited_fields) THEN
        NEW.trabajando := OLD.trabajando;
    END IF;
    IF 'asignado' = ANY(OLD.manually_edited_fields) THEN
        NEW.asignado := OLD.asignado;
    END IF;
    IF 'estado_manual' = ANY(OLD.manually_edited_fields) THEN
        NEW.estado_manual := OLD.estado_manual;
    END IF;
    IF 'primera_vuelta' = ANY(OLD.manually_edited_fields) THEN
        NEW.primera_vuelta := OLD.primera_vuelta;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_manual_overrides ON app.trips;

CREATE TRIGGER trg_protect_manual_overrides
    BEFORE UPDATE ON app.trips
    FOR EACH ROW
    EXECUTE FUNCTION app.protect_manual_overrides();
