-- Higienización de nomenclatura: app.trips/app.trips_manual mezclaban español
-- (activo/trabajando/asignado/primera_vuelta/estado_manual/observaciones/
-- comentarios) con el resto de la capa app (inglés). Verificado antes de
-- aplicar: manually_edited_fields vacío en las 2,724 filas (0 con ediciones
-- manuales), pipeline batch_tms_monitor_trips pausado — sin riesgo de que el
-- trigger de protección actúe sobre nombres viejos durante el rename.

ALTER TABLE app.trips RENAME COLUMN activo TO is_active;
ALTER TABLE app.trips RENAME COLUMN trabajando TO is_working;
ALTER TABLE app.trips RENAME COLUMN asignado TO is_assigned;
ALTER TABLE app.trips RENAME COLUMN primera_vuelta TO is_first_leg;
ALTER TABLE app.trips RENAME COLUMN estado_manual TO manual_status;
ALTER TABLE app.trips RENAME COLUMN observaciones TO notes;
ALTER TABLE app.trips RENAME COLUMN comentarios TO comments;

ALTER TABLE app.trips_manual RENAME COLUMN activo TO is_active;
ALTER TABLE app.trips_manual RENAME COLUMN trabajando TO is_working;
ALTER TABLE app.trips_manual RENAME COLUMN asignado TO is_assigned;
ALTER TABLE app.trips_manual RENAME COLUMN primera_vuelta TO is_first_leg;
ALTER TABLE app.trips_manual RENAME COLUMN estado_manual TO manual_status;
ALTER TABLE app.trips_manual RENAME COLUMN observaciones TO notes;
ALTER TABLE app.trips_manual RENAME COLUMN comentarios TO comments;

-- Recrear app.protect_manual_overrides con los nombres nuevos. Hallazgo real
-- al inspeccionar antes de tocar: la función existía pero NO estaba adjunta
-- a ningún trigger (pg_trigger sin filas para tgfoid=protect_manual_overrides
-- ni para app.trips/app.trips_manual) — se perdió en algún --full-refresh
-- anterior y nunca se re-creó vía post_hook, a diferencia de PK/RLS/índices
-- que sí están en la lista de post_hook de app_trips.sql. Se corrige acá:
-- se recrea la función Y se adjunta el trigger, y se agrega su creación al
-- post_hook del modelo dbt (ver app_trips.sql) para que sobreviva a
-- full-refresh futuros, mismo patrón ya usado para PK/RLS/índices.
CREATE OR REPLACE FUNCTION app.protect_manual_overrides()
 RETURNS trigger LANGUAGE plpgsql SET search_path TO 'app', 'pg_catalog'
AS $function$
BEGIN
    IF 'is_active' = ANY(OLD.manually_edited_fields) THEN NEW.is_active := OLD.is_active; END IF;
    IF 'is_working' = ANY(OLD.manually_edited_fields) THEN NEW.is_working := OLD.is_working; END IF;
    IF 'is_assigned' = ANY(OLD.manually_edited_fields) THEN NEW.is_assigned := OLD.is_assigned; END IF;
    IF 'manual_status' = ANY(OLD.manually_edited_fields) THEN NEW.manual_status := OLD.manual_status; END IF;
    IF 'is_first_leg' = ANY(OLD.manually_edited_fields) THEN NEW.is_first_leg := OLD.is_first_leg; END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_manual_overrides ON app.trips;
CREATE TRIGGER trg_protect_manual_overrides
  BEFORE UPDATE ON app.trips
  FOR EACH ROW
  EXECUTE FUNCTION app.protect_manual_overrides();
